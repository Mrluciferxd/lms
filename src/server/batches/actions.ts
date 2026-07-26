'use server'

/**
 * Batch mutations.
 *
 * Every action re-checks its permission server-side. A hidden button is not
 * authorization: server actions are directly invocable endpoints, so the check
 * has to live here rather than in whatever rendered the form.
 *
 * Dates arrive from `<input type="date">` as bare calendar days and are resolved
 * through the org timezone, never `new Date('2026-08-01')`. That literal is UTC
 * midnight, which is the previous evening in the Americas and 05:30 in India —
 * and a batch start date is the anchor every DAYS_AFTER_BATCH_START lesson drips
 * from, so an off-by-a-few-hours anchor shifts a whole cohort's unlock schedule.
 */

import { revalidatePath } from 'next/cache'
import { fromZonedTime } from 'date-fns-tz'
import { z } from 'zod'

import { recordAudit } from '@/server/audit'
import { authorizeRequest } from '@/server/auth/rbac'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { isStaffRole } from '@/server/auth/roles'
import { MAX_OCCURRENCES, generateOccurrences, parseSchedule } from './schedule'
import type { ActionResult } from '@/server/catalog/actions'

export interface GenerateResult extends ActionResult {
  created?: number
  /** Occurrences that already had a session at that instant. */
  skipped?: number
}

function fail(error: string, fieldErrors?: Record<string, string>): ActionResult {
  return { ok: false, error, fieldErrors }
}

function firstIssues(error: z.ZodError): Record<string, string> {
  const flattened = error.flatten().fieldErrors
  return Object.fromEntries(
    Object.entries(flattened)
      .filter(([, messages]) => messages && messages.length > 0)
      .map(([field, messages]) => [field, messages![0]!]),
  )
}

const batchSchema = z
  .object({
    courseId: z.string().trim().min(1, 'Choose a course'),
    name: z.string().trim().min(2, 'Name is too short').max(120),
    code: z
      .string()
      .trim()
      .min(2, 'Code is too short')
      .max(40)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Use letters, numbers, dots, dashes and underscores'),
    description: z.string().trim().max(2000).optional(),
    status: z.enum(['UPCOMING', 'ENROLLING', 'RUNNING', 'COMPLETED', 'CANCELLED']),
    startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date'),
    endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    capacity: z.coerce.number().int().min(1).max(100_000).optional(),
    instructorId: z.string().trim().optional(),
    /** Recurring schedule, split into its three parts by the form. */
    rrule: z.string().trim().max(200).optional(),
    startTime: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 19:00')
      .optional(),
    durationMin: z.coerce.number().int().min(5).max(1440).optional(),
  })
  .superRefine((data, ctx) => {
    // A recurrence without a time of day generates nothing, so the three parts
    // are required together rather than accepted and quietly ignored.
    if (!data.rrule) return
    if (!data.startTime) {
      ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Set the class start time.' })
    }
    if (data.durationMin === undefined) {
      ctx.addIssue({ code: 'custom', path: ['durationMin'], message: 'Set how long a class runs.' })
    }
  })

type BatchInput = z.infer<typeof batchSchema>

function readBatchForm(formData: FormData) {
  return batchSchema.safeParse({
    courseId: formData.get('courseId'),
    name: formData.get('name'),
    code: formData.get('code'),
    description: formData.get('description') || undefined,
    status: formData.get('status') ?? 'UPCOMING',
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate') || undefined,
    capacity: formData.get('capacity') || undefined,
    instructorId: formData.get('instructorId') || undefined,
    rrule: formData.get('rrule') || undefined,
    startTime: formData.get('startTime') || undefined,
    durationMin: formData.get('durationMin') || undefined,
  })
}

/** Local midnight in the org timezone, as a UTC instant. */
function startOfDay(day: string, timezone: string): Date {
  return fromZonedTime(`${day}T00:00:00`, timezone)
}

/** Local end-of-day, so a batch ending on the 31st includes the 31st. */
function endOfDay(day: string, timezone: string): Date {
  return fromZonedTime(`${day}T23:59:59.999`, timezone)
}

/**
 * The schedule JSON, or a field error. An empty rrule clears the schedule rather
 * than being an error — plenty of batches have no fixed timetable.
 */
function readSchedule(
  data: BatchInput,
): { ok: true; schedule: Record<string, unknown> } | { ok: false; fieldErrors: Record<string, string> } {
  if (!data.rrule) return { ok: true, schedule: {} }

  const schedule = {
    rrule: data.rrule,
    startTime: data.startTime ?? '',
    durationMin: data.durationMin ?? 0,
  }

  const parsed = parseSchedule(schedule)
  if (parsed.status === 'invalid') return { ok: false, fieldErrors: { rrule: parsed.error } }

  return { ok: true, schedule }
}

/** Codes are case-normalised: "fx-01" and "FX-01" must not be two batches. */
function normalizeCode(code: string): string {
  return code.toUpperCase()
}

async function validateReferences(
  data: BatchInput,
): Promise<Record<string, string> | null> {
  const course = await db.course.findUnique({ where: { id: data.courseId }, select: { id: true } })
  if (!course) return { courseId: 'That course no longer exists.' }

  if (data.instructorId) {
    const instructor = await db.user.findUnique({
      where: { id: data.instructorId },
      select: { role: true, status: true },
    })
    if (!instructor || instructor.status !== 'ACTIVE' || !isStaffRole(instructor.role)) {
      return { instructorId: 'Choose an active staff member.' }
    }
  }

  return null
}

export async function createBatch(formData: FormData): Promise<ActionResult> {
  const auth = await authorizeRequest('batch:manage')
  if (!auth.ok) return fail('You do not have permission to manage batches.')

  const parsed = readBatchForm(formData)
  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const settings = await getOrgSettings()
  const startDate = startOfDay(parsed.data.startDate, settings.timezone)
  const endDate = parsed.data.endDate ? endOfDay(parsed.data.endDate, settings.timezone) : null

  if (endDate && endDate.getTime() <= startDate.getTime()) {
    return fail('The end date must be after the start date.', {
      endDate: 'Must be after the start date',
    })
  }

  const referenceErrors = await validateReferences(parsed.data)
  if (referenceErrors) return fail('Please correct the highlighted fields.', referenceErrors)

  const schedule = readSchedule(parsed.data)
  if (!schedule.ok) return fail('That recurring schedule cannot be read.', schedule.fieldErrors)

  const code = normalizeCode(parsed.data.code)
  const clash = await db.batch.findUnique({ where: { code }, select: { id: true } })
  if (clash) return fail('That code is already in use.', { code: 'Already in use' })

  const batch = await db.batch.create({
    data: {
      courseId: parsed.data.courseId,
      name: parsed.data.name,
      code,
      description: parsed.data.description ?? null,
      status: parsed.data.status,
      startDate,
      endDate,
      capacity: parsed.data.capacity ?? null,
      instructorId: parsed.data.instructorId || null,
      schedule: schedule.schedule as never,
    },
    select: { id: true },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: 'batch.created',
    entityType: 'Batch',
    entityId: batch.id,
    meta: { code, courseId: parsed.data.courseId, startDate: startDate.toISOString() },
  })

  revalidatePath('/admin/batches')
  return { ok: true, id: batch.id }
}

export async function updateBatch(batchId: string, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeRequest('batch:manage')
  if (!auth.ok) return fail('You do not have permission to manage batches.')

  const parsed = readBatchForm(formData)
  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const existing = await db.batch.findUnique({
    where: { id: batchId },
    select: { code: true, startDate: true, status: true, courseId: true },
  })
  if (!existing) return fail('Batch not found.')

  const settings = await getOrgSettings()
  const startDate = startOfDay(parsed.data.startDate, settings.timezone)
  const endDate = parsed.data.endDate ? endOfDay(parsed.data.endDate, settings.timezone) : null

  if (endDate && endDate.getTime() <= startDate.getTime()) {
    return fail('The end date must be after the start date.', {
      endDate: 'Must be after the start date',
    })
  }

  const referenceErrors = await validateReferences(parsed.data)
  if (referenceErrors) return fail('Please correct the highlighted fields.', referenceErrors)

  const schedule = readSchedule(parsed.data)
  if (!schedule.ok) return fail('That recurring schedule cannot be read.', schedule.fieldErrors)

  const code = normalizeCode(parsed.data.code)
  if (code !== existing.code) {
    const clash = await db.batch.findUnique({ where: { code }, select: { id: true } })
    if (clash) return fail('That code is already in use.', { code: 'Already in use' })
  }

  await db.batch.update({
    where: { id: batchId },
    data: {
      courseId: parsed.data.courseId,
      name: parsed.data.name,
      code,
      description: parsed.data.description ?? null,
      status: parsed.data.status,
      startDate,
      endDate,
      capacity: parsed.data.capacity ?? null,
      instructorId: parsed.data.instructorId || null,
      schedule: schedule.schedule as never,
    },
  })

  // Worth its own audit line: moving the start date re-anchors every
  // DAYS_AFTER_BATCH_START lesson for everyone in the cohort at once, and
  // "why did the syllabus unlock early" is asked after the fact.
  const movedStart = existing.startDate.getTime() !== startDate.getTime()

  await recordAudit({
    actorId: auth.user.id,
    action: movedStart ? 'batch.start_date_changed' : 'batch.updated',
    entityType: 'Batch',
    entityId: batchId,
    meta: movedStart
      ? { from: existing.startDate.toISOString(), to: startDate.toISOString() }
      : { status: parsed.data.status },
  })

  revalidatePath('/admin/batches')
  revalidatePath(`/admin/batches/${batchId}`)
  return { ok: true }
}

/**
 * Deletion is refused for a batch with any history.
 *
 * `LiveSession` cascades from `Batch`, and `Attendance` cascades from the
 * session — so deleting a running cohort silently destroys its entire register.
 * Cancelling is what the operator actually wants and it keeps the record.
 */
export async function deleteBatch(batchId: string): Promise<ActionResult> {
  const auth = await authorizeRequest('batch:manage')
  if (!auth.ok) return fail('You do not have permission to manage batches.')

  const batch = await db.batch.findUnique({
    where: { id: batchId },
    select: {
      code: true,
      _count: { select: { enrollments: true, liveSessions: true } },
    },
  })
  if (!batch) return fail('Batch not found.')

  if (batch._count.enrollments > 0 || batch._count.liveSessions > 0) {
    return fail(
      `This batch has ${batch._count.enrollments} enrollment(s) and ${batch._count.liveSessions} session(s). Set its status to Cancelled instead — deleting it would erase the attendance record for every class.`,
    )
  }

  await db.batch.delete({ where: { id: batchId } })

  await recordAudit({
    actorId: auth.user.id,
    action: 'batch.deleted',
    entityType: 'Batch',
    entityId: batchId,
    meta: { code: batch.code },
  })

  revalidatePath('/admin/batches')
  return { ok: true }
}

const generateSchema = z.object({
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  joinUrl: z.string().trim().url('Enter a full URL, including https://').max(2000).optional(),
})

/**
 * Materialises a batch's recurring schedule into `LiveSession` rows.
 *
 * Idempotent by (batch, scheduledStart): pressing the button twice, or extending
 * the window later, adds only the occurrences that are missing. Without that,
 * a second click doubles the timetable and every student's calendar.
 */
export async function generateBatchSessions(
  batchId: string,
  formData: FormData,
): Promise<GenerateResult> {
  const auth = await authorizeRequest('session:manage')
  if (!auth.ok) return fail('You do not have permission to manage sessions.')

  const parsed = generateSchema.safeParse({
    from: formData.get('from') || undefined,
    to: formData.get('to') || undefined,
    joinUrl: formData.get('joinUrl') || undefined,
  })
  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const batch = await db.batch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      name: true,
      courseId: true,
      instructorId: true,
      startDate: true,
      endDate: true,
      schedule: true,
    },
  })
  if (!batch) return fail('Batch not found.')

  const schedule = parseSchedule(batch.schedule)
  if (schedule.status === 'empty') {
    return fail('This batch has no recurring schedule. Add one in the batch details first.')
  }
  if (schedule.status === 'invalid') {
    return fail(`This batch's recurring schedule cannot be read: ${schedule.error}`)
  }

  const settings = await getOrgSettings()
  const from = parsed.data.from ? startOfDay(parsed.data.from, settings.timezone) : batch.startDate
  const fallbackTo = batch.endDate ?? new Date(batch.startDate.getTime() + 90 * 86_400_000)
  const to = parsed.data.to ? endOfDay(parsed.data.to, settings.timezone) : fallbackTo

  if (to.getTime() < from.getTime()) {
    return fail('The end of the window is before its start.', { to: 'Must be after the start' })
  }

  const occurrences = generateOccurrences(schedule.recurrence, {
    from,
    to,
    timezone: settings.timezone,
    limit: MAX_OCCURRENCES,
  })

  if (occurrences.length === 0) {
    return fail('That window contains no scheduled classes.')
  }

  const existing = await db.liveSession.findMany({
    where: { batchId, scheduledStart: { in: occurrences.map((slot) => slot.start) } },
    select: { scheduledStart: true },
  })
  const taken = new Set(existing.map((row) => row.scheduledStart.getTime()))

  const missing = occurrences.filter((slot) => !taken.has(slot.start.getTime()))

  if (missing.length > 0) {
    await db.liveSession.createMany({
      data: missing.map((slot) => ({
        kind: 'CLASS' as const,
        title: batch.name,
        batchId: batch.id,
        courseId: batch.courseId,
        hostId: batch.instructorId,
        scheduledStart: slot.start,
        scheduledEnd: slot.end,
        // Generated classes belong to their cohort and nobody else.
        visibility: 'BATCH' as const,
        tracksAttendance: true,
        joinUrl: parsed.data.joinUrl ?? null,
      })),
    })
  }

  await recordAudit({
    actorId: auth.user.id,
    action: 'batch.sessions_generated',
    entityType: 'Batch',
    entityId: batchId,
    meta: {
      created: missing.length,
      skipped: occurrences.length - missing.length,
      from: from.toISOString(),
      to: to.toISOString(),
    },
  })

  revalidatePath(`/admin/batches/${batchId}`)
  revalidatePath('/admin/attendance')
  revalidatePath('/app/live')

  return { ok: true, created: missing.length, skipped: occurrences.length - missing.length }
}
