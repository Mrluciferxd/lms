/**
 * Fee schedules and installments.
 *
 * A schedule is an *obligation*; an order is a payment *attempt*. They are
 * separate models for that reason — a schedule exists whether or not anything has
 * been paid, and one installment may take several attempts. The FEE_DUE and
 * FEE_OVERDUE notification triggers read installments, not orders.
 *
 * The arithmetic and the date stepping are pure and live in ./schedule.ts. This
 * module is the database around them.
 */

import { recordAudit } from '@/server/audit'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { buildInstallmentPlan, type FeeCadence } from './schedule'
import type { InstallmentStatus } from '@/generated/prisma/enums'

export interface CreateFeeScheduleInput {
  enrollmentId: string
  totalMinor: number
  count: number
  firstDueDate: Date
  cadence: FeeCadence
  notes?: string | null
  actorId: string
}

export type FeeScheduleResult =
  | { ok: true; feeScheduleId: string; installments: number }
  | { ok: false; error: string }

/**
 * Creates (or rebuilds) the installment plan for an enrollment.
 *
 * Rebuilding is refused once anything has been paid. `FeeSchedule.enrollmentId`
 * is unique, so a rebuild means deleting the existing installments — and deleting
 * a PAID installment would erase the only record that ties a payment to what it
 * settled. Re-plan the unpaid remainder instead.
 */
export async function createFeeSchedule(
  input: CreateFeeScheduleInput,
): Promise<FeeScheduleResult> {
  const enrollment = await db.enrollment.findUnique({
    where: { id: input.enrollmentId },
    select: {
      id: true,
      userId: true,
      feeSchedule: {
        select: {
          id: true,
          installments: { select: { id: true, status: true } },
        },
      },
    },
  })
  if (!enrollment) return { ok: false, error: 'Enrollment not found.' }

  const settled = enrollment.feeSchedule?.installments.filter(
    (installment) => installment.status === 'PAID' || installment.status === 'WAIVED',
  )
  if (settled && settled.length > 0) {
    return {
      ok: false,
      error: `This schedule already has ${settled.length} settled installment(s). Rebuilding it would delete the record of what they paid for.`,
    }
  }

  const settings = await getOrgSettings()

  let plan
  try {
    plan = buildInstallmentPlan({
      totalMinor: input.totalMinor,
      count: input.count,
      firstDueDate: input.firstDueDate,
      cadence: input.cadence,
      timezone: settings.timezone,
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid plan.' }
  }

  // One transaction so a rebuild cannot leave an enrollment with a schedule whose
  // installments were deleted and never replaced.
  const feeScheduleId = await db.$transaction(async (tx) => {
    const schedule = await tx.feeSchedule.upsert({
      where: { enrollmentId: enrollment.id },
      create: {
        enrollmentId: enrollment.id,
        totalMinor: input.totalMinor,
        currency: settings.currency,
        notes: input.notes ?? null,
      },
      update: {
        totalMinor: input.totalMinor,
        currency: settings.currency,
        notes: input.notes ?? null,
      },
      select: { id: true },
    })

    await tx.feeInstallment.deleteMany({ where: { feeScheduleId: schedule.id } })

    await tx.feeInstallment.createMany({
      data: plan.map((installment) => ({
        feeScheduleId: schedule.id,
        seq: installment.seq,
        label: `Installment ${installment.seq} of ${plan.length}`,
        amountMinor: installment.amountMinor,
        dueDate: installment.dueDate,
      })),
    })

    return schedule.id
  })

  await recordAudit({
    actorId: input.actorId,
    action: 'fee_schedule.created',
    entityType: 'FeeSchedule',
    entityId: feeScheduleId,
    meta: {
      enrollmentId: enrollment.id,
      totalMinor: input.totalMinor,
      count: plan.length,
      cadence: input.cadence,
    },
  })

  return { ok: true, feeScheduleId, installments: plan.length }
}

/**
 * Marks an installment settled outside the gateway — a bank transfer, cash at the
 * desk, or a cheque. Conditional on the current status so two operators clicking
 * at once cannot overwrite the first settlement's timestamp.
 */
export async function settleInstallmentManually(input: {
  installmentId: string
  actorId: string
  status: Extract<InstallmentStatus, 'PAID' | 'WAIVED' | 'CANCELLED'>
}): Promise<{ ok: boolean; error?: string }> {
  const now = new Date()

  const updated = await db.feeInstallment.updateMany({
    where: { id: input.installmentId, status: { in: ['PENDING', 'OVERDUE'] } },
    data: {
      status: input.status,
      paidAt: input.status === 'PAID' ? now : null,
    },
  })

  if (updated.count === 0) {
    return { ok: false, error: 'That installment has already been settled.' }
  }

  await recordAudit({
    actorId: input.actorId,
    action: `fee_installment.${input.status.toLowerCase()}`,
    entityType: 'FeeInstallment',
    entityId: input.installmentId,
    meta: { manual: true },
  })

  return { ok: true }
}

/**
 * Flips every past-due PENDING installment to OVERDUE.
 *
 * Status is derived rather than trusted at read time everywhere else — the
 * billing page and the dues query both compare `dueDate` themselves — so this is
 * not load-bearing for correctness. What it is load-bearing for is the FEE_OVERDUE
 * notification trigger and the `(status, dueDate)` index, both of which read the
 * column.
 *
 * Exported for the scheduler; there is no cron entrypoint in this territory, so
 * /admin/payments also exposes it as a button. Safe to run repeatedly.
 */
export async function markOverdueInstallments(now = new Date()): Promise<number> {
  const updated = await db.feeInstallment.updateMany({
    where: { status: 'PENDING', dueDate: { lt: now } },
    data: { status: 'OVERDUE' },
  })
  return updated.count
}

export interface StudentDue {
  id: string
  seq: number
  label: string | null
  amountMinor: number
  dueDate: Date
  status: InstallmentStatus
  courseTitle: string
  currency: string
}

/** Everything a student still owes, oldest first. */
export async function listStudentDues(userId: string): Promise<StudentDue[]> {
  const installments = await db.feeInstallment.findMany({
    where: {
      status: { in: ['PENDING', 'OVERDUE'] },
      feeSchedule: { enrollment: { userId } },
    },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      seq: true,
      label: true,
      amountMinor: true,
      dueDate: true,
      status: true,
      feeSchedule: {
        select: { currency: true, enrollment: { select: { course: { select: { title: true } } } } },
      },
    },
  })

  return installments.map((installment) => ({
    id: installment.id,
    seq: installment.seq,
    label: installment.label,
    amountMinor: installment.amountMinor,
    dueDate: installment.dueDate,
    status: installment.status,
    courseTitle: installment.feeSchedule.enrollment.course.title,
    currency: installment.feeSchedule.currency,
  }))
}

/** Total outstanding across every student. Shown on the admin payments page. */
export async function outstandingDuesMinor(): Promise<number> {
  const aggregate = await db.feeInstallment.aggregate({
    where: { status: { in: ['PENDING', 'OVERDUE'] } },
    _sum: { amountMinor: true },
  })
  return aggregate._sum.amountMinor ?? 0
}
