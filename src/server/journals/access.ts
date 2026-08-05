/**
 * Journal access authorization.
 *
 * One decision point per question, consulted by the journal pages and every
 * server action that writes a journal entry or comment — the same posture as
 * chat/membership.ts and assignments/access.ts. A stale page (post-enrollment-
 * lapse, post-archive) cannot get a write in; the client passing ids is a
 * hint, not authority.
 *
 * Visibility of an *entry* depends on the entry's `visibility` field plus the
 * viewer's relationship to the author and the batch:
 *  - PRIVATE     — author + reviewer only
 *  - INSTRUCTORS — author + any staff
 *  - BATCH       — author + batch members + staff
 *  - PUBLIC      — any signed-in user
 *
 * Staff with `journal:review` always bypass — the review console must see every
 * entry regardless of the visibility the student chose, or there'd be no way
 * to grade privately-logged work.
 */

import { db } from '@/server/db'
import { isStaffRole, roleHasPermission } from '@/server/auth/roles'
import type { JournalVisibility, Role } from '@/generated/prisma/enums'

export type JournalVisibilityDenialReason =
  | 'NOT_AUTHENTICATED'
  | 'JOURNAL_DISABLED'
  | 'NOT_FOUND'

export type JournalEntryDenialReason =
  | 'NOT_AUTHENTICATED'
  | 'JOURNAL_DISABLED'
  | 'NOT_FOUND'
  | 'NOT_AUTHORIZED'

export interface JournalDefinitionSubject {
  enabled: boolean
  studentAuthored: boolean
}

export interface JournalViewer {
  id: string
  role: Role
  /** Holds journal:review — staff visibility bypass + comment access. */
  canReview: boolean
  /** Holds journal:define — instructor-only journal authoring + admin CRUD. */
  canDefine: boolean
  /** Batches the viewer is a member of, for BATCH-scoped entries. */
  batchIds: readonly string[]
}

/**
 * May the viewer list / open this journal definition at all?
 *
 * Enabled journals are visible to *every* signed-in member — the nav and the
 * list both surface them — but instructor-only journals are not authorable by
 * students; `decideCanAuthor` handles the write split.
 */
export function decideJournalVisibility(
  definition: JournalDefinitionSubject,
  viewer: JournalViewer | null,
): { visible: true } | { visible: false; reason: JournalVisibilityDenialReason } {
  if (!definition.enabled) return { visible: false, reason: 'JOURNAL_DISABLED' }
  if (!viewer) return { visible: false, reason: 'NOT_AUTHENTICATED' }
  return { visible: true }
}

/**
 * May the viewer write an entry into this journal? A student-authored journal
 * is open to everyone signed in. An instructor-only journal needs
 * `journal:define` — the split is how the proposal's "mentors log on behalf
 * of a student" and "students self-log trades" share one table.
 */
export function decideCanAuthor(
  definition: JournalDefinitionSubject,
  viewer: JournalViewer | null,
): boolean {
  if (!definition.enabled) return false
  if (!viewer) return false
  if (definition.studentAuthored) return true
  return viewer.canDefine
}

export interface JournalEntrySubject {
  authorId: string
  visibility: JournalVisibility
  /** null on a non-batch-visible entry, or a batch-scoped entry whose batch we did not load. */
  batchId: string | null
}

/**
 * May the viewer *see* a particular entry? Visibility starts from the entry's
 * own `visibility` field and short-circuits on the reviewer bypass — a mentor
 * with `journal:review` sees everything so the review console is not blind to
 * private work.
 */
export function decideEntryVisibility(
  entry: JournalEntrySubject,
  viewer: JournalViewer | null,
): { visible: true } | { visible: false; reason: JournalEntryDenialReason } {
  if (!viewer) return { visible: false, reason: 'NOT_AUTHENTICATED' }

  // The author always sees their own entry. An instructor who logged on a
  // student's behalf sets subjectUserId to that student; the *author* still
  // sees it, and the subject sees it only through the staff bypass below.
  if (entry.authorId === viewer.id) return { visible: true }

  // Reviewer bypass — mentors see every entry regardless of visibility.
  if (viewer.canReview) return { visible: true }

  switch (entry.visibility) {
    case 'PRIVATE':
      // Only author + reviewer (handled above). A non-reviewer who is not the
      // author gets NOT_AUTHORIZED, not NOT_FOUND — the entry exists, they are
      // simply not permitted to see it. Matches the 404-over-403 posture for
      // routes, but per-entry within a list we return nothing rather than
      // surface existence.
      return { visible: false, reason: 'NOT_AUTHORIZED' }

    case 'INSTRUCTORS':
      // Any staff member sees the entry, not only reviewers. An instructor
      // without the review permission still needs to see student work their
      // mentees hand in.
      if (isStaffRole(viewer.role)) return { visible: true }
      return { visible: false, reason: 'NOT_AUTHORIZED' }

    case 'BATCH':
      // Batch members see each other's entries. A student in the same batch
      // can review peer work; a student in a different batch cannot.
      if (entry.batchId !== null && viewer.batchIds.includes(entry.batchId)) {
        return { visible: true }
      }
      // Staff without the review permission can see BATCH entries — an
      // instructor assigned to a batch needs to read peer work from it. This
      // catches the *valid* batch case (different batch, but still staff). A
      // malformed entry with `batchId === null` closes here, leaving only the
      // reviewer bypass above; that keeps a data bug from leaking private work
      // to every staff member who never stood in front of this cohort.
      if (entry.batchId !== null && isStaffRole(viewer.role)) return { visible: true }
      return { visible: false, reason: 'NOT_AUTHORIZED' }

    case 'PUBLIC':
      // Any signed-in member. The reader's identity matters only for write
      // surfaces like comments; the read surface is open.
      return { visible: true }
  }
}

export type JournalCommentDenialReason = 'NOT_AUTHENTICATED' | 'NOT_AUTHORIZED'

/**
 * May the viewer comment on this entry? Slightly tighter than read visibility
 * — a PRIVATE entry cannot be commented on by a non-reviewer even if they
 * could see it some other way, and BATCH entry comments are author + staff +
 * batch members (peer review). PUBLIC entries are open to comments from any
 * signed-in member.
 */
export function decideCanComment(
  entry: JournalEntrySubject,
  viewer: JournalViewer | null,
): { ok: true } | { ok: false; reason: JournalCommentDenialReason } {
  if (!viewer) return { ok: false, reason: 'NOT_AUTHENTICATED' }
  if (entry.authorId === viewer.id) return { ok: true }
  if (viewer.canReview) return { ok: true }

  switch (entry.visibility) {
    case 'PRIVATE':
      return { ok: false, reason: 'NOT_AUTHORIZED' }
    case 'INSTRUCTORS':
      if (isStaffRole(viewer.role)) return { ok: true }
      return { ok: false, reason: 'NOT_AUTHORIZED' }
    case 'BATCH':
      if (entry.batchId !== null && viewer.batchIds.includes(entry.batchId)) {
        return { ok: true }
      }
      // Defensive against the same malformed null-batchId case as the read
      // path: a non-reviewer staff member cannot comment on a batchless BATCH
      // entry — that is the reviewer's job.
      if (entry.batchId !== null && isStaffRole(viewer.role)) return { ok: true }
      return { ok: false, reason: 'NOT_AUTHORIZED' }
    case 'PUBLIC':
      return { ok: true }
  }
}

/**
 * Loads the per-page journal viewer — the user row plus their batch memberships
 * and the two journal permissions. One query per request thanks to the cache in
 * rbac.ts; same shape as loadAssignmentViewer.
 */
export async function loadJournalViewer(
  viewerId: string | null,
): Promise<JournalViewer | null> {
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
    canReview: roleHasPermission(user.role, 'journal:review'),
    canDefine: roleHasPermission(user.role, 'journal:define'),
    batchIds: enrollments.flatMap((row) => (row.batchId ? [row.batchId] : [])),
  }
}
