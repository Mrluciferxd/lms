'use server'

/**
 * Live session mutations, including the attendance register.
 *
 * Every action re-checks its permission server-side; these are directly
 * invocable endpoints, and the form that rendered them is not the boundary.
 *
 * `streamKey` is write-only here and is never selected by anything that renders.
 * It is the credential that lets a machine broadcast AS the academy — an empty
 * field means "leave it alone", so an admin editing a session's title cannot
 * accidentally blank it, and nothing ever ships it to a browser.
 *
 * Times arrive from `<input type="datetime-local">`, which submits a bare wall
 * clock with no zone. They are resolved through the ORG timezone, not the
 * server's: `new Date('2026-07-27T19:00')` means 19:00 wherever the container
 * happens to think it is, which silently moves every class in a cohort.
 */

import { revalidatePath } from 'next/cache'
import { fromZonedTime } from 'date-fns-tz'
import { z } from 'zod'

import { recordAudit } from '@/server/audit'
import { authorizeRequest } from '@/server/auth/rbac'
import { isStaffRole } from '@/server/auth/roles'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { applyAttendance, type AttendanceMark } from './attendance'
import type { ActionResult } from '@/server/catalog/actions'
import type { AttendanceStatus, SessionStatus } from '@/generated/prisma/enums'

export interface MarkResult extends ActionResult {
  marked?: number
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

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

const sessionSchema = z.object({
  kind: z.enum(['CLASS', 'BROADCAST', 'WEBINAR', 'DOUBT_CLEARING', 'EVENT']),
  title: z.string().trim().min(2, 'Title is too short').max(200),
  description: z.string().trim().max(5000).optional(),
  batchId: z.string().trim().optional(),
  courseId: z.string().trim().optional(),
  hostId: z.string().trim().optional(),
  scheduledStart: z.string().trim().regex(LOCAL_DATETIME, 'Pick a date and time'),
  scheduledEnd: z.string().trim().regex(LOCAL_DATETIME).optional(),
  mode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']),
  visibility: z.enum(['PUBLIC', 'ENROLLED', 'BATCH', 'ROLE']),
  status: z.enum(['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED']),
  location: z.string().trim().max(300).optional(),
  joinUrl: z.string().trim().url('Enter a full URL, including https://').max(2000).optional(),
  streamProvider: z.string().trim().max(60).optional(),
  streamKey: z.string().trim().max(300).optional(),
  clearStreamKey: z.boolean(),
  recordingAssetId: z.string().trim().optional(),
  tracksAttendance: z.boolean(),
  capacity: z.coerce.number().int().min(1).max(100_000).optional(),
})

type SessionInput = z.infer<typeof sessionSchema>

function readSessionForm(formData: FormData) {
  return sessionSchema.safeParse({
    kind: formData.get('kind') ?? 'CLASS',
    title: formData.get('title'),
    description: formData.get('description') || undefined,
    batchId: formData.get('batchId') || undefined,
    courseId: formData.get('courseId') || undefined,
    hostId: formData.get('hostId') || undefined,
    scheduledStart: formData.get('scheduledStart'),
    scheduledEnd: formData.get('scheduledEnd') || undefined,
    mode: formData.get('mode') ?? 'ONLINE',
    visibility: formData.get('visibility') ?? 'BATCH',
    status: formData.get('status') ?? 'SCHEDULED',
    location: formData.get('location') || undefined,
    joinUrl: formData.get('joinUrl') || undefined,
    streamProvider: formData.get('streamProvider') || undefined,
    streamKey: formData.get('streamKey') || undefined,
    clearStreamKey: formData.get('clearStreamKey') === 'on',
    recordingAssetId: formData.get('recordingAssetId') || undefined,
    tracksAttendance: formData.get('tracksAttendance') === 'on',
    capacity: formData.get('capacity') || undefined,
  })
}

function toInstant(wallClock: string, timezone: string): Date {
  return fromZonedTime(wallClock.length === 16 ? `${wallClock}:00` : wallClock, timezone)
}

interface ResolvedSession {
  start: Date
  end: Date | null
  batchId: string | null
  courseId: string | null
}

/**
 * Cross-field rules. The two that matter are structural rather than cosmetic:
 * a CLASS has no register without a cohort, and a BATCH-visible session with no
 * batch is invisible to everyone (see ./visibility.ts) — which reads to the
 * admin who created it as the platform having lost their session.
 */
async function resolveSession(
  data: SessionInput,
  timezone: string,
): Promise<{ ok: true; resolved: ResolvedSession } | { ok: false; fieldErrors: Record<string, string> }> {
  const start = toInstant(data.scheduledStart, timezone)
  const end = data.scheduledEnd ? toInstant(data.scheduledEnd, timezone) : null

  if (end && end.getTime() <= start.getTime()) {
    return { ok: false, fieldErrors: { scheduledEnd: 'Must be after the start time.' } }
  }

  const batchId = data.batchId || null

  if (data.kind === 'CLASS' && !batchId) {
    return { ok: false, fieldErrors: { batchId: 'A class belongs to a batch. Pick one, or use another kind.' } }
  }

  if (data.visibility === 'BATCH' && !batchId) {
    return {
      ok: false,
      fieldErrors: { batchId: 'Batch-only visibility needs a batch — without one nobody can see this session.' },
    }
  }

  let courseId = data.courseId || null

  if (batchId) {
    const batch = await db.batch.findUnique({ where: { id: batchId }, select: { courseId: true } })
    if (!batch) return { ok: false, fieldErrors: { batchId: 'That batch no longer exists.' } }
    // The batch owns the course link; a mismatched courseId would make the
    // session visible to the wrong cohort under ENROLLED visibility.
    courseId = batch.courseId
  } else if (courseId) {
    const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true } })
    if (!course) return { ok: false, fieldErrors: { courseId: 'That course no longer exists.' } }
  }

  if (data.hostId) {
    const host = await db.user.findUnique({
      where: { id: data.hostId },
      select: { role: true, status: true },
    })
    if (!host || host.status !== 'ACTIVE' || !isStaffRole(host.role)) {
      return { ok: false, fieldErrors: { hostId: 'Choose an active staff member.' } }
    }
  }

  if (data.recordingAssetId) {
    const asset = await db.mediaAsset.findUnique({
      where: { id: data.recordingAssetId },
      select: { id: true },
    })
    if (!asset) return { ok: false, fieldErrors: { recordingAssetId: 'No media asset with that id.' } }
  }

  return { ok: true, resolved: { start, end, batchId, courseId } }
}

function revalidateSession(batchId: string | null): void {
  revalidatePath('/admin/batches/sessions')
  if (batchId) revalidatePath(`/admin/batches/${batchId}`)
  revalidatePath('/admin/attendance')
  revalidatePath('/app/live')
}

export async function createLiveSession(formData: FormData): Promise<ActionResult> {
  const auth = await authorizeRequest('session:manage')
  if (!auth.ok) return fail('You do not have permission to manage sessions.')

  const parsed = readSessionForm(formData)
  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const settings = await getOrgSettings()
  const resolution = await resolveSession(parsed.data, settings.timezone)
  if (!resolution.ok) return fail('Please correct the highlighted fields.', resolution.fieldErrors)

  const session = await db.liveSession.create({
    data: {
      kind: parsed.data.kind,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      batchId: resolution.resolved.batchId,
      courseId: resolution.resolved.courseId,
      hostId: parsed.data.hostId || null,
      scheduledStart: resolution.resolved.start,
      scheduledEnd: resolution.resolved.end,
      mode: parsed.data.mode,
      status: parsed.data.status,
      visibility: parsed.data.visibility,
      location: parsed.data.location ?? null,
      joinUrl: parsed.data.joinUrl ?? null,
      streamProvider: parsed.data.streamProvider ?? null,
      streamKey: parsed.data.streamKey ?? null,
      recordingAssetId: parsed.data.recordingAssetId || null,
      tracksAttendance: parsed.data.tracksAttendance,
      capacity: parsed.data.capacity ?? null,
    },
    select: { id: true },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: 'session.created',
    entityType: 'LiveSession',
    entityId: session.id,
    meta: {
      kind: parsed.data.kind,
      batchId: resolution.resolved.batchId,
      scheduledStart: resolution.resolved.start.toISOString(),
    },
  })

  revalidateSession(resolution.resolved.batchId)
  return { ok: true, id: session.id }
}

export async function updateLiveSession(
  sessionId: string,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await authorizeRequest('session:manage')
  if (!auth.ok) return fail('You do not have permission to manage sessions.')

  const parsed = readSessionForm(formData)
  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const existing = await db.liveSession.findUnique({
    where: { id: sessionId },
    select: { id: true, batchId: true, scheduledStart: true, status: true },
  })
  if (!existing) return fail('Session not found.')

  const settings = await getOrgSettings()
  const resolution = await resolveSession(parsed.data, settings.timezone)
  if (!resolution.ok) return fail('Please correct the highlighted fields.', resolution.fieldErrors)

  await db.liveSession.update({
    where: { id: sessionId },
    data: {
      kind: parsed.data.kind,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      batchId: resolution.resolved.batchId,
      courseId: resolution.resolved.courseId,
      hostId: parsed.data.hostId || null,
      scheduledStart: resolution.resolved.start,
      scheduledEnd: resolution.resolved.end,
      mode: parsed.data.mode,
      status: parsed.data.status,
      visibility: parsed.data.visibility,
      location: parsed.data.location ?? null,
      joinUrl: parsed.data.joinUrl ?? null,
      streamProvider: parsed.data.streamProvider ?? null,
      // Blank means "unchanged" — see the module note. Clearing it is explicit.
      ...(parsed.data.clearStreamKey
        ? { streamKey: null }
        : parsed.data.streamKey
          ? { streamKey: parsed.data.streamKey }
          : {}),
      recordingAssetId: parsed.data.recordingAssetId || null,
      tracksAttendance: parsed.data.tracksAttendance,
      capacity: parsed.data.capacity ?? null,
    },
  })

  await recordAudit({
    actorId: auth.user.id,
    action:
      existing.scheduledStart.getTime() !== resolution.resolved.start.getTime()
        ? 'session.rescheduled'
        : 'session.updated',
    entityType: 'LiveSession',
    entityId: sessionId,
    meta: {
      from: existing.scheduledStart.toISOString(),
      to: resolution.resolved.start.toISOString(),
    },
  })

  revalidateSession(resolution.resolved.batchId)
  if (existing.batchId && existing.batchId !== resolution.resolved.batchId) {
    revalidatePath(`/admin/batches/${existing.batchId}`)
  }
  return { ok: true }
}

/**
 * Lifecycle transitions, as a one-click control.
 *
 * Stamps `actualStart` / `actualEnd`, which are what the drip resolver reads:
 * an AFTER_SESSION lesson unlocks when its gate session has actually ended, so
 * pressing "End" here is what releases content to a cohort.
 */
export async function setSessionStatus(
  sessionId: string,
  status: SessionStatus,
): Promise<ActionResult> {
  const auth = await authorizeRequest('session:manage')
  if (!auth.ok) return fail('You do not have permission to manage sessions.')

  const session = await db.liveSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, batchId: true, actualStart: true, title: true },
  })
  if (!session) return fail('Session not found.')

  const now = new Date()

  await db.liveSession.update({
    where: { id: sessionId },
    data: {
      status,
      ...(status === 'LIVE' && !session.actualStart ? { actualStart: now } : {}),
      ...(status === 'ENDED' ? { actualEnd: now } : {}),
      // Re-opening a session that was ended by mistake has to clear the end
      // stamp, or it stays "over" no matter what the status says.
      ...(status === 'LIVE' ? { actualEnd: null } : {}),
    },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: 'session.status_changed',
    entityType: 'LiveSession',
    entityId: sessionId,
    meta: { from: session.status, to: status, title: session.title },
  })

  revalidateSession(session.batchId)
  return { ok: true }
}

export async function deleteLiveSession(sessionId: string): Promise<ActionResult> {
  const auth = await authorizeRequest('session:manage')
  if (!auth.ok) return fail('You do not have permission to manage sessions.')

  const session = await db.liveSession.findUnique({
    where: { id: sessionId },
    select: {
      title: true,
      batchId: true,
      _count: { select: { attendance: true, gatedLessons: true } },
    },
  })
  if (!session) return fail('Session not found.')

  // Attendance cascades from the session, so deleting one erases its register.
  if (session._count.attendance > 0) {
    return fail(
      `${session._count.attendance} attendance record(s) belong to this session. Cancel it instead — deleting it would erase the register.`,
    )
  }

  // Gated lessons are worse than they look: the foreign key is SetNull, so the
  // lesson keeps releaseMode = AFTER_SESSION with no gate, which the resolver
  // treats as MISCONFIGURED and leaves locked forever.
  if (session._count.gatedLessons > 0) {
    return fail(
      `${session._count.gatedLessons} lesson(s) unlock after this session. Point them at another session first, or they will never unlock.`,
    )
  }

  await db.liveSession.delete({ where: { id: sessionId } })

  await recordAudit({
    actorId: auth.user.id,
    action: 'session.deleted',
    entityType: 'LiveSession',
    entityId: sessionId,
    meta: { title: session.title },
  })

  revalidateSession(session.batchId)
  return { ok: true }
}

// -----------------------------------------------------------------------------
// Attendance
// -----------------------------------------------------------------------------

const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']

function isAttendanceStatus(value: string): value is AttendanceStatus {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(value)
}

async function authorizeMarking(
  sessionId: string,
): Promise<
  | { ok: true; actorId: string; batchId: string | null }
  | { ok: false; result: ActionResult }
> {
  const auth = await authorizeRequest('attendance:mark')
  if (!auth.ok) return { ok: false, result: fail('You do not have permission to mark attendance.') }

  const session = await db.liveSession.findUnique({
    where: { id: sessionId },
    select: { id: true, batchId: true, tracksAttendance: true, status: true },
  })
  if (!session) return { ok: false, result: fail('Session not found.') }

  if (!session.tracksAttendance) {
    return { ok: false, result: fail('This session does not track attendance.') }
  }

  if (session.status === 'CANCELLED') {
    return { ok: false, result: fail('This session was cancelled, so there is no register to take.') }
  }

  return { ok: true, actorId: auth.user.id, batchId: session.batchId }
}

/** Marks one student. */
export async function markAttendance(
  sessionId: string,
  formData: FormData,
): Promise<ActionResult> {
  const gate = await authorizeMarking(sessionId)
  if (!gate.ok) return gate.result

  const userId = String(formData.get('userId') ?? '').trim()
  const status = String(formData.get('status') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  if (!userId) return fail('No student was named.')
  if (!isAttendanceStatus(status)) return fail('That is not a valid attendance status.')

  await applyAttendance(sessionId, [{ userId, status, note: note || null }], gate.actorId)

  await recordAudit({
    actorId: gate.actorId,
    action: 'attendance.marked',
    entityType: 'LiveSession',
    entityId: sessionId,
    meta: { userId, status },
  })

  revalidatePath(`/admin/attendance/${sessionId}`)
  if (gate.batchId) revalidatePath(`/admin/batches/${gate.batchId}`)
  return { ok: true }
}

/**
 * Marks the whole register in one submit.
 *
 * The form posts `status:<userId>` per row, which is how the register is
 * actually taken: default everyone to one value, change the handful who differ,
 * save once. Rows with no value are skipped rather than defaulted, so a partial
 * form cannot silently mark absent students who were never considered.
 */
export async function bulkMarkAttendance(
  sessionId: string,
  formData: FormData,
): Promise<MarkResult> {
  const gate = await authorizeMarking(sessionId)
  if (!gate.ok) return gate.result

  const marks: AttendanceMark[] = []
  const seen = new Set<string>()

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('status:')) continue

    const userId = key.slice('status:'.length)
    const status = String(value).trim()
    if (!userId || seen.has(userId)) continue
    if (!status || !isAttendanceStatus(status)) continue

    seen.add(userId)
    const note = String(formData.get(`note:${userId}`) ?? '').trim()
    marks.push({ userId, status, note: note || null })
  }

  if (marks.length === 0) return fail('Nothing to save — no attendance was set.')

  // Everyone marked must be a real user; a hand-crafted post must not create
  // attendance rows for arbitrary ids.
  const users = await db.user.findMany({
    where: { id: { in: marks.map((mark) => mark.userId) } },
    select: { id: true },
  })
  const known = new Set(users.map((user) => user.id))
  const valid = marks.filter((mark) => known.has(mark.userId))

  if (valid.length === 0) return fail('None of those students exist.')

  await applyAttendance(sessionId, valid, gate.actorId)

  await recordAudit({
    actorId: gate.actorId,
    action: 'attendance.bulk_marked',
    entityType: 'LiveSession',
    entityId: sessionId,
    meta: { marked: valid.length },
  })

  revalidatePath(`/admin/attendance/${sessionId}`)
  if (gate.batchId) revalidatePath(`/admin/batches/${gate.batchId}`)
  return { ok: true, marked: valid.length }
}
