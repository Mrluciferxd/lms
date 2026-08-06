/**
 * Tracker access authorization.
 *
 * Reads are uniform — every signed-in member lists every *enabled* tracker
 * definition — but the record each definition points at is scoped, and the
 * write surface is split by that scope:
 *
 *  STUDENT  — one record per user. The owner may update it, except for EXPIRY,
 *             which models a grant of access (test-series validity, a licence
 *             expiry) and is staff-only by construction.
 *  BATCH    — one record per batch. Only `tracker:manage` may touch it; a
 *             student sees the value for batches they belong to.
 *  GLOBAL   — a single org-wide record. Staff-only write.
 *
 * As with journals and chat, the client passing ids is a hint, not authority:
 * every server action re-checks `decideCanUpdateRecord` against the live user
 * row before it upserts.
 */

import { db } from '@/server/db'
import { roleHasPermission } from '@/server/auth/roles'
import type { Role, TrackerScope, TrackerType } from '@/generated/prisma/enums'

export type TrackerReadDenialReason = 'NOT_AUTHENTICATED' | 'TRACKER_DISABLED'

export interface TrackerDefinitionSubject {
  enabled: boolean
  scope: TrackerScope
  type: TrackerType
}

/**
 * May the viewer list / open this tracker definition?
 *
 * A disabled tracker 404s on a direct URL — hiding the nav link is not gating,
 * the same rule the widget and journal surfaces follow. Every signed-in member
 * otherwise sees enabled trackers; the record each one points at is scoped
 * separately by the read queries.
 */
export function decideTrackerRead(
  definition: TrackerDefinitionSubject,
  viewer: TrackerViewer | null,
): { ok: true } | { ok: false; reason: TrackerReadDenialReason } {
  if (!definition.enabled) return { ok: false, reason: 'TRACKER_DISABLED' }
  if (!viewer) return { ok: false, reason: 'NOT_AUTHENTICATED' }
  return { ok: true }
}

export interface RecordSubject {
  scope: TrackerScope
  type: TrackerType
  /** Whose record this is — null for GLOBAL or an unassigned row. */
  userId: string | null
  batchId: string | null
}

/**
 * May the viewer write this tracker record?
 *
 * `tracker:manage` (ADMIN/OWNER) bypasses every case and is the only path for
 * BATCH, GLOBAL and any EXPIRY record — an expiry is a grant of access, so a
 * student self-granting one would defeat the point. A STUDENT record of any
 * non-EXPIRY type is owner-writable, which is how the proposal's "students
 * self-log progress" maps onto COUNTER/CHECKLIST/GAUGE/BOOLEAN.
 */
export function decideCanUpdateRecord(
  record: RecordSubject,
  viewer: TrackerViewer,
): { ok: true } | { ok: false; reason: TrackerWriteDenialReason } {
  if (viewer.canManage) return { ok: true }

  if (record.scope === 'STUDENT' && record.type !== 'EXPIRY' && record.userId === viewer.id) {
    return { ok: true }
  }

  return { ok: false, reason: 'NOT_AUTHORIZED' }
}

export type TrackerWriteDenialReason = 'NOT_AUTHENTICATED' | 'NOT_AUTHORIZED' | 'TRACKER_DISABLED'

export interface TrackerViewer {
  id: string
  role: Role
  /** Holds `tracker:manage` — the admin/owner bypass for every scope. */
  canManage: boolean
  /** Batches the viewer belongs to — filtered BATCH-scope reads. */
  batchIds: readonly string[]
}

/**
 * Loads the per-page tracker viewer — the user row plus batch memberships and
 * the manage permission. Mirrors `loadJournalViewer`; one request, one cache.
 */
export async function loadTrackerViewer(viewerId: string | null): Promise<TrackerViewer | null> {
  if (!viewerId) return null

  const user = await db.user.findUnique({
    where: { id: viewerId },
    select: { id: true, role: true, status: true },
  })

  if (!user || user.status !== 'ACTIVE') return null

  const enrollments = await db.enrollment.findMany({
    where: { userId: user.id, status: { in: ['ACTIVE', 'COMPLETED'] } },
    select: { batchId: true },
  })

  return {
    id: user.id,
    role: user.role,
    canManage: roleHasPermission(user.role, 'tracker:manage'),
    batchIds: enrollments.flatMap((row) => (row.batchId ? [row.batchId] : [])),
  }
}
