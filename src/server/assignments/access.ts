/**
 * Assignment and submission access authorization.
 *
 * The single decision point for "may this person see / submit / grade this
 * assignment", used by the student pages, the admin grading console and every
 * server action that mutates submissions. One function per question with two
 * consumers each — mirroring ../catalog/access.ts and ../sessions/visibility.ts
 * — so a page that renders an assignment while its action endpoint rejects the
 * submission (or vice versa) is the bug this prevents.
 *
 * ── SCOPE RULE ────────────────────────────────────────────────────────────
 * An assignment with no `courseId` and no `batchId` has no audience
 * resolvable from the roster. The notification anchor code already drops such
 * assignments as drafts-in-all-but-name; the access code reads it the same
 * way: students get `NO_SCOPE`, staff bypass. Never silently visible-to-all.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { db } from '@/server/db'
import { isStaffRole, roleHasPermission } from '@/server/auth/roles'
import type { EnrollmentStatus, PublishStatus, Role, SubmissionStatus } from '@/generated/prisma/enums'

export type AssignmentDenialReason =
  | 'NOT_FOUND'
  | 'NOT_AUTHENTICATED'
  | 'NOT_PUBLISHED'
  | 'NOT_ENROLLED'
  | 'NOT_IN_BATCH'
  | 'SCORE_NOT_RELEASED'
  | 'NO_SCOPE'

export type AssignmentVia = 'ENROLLMENT' | 'BATCH' | 'STAFF'

export type AssignmentVisibilityDecision =
  | { visible: true; via: AssignmentVia }
  | { visible: false; reason: AssignmentDenialReason; warning?: string }

/** Enrollment states that grant access to course and batch assignments. */
export const ACCESS_BEARING_STATUSES: readonly EnrollmentStatus[] = ['ACTIVE', 'COMPLETED']

export interface AssignmentSubject {
  status: PublishStatus
  /** null on a batch-only assignment. */
  courseId: string | null
  /** null on a course-scoped or scopeless assignment. */
  batchId: string | null
}

export interface AssignmentViewer {
  id: string
  role: Role
  /** Courses the viewer holds an access-bearing enrollment for. */
  courseIds: readonly string[]
  /** Batches from those same enrollments. */
  batchIds: readonly string[]
  /** Whether the viewer holds `assignment:manage` (CRUD + grade) or any lesser role. */
  canManage: boolean
  /** Whether the viewer holds `assignment:grade`. */
  canGrade: boolean
}

/**
 * May the viewer see this assignment at all?
 *
 * The prefilter in `listAssignmentsForViewer` returns candidate rows; this is
 * the authority. Encoding the rule in SQL would mean two implementations of
 * one authorization decision, which drift — and a student-scoped boolean in
 * the WHERE clause is the place a forgotten `status: PUBLISHED` would ship the
 * wrong direction.
 */
export function decideAssignmentVisibility(
  assignment: AssignmentSubject,
  viewer: AssignmentViewer | null,
): AssignmentVisibilityDecision {
  // Staff bypass — instructors review draft assignments before the cohort
  // reaches them, admins audit. The bypass is unconditional, including for an
  // ARCHIVED assignment, because the grading console still needs the history.
  if (viewer && isStaffRole(viewer.role)) return { visible: true, via: 'STAFF' }

  if (assignment.status !== 'PUBLISHED') {
    return { visible: false, reason: 'NOT_PUBLISHED' }
  }

  if (!viewer) return { visible: false, reason: 'NOT_AUTHENTICATED' }

  // Batch-scoped assignment wins over course scope — a student in the cohort
  // sees it; a student enrolled in the course but in a different batch does
  // not, because the deadline and grade weight belong to that batch's run.
  if (assignment.batchId !== null) {
    return viewer.batchIds.includes(assignment.batchId)
      ? { visible: true, via: 'BATCH' }
      : { visible: false, reason: 'NOT_IN_BATCH' }
  }

  // Course-scoped assignment: any active enrollment in the course sees it.
  if (assignment.courseId !== null) {
    return viewer.courseIds.includes(assignment.courseId)
      ? { visible: true, via: 'ENROLLMENT' }
      : { visible: false, reason: 'NOT_ENROLLED' }
  }

  // No scope at all — neither batch nor course. Read as "draft in all but
  // name", matching the notification anchor code's drop. Students do not see
  // it. Staff caught by the bypass above.
  return {
    visible: false,
    reason: 'NO_SCOPE',
    warning: 'Assignment is attached to neither a batch nor a course.',
  }
}

export type SubmissionWriteDenialReason =
  | 'NOT_FOUND'
  | 'NOT_AUTHENTICATED'
  | 'NOT_PUBLISHED'
  | 'NOT_ENROLLED'
  | 'NOT_IN_BATCH'
  | 'NO_SCOPE'
  | 'PAST_DUE_NO_LATE'
  | 'ALREADY_GRADED'
  | 'RESUBMIT_NOT_REQUESTED'

export type SubmissionWriteDecision =
  | { canSubmit: true }
  | { canSubmit: false; reason: SubmissionWriteDenialReason }

/**
 * May the viewer submit (or resubmit) a `Assignment` right now?
 *
 * Enforces the late policy at decision time, since `dueAt` itself is a moment
 * the viewer crosses naturally — a submission that was on time when the form
 * rendered can be past due by the time the user hits Submit, and that drift is
 * not a bug to surface to the user. `allowLateSubmission` is per-assignment.
 */
export function decideCanSubmit(
  assignment: AssignmentSubject & {
    dueAt: Date | null
    allowLateSubmission: boolean
  },
  submission: { status: SubmissionStatus } | null,
  viewer: AssignmentViewer | null,
  now: Date,
): SubmissionWriteDecision {
  if (!viewer) return { canSubmit: false, reason: 'NOT_AUTHENTICATED' }
  if (assignment.status !== 'PUBLISHED') return { canSubmit: false, reason: 'NOT_PUBLISHED' }

  // Lifecycle first: a submission that already exists has its own state machine,
  // and the most actionable answer is the one about the row the student already
  // touches. A GRADED row needs the grader to reopen; a SUBMITTED one is held by
  // the grader. These resolve before the roster, which can lapse underneath a
  // submission that still belongs to the student as a record.
  if (submission?.status === 'GRADED') {
    return { canSubmit: false, reason: 'ALREADY_GRADED' }
  }
  if (submission?.status === 'SUBMITTED') {
    return { canSubmit: false, reason: 'RESUBMIT_NOT_REQUESTED' }
  }
  // DRAFT means the student is mid-write and may submit or overwrite freely.
  // RESUBMIT_REQUESTED means the grader returned it with feedback for a do-over.
  // No submission (null) means the student has not started yet.

  // The roster check mirrors decideAssignmentVisibility. A student whose
  // enrollment lapsed since the page rendered cannot get a NEW submission onto
  // a course-scoped assignment — but a DRAFT they were already writing keeps
  // going, because the row survives the roster lapse as their record.
  if (submission === null) {
    if (assignment.batchId !== null && !viewer.batchIds.includes(assignment.batchId)) {
      return { canSubmit: false, reason: 'NOT_IN_BATCH' }
    }
    if (assignment.batchId === null && assignment.courseId !== null) {
      if (!viewer.courseIds.includes(assignment.courseId)) {
        return { canSubmit: false, reason: 'NOT_ENROLLED' }
      }
    }
    if (assignment.batchId === null && assignment.courseId === null) {
      return { canSubmit: false, reason: 'NO_SCOPE' }
    }
  }

  // Late policy. The graded/under-review paths returned above; the only writer
  // reaching here is a student with a DRAFT/RESUBMIT row or none at all.
  if (assignment.dueAt !== null && now > assignment.dueAt && !assignment.allowLateSubmission) {
    return { canSubmit: false, reason: 'PAST_DUE_NO_LATE' }
  }

  return { canSubmit: true }
}

/**
 * May the viewer grade (or mark return-for-resubmit) this submission's row?
 * Granted by `assignment:grade` — instructor, admin, owner. The author of a
 * submission may not grade their own work: that would be the only way
 * `maxScore` could be set by the very person who wrote the answer, which
 * defeats the role split the matrix is built around.
 */
export function decideCanGrade(
  viewer: AssignmentViewer | null,
  submission: { userId: string } | null,
): boolean {
  if (!viewer || !submission) return false
  if (!viewer.canGrade) return false
  // The grader cannot be the submitter. Authoring a submission then grading it
  // is the self-grant the role split is designed to prevent.
  if (submission.userId === viewer.id) return false
  return true
}

/**
 * The viewer's enrollment footprint, loaded once and reused for every
 * assignment on the page. The same shape the chat and session subsystems use is
 * its own name — the per-page N-query problem is what the loader is for.
 */
export async function loadAssignmentViewer(
  viewerId: string | null,
): Promise<AssignmentViewer | null> {
  if (!viewerId) return null

  const user = await db.user.findUnique({
    where: { id: viewerId },
    select: { id: true, role: true, status: true },
  })

  // A suspended account is treated as absent rather than as a viewer.
  if (!user || user.status !== 'ACTIVE') return null

  const enrollments = await db.enrollment.findMany({
    where: { userId: user.id, status: { in: [...ACCESS_BEARING_STATUSES] } },
    select: { courseId: true, batchId: true },
  })

  return {
    id: user.id,
    role: user.role,
    courseIds: [...new Set(enrollments.map((row) => row.courseId))],
    batchIds: enrollments.flatMap((row) => (row.batchId ? [row.batchId] : [])),
    canManage: roleHasPermission(user.role, 'assignment:manage'),
    canGrade: roleHasPermission(user.role, 'assignment:grade'),
  }
}
