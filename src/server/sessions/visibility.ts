/**
 * Live session visibility.
 *
 * The single decision point for "may this person see this session", used by the
 * student list, the session detail page and anything that later joins or
 * notifies. One function with two consumers is the point: a timetable that hides
 * a session while its detail page still renders the join URL is exactly the bug
 * this prevents.
 *
 * Split into a pure `decideSessionVisibility` and thin database wrappers, the
 * way ../catalog/access.ts is, so the whole matrix — four visibility modes, four
 * viewer shapes, staff bypass, misconfiguration — is testable without fixtures.
 *
 * ── ON `SessionVisibility.ROLE` ──────────────────────────────────────────────
 * The enum has a ROLE member but the schema carries no column naming which roles.
 * It is therefore read as STAFF ONLY: an internal session — a mentor sync, a
 * rehearsal — that students must not see. Reading it as "everyone" would be the
 * unsafe default for a value whose intent is plainly restrictive. If per-role
 * targeting is ever needed it wants a `visibleToRoles` column, not a guess here.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { db } from '@/server/db'
import { isStaffRole } from '@/server/auth/roles'
import type { EnrollmentStatus, Role, SessionVisibility } from '@/generated/prisma/enums'

export type SessionDenialReason =
  | 'NOT_FOUND'
  | 'NOT_AUTHENTICATED'
  | 'NOT_ENROLLED'
  | 'NOT_IN_BATCH'
  | 'STAFF_ONLY'
  /** Rule cannot be applied as written — e.g. BATCH visibility with no batch. */
  | 'MISCONFIGURED'

/** How visibility was granted. */
export type SessionVisibilityVia = 'PUBLIC' | 'ENROLLMENT' | 'BATCH' | 'STAFF'

export type SessionVisibilityDecision =
  | { visible: true; via: SessionVisibilityVia }
  | { visible: false; reason: SessionDenialReason; warning?: string }

export interface VisibilitySubject {
  visibility: SessionVisibility
  batchId: string | null
  courseId: string | null
}

export interface SessionViewer {
  id: string
  role: Role
  /** Courses the viewer holds an access-bearing enrollment for. */
  courseIds: readonly string[]
  /** Batches from those same enrollments. */
  batchIds: readonly string[]
}

/**
 * Enrollment states that put a student on a timetable. Matches the course-access
 * rule in ../catalog/access.ts: COMPLETED still conveys access, because finishing
 * a course should not erase the recordings of the classes they attended.
 */
export const ROSTERED_STATUSES: readonly EnrollmentStatus[] = ['ACTIVE', 'COMPLETED']

export function decideSessionVisibility(
  session: VisibilitySubject,
  viewer: SessionViewer | null,
): SessionVisibilityDecision {
  // Staff see the whole timetable: an instructor has to be able to open the
  // session they are about to host, and admins must be able to verify what they
  // configured before a cohort sees it.
  if (viewer && isStaffRole(viewer.role)) return { visible: true, via: 'STAFF' }

  switch (session.visibility) {
    case 'PUBLIC':
      // Marketing surface — a free webinar is meant to be reachable by someone
      // who has not signed up yet.
      return { visible: true, via: 'PUBLIC' }

    case 'ENROLLED': {
      if (!viewer) return { visible: false, reason: 'NOT_AUTHENTICATED' }

      // No course attached: open to every enrolled student, which is how an
      // academy-wide broadcast is expressed.
      if (session.courseId === null) {
        return viewer.courseIds.length > 0
          ? { visible: true, via: 'ENROLLMENT' }
          : { visible: false, reason: 'NOT_ENROLLED' }
      }

      return viewer.courseIds.includes(session.courseId)
        ? { visible: true, via: 'ENROLLMENT' }
        : { visible: false, reason: 'NOT_ENROLLED' }
    }

    case 'BATCH': {
      if (!viewer) return { visible: false, reason: 'NOT_AUTHENTICATED' }

      // A batch-only session with no batch has no audience it could mean. Staying
      // hidden is the safe reading; the warning is what gets it fixed.
      if (session.batchId === null) {
        return {
          visible: false,
          reason: 'MISCONFIGURED',
          warning: 'Session is visible to its batch only, but no batch is attached.',
        }
      }

      return viewer.batchIds.includes(session.batchId)
        ? { visible: true, via: 'BATCH' }
        : { visible: false, reason: 'NOT_IN_BATCH' }
    }

    case 'ROLE':
      // See the module note: no column names the roles, so this is staff-only and
      // the staff bypass above has already returned for them.
      return { visible: false, reason: viewer ? 'STAFF_ONLY' : 'NOT_AUTHENTICATED' }

    default: {
      // Exhaustiveness guard: a new SessionVisibility fails the build here rather
      // than silently defaulting to visible.
      const exhaustive: never = session.visibility
      throw new Error(`Unhandled session visibility: ${String(exhaustive)}`)
    }
  }
}

/**
 * The viewer's enrollment footprint, in one query.
 *
 * Loaded once and reused for every session on the page — asking per session would
 * turn a timetable into N round trips.
 */
export async function loadSessionViewer(viewerId: string | null): Promise<SessionViewer | null> {
  if (!viewerId) return null

  const user = await db.user.findUnique({
    where: { id: viewerId },
    select: { id: true, role: true, status: true },
  })

  // A suspended account is treated as absent rather than as a viewer.
  if (!user || user.status !== 'ACTIVE') return null

  const enrollments = await db.enrollment.findMany({
    where: { userId: user.id, status: { in: [...ROSTERED_STATUSES] } },
    select: { courseId: true, batchId: true },
  })

  return {
    id: user.id,
    role: user.role,
    courseIds: [...new Set(enrollments.map((row) => row.courseId))],
    batchIds: enrollments.flatMap((row) => (row.batchId ? [row.batchId] : [])),
  }
}

/** Session fields safe to hand to a student surface. `streamKey` is never here. */
export interface ViewableSession {
  id: string
  kind: 'CLASS' | 'BROADCAST' | 'WEBINAR' | 'DOUBT_CLEARING' | 'EVENT'
  title: string
  description: string | null
  scheduledStart: Date
  scheduledEnd: Date | null
  actualEnd: Date | null
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  mode: 'ONLINE' | 'OFFLINE' | 'HYBRID'
  location: string | null
  joinUrl: string | null
  recordingAssetId: string | null
  batchName: string | null
  courseTitle: string | null
  hostName: string | null
}

/**
 * Column list for viewer-facing reads.
 *
 * Explicit rather than a bare `findMany` because `LiveSession` holds `streamKey`:
 * a default select would ship a broadcaster's ingest credential into the page
 * payload, and anyone with it could go live as the academy.
 */
const VIEWABLE_SELECT = {
  id: true,
  kind: true,
  title: true,
  description: true,
  scheduledStart: true,
  scheduledEnd: true,
  actualEnd: true,
  status: true,
  mode: true,
  visibility: true,
  location: true,
  joinUrl: true,
  recordingAssetId: true,
  batchId: true,
  courseId: true,
  batch: { select: { name: true } },
  course: { select: { title: true } },
  host: { select: { name: true } },
} as const

interface SessionRow {
  id: string
  kind: ViewableSession['kind']
  title: string
  description: string | null
  scheduledStart: Date
  scheduledEnd: Date | null
  actualEnd: Date | null
  status: ViewableSession['status']
  mode: ViewableSession['mode']
  visibility: SessionVisibility
  location: string | null
  joinUrl: string | null
  recordingAssetId: string | null
  batchId: string | null
  courseId: string | null
  batch: { name: string } | null
  course: { title: string } | null
  host: { name: string } | null
}

function toViewable(row: SessionRow): ViewableSession {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    actualEnd: row.actualEnd,
    status: row.status,
    mode: row.mode,
    location: row.location,
    joinUrl: row.joinUrl,
    recordingAssetId: row.recordingAssetId,
    batchName: row.batch?.name ?? null,
    courseTitle: row.course?.title ?? null,
    hostName: row.host?.name ?? null,
  }
}

export interface SessionListOptions {
  /** `upcoming` orders ascending from now; `past` orders descending. */
  window: 'upcoming' | 'past'
  now?: Date
  take?: number
}

/**
 * Sessions a viewer may see, in one query plus an in-memory decision.
 *
 * The query is a coarse prefilter for size only — every row it returns is still
 * put through `decideSessionVisibility`. Encoding the whole rule in SQL would
 * mean two implementations of one authorization decision, which drift.
 */
export async function listVisibleSessions(
  viewer: SessionViewer | null,
  options: SessionListOptions,
): Promise<ViewableSession[]> {
  const now = options.now ?? new Date()
  const take = options.take ?? 50
  const upcoming = options.window === 'upcoming'

  const staff = viewer !== null && isStaffRole(viewer.role)

  const audience = staff
    ? undefined
    : {
        OR: [
          { visibility: 'PUBLIC' as const },
          ...(viewer
            ? [
                { visibility: 'ENROLLED' as const, courseId: null },
                { visibility: 'ENROLLED' as const, courseId: { in: [...viewer.courseIds] } },
                { visibility: 'BATCH' as const, batchId: { in: [...viewer.batchIds] } },
              ]
            : []),
        ],
      }

  const rows = await db.liveSession.findMany({
    where: {
      ...audience,
      // A cancelled class stays on the upcoming list: students who planned around
      // it need to see that it is off, not find it silently missing.
      scheduledStart: upcoming ? { gte: now } : { lt: now },
    },
    select: VIEWABLE_SELECT,
    orderBy: { scheduledStart: upcoming ? 'asc' : 'desc' },
    take,
  })

  return rows
    .filter((row) => decideSessionVisibility(row, viewer).visible)
    .map((row) => toViewable(row))
}

export interface SessionAccessResult {
  decision: SessionVisibilityDecision
  session: ViewableSession | null
}

/** Loads one session and resolves visibility. Callers should 404 on any denial. */
export async function loadSessionForViewer(
  sessionId: string,
  viewer: SessionViewer | null,
): Promise<SessionAccessResult> {
  const row = await db.liveSession.findUnique({
    where: { id: sessionId },
    select: VIEWABLE_SELECT,
  })

  if (!row) {
    return { decision: { visible: false, reason: 'NOT_FOUND' }, session: null }
  }

  const decision = decideSessionVisibility(row, viewer)
  return { decision, session: decision.visible ? toViewable(row) : null }
}
