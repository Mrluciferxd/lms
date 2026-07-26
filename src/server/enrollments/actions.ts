'use server'

/**
 * Enrollment administration.
 *
 * Creation goes through `enrollUser` rather than touching `db.enrollment.create`
 * directly — the idempotency rule it enforces cannot be expressed as a database
 * constraint (see ./enroll.ts), so a second creation path would reintroduce
 * exactly the duplicate rows that file exists to prevent.
 *
 * Leaving a batch is a status change, never a delete. `FeeSchedule` and
 * `Certificate` hang off the enrollment row, and "who dropped out of this
 * cohort" is a question clients ask months later.
 */

import { revalidatePath } from 'next/cache'

import { recordAudit } from '@/server/audit'
import { authorizeRequest } from '@/server/auth/rbac'
import { SEAT_OCCUPYING, seatState } from '@/server/batches/capacity'
import { db } from '@/server/db'
import { enrollUser } from './enroll'
import type { ActionResult } from '@/server/catalog/actions'
import type { EnrollmentStatus } from '@/generated/prisma/enums'

function fail(error: string): ActionResult {
  return { ok: false, error }
}

interface BatchSeatCheck {
  id: string
  courseId: string
  name: string
  capacity: number | null
}

/** Refuses when the cohort is full. Capacity is a promise made to the students in it. */
async function seatAvailable(batch: BatchSeatCheck): Promise<string | null> {
  const occupied = await db.enrollment.count({
    where: { batchId: batch.id, status: { in: [...SEAT_OCCUPYING] } },
  })

  const seats = seatState(occupied, batch.capacity)
  if (!seats.full) return null

  return `${batch.name} is full (${occupied}/${batch.capacity}). Raise its capacity first if you mean to over-subscribe it.`
}

export async function enrollStudentInBatch(
  batchId: string,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await authorizeRequest('enrollment:manage')
  if (!auth.ok) return fail('You do not have permission to manage enrollments.')

  const userId = String(formData.get('userId') ?? '').trim()
  if (!userId) return fail('Choose a student to enroll.')

  const batch = await db.batch.findUnique({
    where: { id: batchId },
    select: { id: true, courseId: true, name: true, capacity: true, status: true },
  })
  if (!batch) return fail('Batch not found.')

  // A COMPLETED batch is still enrollable, unlike a move target below: adding a
  // student to a cohort that has finished is how a missed record gets entered
  // after the fact, whereas moving a current student into one is a mistake.
  if (batch.status === 'CANCELLED') {
    return fail('This batch is cancelled. Enroll the student in an active batch instead.')
  }

  const student = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, status: true },
  })
  if (!student || student.status !== 'ACTIVE') return fail('That student account is not active.')

  const full = await seatAvailable(batch)
  if (full) return fail(full)

  // Idempotent, and it reactivates a cancelled or paused row itself. Nothing is
  // forced to ACTIVE here on purpose: a PENDING enrollment is one whose payment
  // has not settled, and quietly flipping it would hand out paid access.
  const result = await enrollUser({
    userId: student.id,
    courseId: batch.courseId,
    batchId: batch.id,
    source: 'MANUAL',
    actorId: auth.user.id,
  })

  revalidatePath(`/admin/batches/${batchId}`)
  revalidatePath('/admin/students')
  return { ok: true, id: result.enrollmentId }
}

export async function unenrollStudent(enrollmentId: string): Promise<ActionResult> {
  const auth = await authorizeRequest('enrollment:manage')
  if (!auth.ok) return fail('You do not have permission to manage enrollments.')

  const enrollment = await db.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, status: true, batchId: true, userId: true },
  })
  if (!enrollment) return fail('Enrollment not found.')

  await db.enrollment.update({
    where: { id: enrollmentId },
    data: { status: 'CANCELLED' },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: 'enrollment.cancelled',
    entityType: 'Enrollment',
    entityId: enrollmentId,
    meta: { from: enrollment.status, userId: enrollment.userId, batchId: enrollment.batchId },
  })

  if (enrollment.batchId) revalidatePath(`/admin/batches/${enrollment.batchId}`)
  revalidatePath(`/admin/students/${enrollment.userId}`)
  return { ok: true }
}

/** Pause, resume or reinstate. Cancelling has its own action so it reads clearly in the log. */
export async function setEnrollmentStatus(
  enrollmentId: string,
  status: Extract<EnrollmentStatus, 'ACTIVE' | 'PAUSED' | 'COMPLETED'>,
): Promise<ActionResult> {
  const auth = await authorizeRequest('enrollment:manage')
  if (!auth.ok) return fail('You do not have permission to manage enrollments.')

  const enrollment = await db.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      status: true,
      userId: true,
      batch: { select: { id: true, courseId: true, name: true, capacity: true } },
    },
  })
  if (!enrollment) return fail('Enrollment not found.')

  // Reinstating someone into a full cohort would silently break the capacity
  // promise, so it is checked here as well as on the way in.
  if (status === 'ACTIVE' && !SEAT_OCCUPYING.includes(enrollment.status) && enrollment.batch) {
    const full = await seatAvailable(enrollment.batch)
    if (full) return fail(full)
  }

  await db.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status,
      // Only ever set. Pausing a finished enrollment must not erase the date it
      // was completed on — that is what a certificate is issued against.
      ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
    },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: 'enrollment.status_changed',
    entityType: 'Enrollment',
    entityId: enrollmentId,
    meta: { from: enrollment.status, to: status, userId: enrollment.userId },
  })

  if (enrollment.batch) revalidatePath(`/admin/batches/${enrollment.batch.id}`)
  revalidatePath(`/admin/students/${enrollment.userId}`)
  return { ok: true }
}

/**
 * Moves a student between cohorts of the same course.
 *
 * Two consequences the caller must have surfaced first:
 *
 *  1. Drip re-anchors. Every DAYS_AFTER_BATCH_START lesson resolves against the
 *     new batch's start date, so content can lock again or unlock early the
 *     moment this returns. Availability is computed, not stored (see
 *     ../batches/release.ts), which is exactly what makes the change immediate.
 *  2. Attendance stays behind. Records belong to the sessions of the old batch,
 *     so the student's percentage in the new cohort starts empty.
 */
export async function moveEnrollmentToBatch(
  enrollmentId: string,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await authorizeRequest('enrollment:manage')
  if (!auth.ok) return fail('You do not have permission to manage enrollments.')

  const targetBatchId = String(formData.get('targetBatchId') ?? '').trim()
  if (!targetBatchId) return fail('Choose the batch to move this student into.')

  const enrollment = await db.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, userId: true, courseId: true, batchId: true, status: true },
  })
  if (!enrollment) return fail('Enrollment not found.')

  if (enrollment.batchId === targetBatchId) return { ok: true }

  const target = await db.batch.findUnique({
    where: { id: targetBatchId },
    select: { id: true, courseId: true, name: true, capacity: true, status: true },
  })
  if (!target) return fail('That batch no longer exists.')

  if (target.courseId !== enrollment.courseId) {
    // Moving across courses would leave the enrollment pointing at a batch of a
    // different syllabus. Enrolling them in the other course is the real intent.
    return fail('That batch belongs to a different course. Enroll the student in that course instead.')
  }

  if (target.status === 'CANCELLED' || target.status === 'COMPLETED') {
    return fail(`${target.name} is ${target.status.toLowerCase()} and cannot take new students.`)
  }

  // `@@unique([userId, courseId, batchId])` would reject this at the database,
  // but the message would be a constraint name. A student who repeated a cohort
  // legitimately has an enrollment in each, so this is a real collision.
  const clash = await db.enrollment.findFirst({
    where: { userId: enrollment.userId, courseId: enrollment.courseId, batchId: targetBatchId },
    select: { id: true },
  })
  if (clash) {
    return fail('This student already has an enrollment in that batch.')
  }

  if (SEAT_OCCUPYING.includes(enrollment.status)) {
    const full = await seatAvailable(target)
    if (full) return fail(full)
  }

  await db.enrollment.update({
    where: { id: enrollmentId },
    data: { batchId: targetBatchId },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: 'enrollment.batch_changed',
    entityType: 'Enrollment',
    entityId: enrollmentId,
    meta: { userId: enrollment.userId, from: enrollment.batchId, to: targetBatchId },
  })

  if (enrollment.batchId) revalidatePath(`/admin/batches/${enrollment.batchId}`)
  revalidatePath(`/admin/batches/${targetBatchId}`)
  revalidatePath(`/admin/students/${enrollment.userId}`)
  // The student's timetable is batch-scoped, so it changed too.
  revalidatePath('/app/live')
  return { ok: true }
}
