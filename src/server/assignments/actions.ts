/**
 * Assignment server actions — the only path to mutate assignments and
 * submissions. Every action re-checks auth + visibility + write permission,
 * because a server action is a directly invocable endpoint, not a navigation.
 * Hiding a form is not authorization. The convention matches ../chat/actions.ts
 * and ../catalog/actions.ts.
 *
 * ── STATE TRANSITIONS ──────────────────────────────────────────────────────
 *
 *   DRAFT  ──submit──>  SUBMITTED  ──grade──>  GRADED
 *                       SUBMITTED  ──requestResubmit──>  RESUBMIT_REQUESTED
 *                       RESUBMIT_REQUESTED  ──submit──>  SUBMITTED
 *
 * GRADED is terminal unless the grader explicitly reopens it (which is the
 * same `requestResubmit` action; the grader is the gate, the student is not).
 * ──────────────────────────────────────────────────────────────────────────
 */

'use server'

import { db } from '@/server/db'
import { getCurrentUser } from '@/server/auth/rbac'
import { roleHasPermission } from '@/server/auth/roles'
import {
  decideAssignmentVisibility,
  decideCanGrade,
  decideCanSubmit,
  loadAssignmentViewer,
  type AssignmentViewer,
} from './access'
import {
  isScoreInRange,
  validateAssignment,
  validateGrade,
  validateSubmission,
} from './validation'
import { loadSubmissionForViewer } from './assignments'
import type { PublishStatus, SubmissionStatus } from '@/generated/prisma/enums'

export type ActionResult<T = void> =
  | ({ ok: true; data?: T })
  | { ok: false; reason: string }

const NOT_AUTH = { ok: false, reason: 'You must be signed in.' } as const
const NOT_FOUND = { ok: false, reason: 'Assignment not found.' } as const
const NOT_ALLOWED = { ok: false, reason: 'You cannot do that here.' } as const

async function loadAssignment(assignmentId: string) {
  return db.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      status: true,
      courseId: true,
      batchId: true,
      dueAt: true,
      maxScore: true,
      allowLateSubmission: true,
    },
  })
}

async function loadViewer(): Promise<AssignmentViewer | null> {
  const user = await getCurrentUser()
  if (!user) return null
  return loadAssignmentViewer(user.id)
}

// ─── ADMIN CRUD ─────────────────────────────────────────────────────────────

export interface CreatedAssignment {
  id: string
}

/**
 * Creates an assignment. `assignment:manage` only. A course-only assignment is
 * visible to every active enrollment in that course; a batch-only assignment is
 * visible only to the batch's roster; both set narrows to the batch (matches
 * the visibility decision in access.ts).
 */
export async function createAssignment(input: {
  title: string
  instructions?: string | null
  courseId?: string | null
  batchId?: string | null
  lessonId?: string | null
  dueAt?: Date | null
  maxScore?: number | null
  allowLateSubmission?: boolean
  attachmentIds?: string[]
}): Promise<ActionResult<CreatedAssignment>> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'assignment:manage')) return NOT_ALLOWED

  const issues = validateAssignment({
    title: input.title,
    instructions: input.instructions ?? null,
    maxScore: input.maxScore ?? null,
    dueAt: input.dueAt ?? null,
    attachmentIds: input.attachmentIds ?? [],
  })
  if (issues.length > 0) return { ok: false, reason: issues[0]!.message }

  // A new assignment defaults to DRAFT. Publishing is a separate explicit
  // step because publishing an assignment mid-write would let a student see
  // half-written instructions; the admin "publishes" deliberately.
  const created = await db.assignment.create({
    data: {
      title: input.title.trim(),
      instructions: input.instructions?.trim() || null,
      courseId: input.courseId ?? null,
      batchId: input.batchId ?? null,
      lessonId: input.lessonId ?? null,
      dueAt: input.dueAt ?? null,
      maxScore: input.maxScore ?? 100,
      allowLateSubmission: input.allowLateSubmission ?? true,
      attachmentIds: input.attachmentIds ?? [],
      status: 'DRAFT',
    },
    select: { id: true },
  })

  return { ok: true, data: { id: created.id } }
}

export async function updateAssignment(input: {
  assignmentId: string
  title?: string
  instructions?: string | null
  courseId?: string | null
  batchId?: string | null
  lessonId?: string | null
  dueAt?: Date | null
  maxScore?: number | null
  allowLateSubmission?: boolean
  attachmentIds?: string[]
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'assignment:manage')) return NOT_ALLOWED

  const existing = await loadAssignment(input.assignmentId)
  if (!existing) return NOT_FOUND

  // A narrowed scope is not validated against the roster — an admin may
  // deliberately reassign an assignment to a different batch. Reassigning to
  // neither course nor batch is also allowed (it stays as a draft the cohort
  // sees nothing of); the visibility decision handles publishing it later.

  // Build only the fields present in the input. `undefined` means "leave it";
  // `null` means "clear it" for the nullable columns.
  const data: Record<string, unknown> = {}
  if (input.title !== undefined) {
    const issues = validateAssignment({
      title: input.title,
      instructions: input.instructions ?? null,
      maxScore: input.maxScore ?? null,
      dueAt: input.dueAt ?? null,
      attachmentIds: input.attachmentIds ?? [],
    })
    if (issues.length > 0) return { ok: false, reason: issues[0]!.message }
    data.title = input.title.trim()
  }
  if (input.instructions !== undefined) {
    data.instructions = input.instructions?.trim() || null
  }
  if (input.courseId !== undefined) data.courseId = input.courseId
  if (input.batchId !== undefined) data.batchId = input.batchId
  if (input.lessonId !== undefined) data.lessonId = input.lessonId
  if (input.dueAt !== undefined) data.dueAt = input.dueAt
  if (input.maxScore !== undefined && input.maxScore !== null) {
    if (!Number.isInteger(input.maxScore) || input.maxScore < 0 || input.maxScore > 10_000) {
      return { ok: false, reason: 'Max score must be a whole number between 0 and 10000.' }
    }
    data.maxScore = input.maxScore
  }
  if (input.allowLateSubmission !== undefined) {
    data.allowLateSubmission = input.allowLateSubmission
  }
  if (input.attachmentIds !== undefined) {
    if (input.attachmentIds.length > 10) {
      return { ok: false, reason: 'An assignment may have at most 10 attachments.' }
    }
    data.attachmentIds = input.attachmentIds
  }

  await db.assignment.update({ where: { id: existing.id }, data })
  return { ok: true }
}

export async function setAssignmentStatus(input: {
  assignmentId: string
  status: PublishStatus
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'assignment:manage')) return NOT_ALLOWED

  const existing = await loadAssignment(input.assignmentId)
  if (!existing) return NOT_FOUND

  if (input.status === 'PUBLISHED') {
    // PUBLISHING an assignment with no course and no batch would silently
    // publish to nobody — the visibility decision reads it as NO_SCOPE. Now
    // is the best place to tell the admin, not after.
    if (!existing.courseId && !existing.batchId) {
      return {
        ok: false,
        reason: 'Cannot publish an assignment that is attached to neither a course nor a batch.',
      }
    }
  }

  await db.assignment.update({
    where: { id: existing.id },
    data: { status: input.status },
  })
  return { ok: true }
}

export async function deleteAssignment(input: {
  assignmentId: string
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'assignment:manage')) return NOT_ALLOWED

  // The grading history under a submission is the kind of thing a delete should
  // refuse to destroy. We refuse if any submission lives against the row; the
  // admin should archive instead.
  const submissionCount = await db.submission.count({
    where: { assignmentId: input.assignmentId },
  })
  if (submissionCount > 0) {
    return {
      ok: false,
      reason: 'This assignment has submissions. Archive it instead of deleting.',
    }
  }

  await db.assignment.delete({ where: { id: input.assignmentId } })
  return { ok: true }
}

// ─── STUDENT SUBMISSION ─────────────────────────────────────────────────────

export interface SubmittedPayload {
  submissionId: string
  status: SubmissionStatus
}

/**
 * Saves a draft or submits a submission. A draft is overwriteable until
 * submitted; on submit, the row becomes SUBMITTED and is graded from there.
 * `submit: false` keeps it as DRAFT so the student can iterate without the
 * grader seeing it before they're done.
 */
export async function saveSubmission(input: {
  assignmentId: string
  contentText: string
  attachmentIds?: string[]
  submit: boolean
}): Promise<ActionResult<SubmittedPayload>> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const viewer = await loadViewer()
  if (!viewer) return NOT_AUTH

  const assignment = await loadAssignment(input.assignmentId)
  if (!assignment) return NOT_FOUND

  // Re-resolve visibility — a student whose enrollment has lapsed since the
  // page rendered cannot submit to a course-scoped assignment.
  const visibility = decideAssignmentVisibility(assignment, viewer)
  if (!visibility.visible) return NOT_FOUND

  const issues = validateSubmission({
    contentText: input.contentText,
    attachmentIds: input.attachmentIds,
  })
  if (issues.length > 0) return { ok: false, reason: issues[0]!.message }

  const existing = await loadSubmissionForViewer(input.assignmentId, viewer.id)

  if (input.submit) {
    // The decision function holds both late and lifecycle rules. The decision
    // is the last guard before writing, so a submit clicked at 11:59:59 fails
    // cleanly when the server sees 12:00:01.
    const submitDecision = decideCanSubmit(assignment, existing, viewer, new Date())
    if (!submitDecision.canSubmit) {
      const reasons: Record<string, string> = {
        NOT_AUTHENTICATED: 'You must be signed in.',
        NOT_PUBLISHED: 'This assignment is not yet published.',
        NOT_ENROLLED: 'You are not enrolled in this course.',
        NOT_IN_BATCH: 'You are not in this batch.',
        NO_SCOPE: 'This assignment has no audience.',
        PAST_DUE_NO_LATE: 'The due date has passed and late submissions are not allowed.',
        ALREADY_GRADED: 'This submission has already been graded. Ask your instructor to reopen it.',
        RESUBMIT_NOT_REQUESTED:
          'Your submission is being reviewed. Wait for the grader to return it.',
      }
      return { ok: false, reason: reasons[submitDecision.reason] ?? NOT_ALLOWED.reason }
    }

    const now = new Date()
    const isLate = assignment.dueAt !== null && now > assignment.dueAt

    const upserted = await db.submission.upsert({
      where: { assignmentId_userId: { assignmentId: input.assignmentId, userId: viewer.id } },
      update: {
        contentText: input.contentText.trim() || null,
        attachmentIds: input.attachmentIds ?? [],
        status: 'SUBMITTED',
        submittedAt: now,
        isLate,
      },
      create: {
        assignmentId: input.assignmentId,
        userId: viewer.id,
        contentText: input.contentText.trim() || null,
        attachmentIds: input.attachmentIds ?? [],
        status: 'SUBMITTED',
        submittedAt: now,
        isLate,
      },
      select: { id: true, status: true },
    })

    return { ok: true, data: { submissionId: upserted.id, status: upserted.status } }
  }

  // Draft save — always allowed for the viewer that passed visibility. A
  // GRADED row being saved as a draft would lose the grade, which is a
  // moderator-only action (requestResubmit). Refuse it here.
  if (existing?.status === 'GRADED') {
    return {
      ok: false,
      reason: 'This submission has been graded. Ask your instructor to reopen it.',
    }
  }
  if (existing?.status === 'SUBMITTED') {
    // Saving as a draft over a SUBMITTED row would un-submit the work the
    // grader may already have picked up. We accept the save but bump status
    // back to DRAFT — that is the literal "I want to revise my submission"
    // action the grader hasn't asked for but the student can do unilaterally
    // before grading has started.
    await db.submission.update({
      where: { id: existing.id },
      data: {
        contentText: input.contentText.trim() || null,
        attachmentIds: input.attachmentIds ?? [],
        status: 'DRAFT',
        submittedAt: null,
        isLate: false,
      },
    })
    return { ok: true, data: { submissionId: existing.id, status: 'DRAFT' } }
  }

  const upserted = await db.submission.upsert({
    where: { assignmentId_userId: { assignmentId: input.assignmentId, userId: viewer.id } },
    update: {
      contentText: input.contentText.trim() || null,
      attachmentIds: input.attachmentIds ?? [],
    },
    create: {
      assignmentId: input.assignmentId,
      userId: viewer.id,
      contentText: input.contentText.trim() || null,
      attachmentIds: input.attachmentIds ?? [],
      status: 'DRAFT',
    },
    select: { id: true, status: true },
  })

  return { ok: true, data: { submissionId: upserted.id, status: upserted.status } }
}

// ─── GRADING ────────────────────────────────────────────────────────────────

export interface GradedPayload {
  submissionId: string
  status: SubmissionStatus
}

/**
 * Grades a submission or returns it for resubmission. `assignment:grade` only.
 * `returnForResubmit: true` sets status RESUBMIT_REQUESTED without recording a
 * score — the grader's feedback alone is the deliverable.
 *
 * Refuses to grade a self-authored submission. The grader cannot be the author
 * because grading the self would bypass the role split the matrix is built on.
 */
export async function gradeSubmission(input: {
  submissionId: string
  score?: number | null
  feedback?: string | null
  returnForResubmit?: boolean
}): Promise<ActionResult<GradedPayload>> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'assignment:grade')) return NOT_ALLOWED

  const viewer = await loadViewer()
  if (!viewer) return NOT_AUTH

  const submission = await db.submission.findUnique({
    where: { id: input.submissionId },
    select: {
      id: true,
      userId: true,
      assignmentId: true,
      status: true,
    },
  })
  if (!submission) return NOT_FOUND

  if (!decideCanGrade(viewer, { userId: submission.userId })) {
    return { ok: false, reason: 'You cannot grade your own submission.' }
  }

  const assignment = await loadAssignment(submission.assignmentId)
  if (!assignment) return NOT_FOUND

  // Only SUBMITTED submissions can be graded in one step. A RESUBMIT_REQUESTED
  // row that came back with a new submission is also fine — the student re-
  // submitted it; we grade it now. A GRADED row re-grade requires the same
  // path; the grader is reopening their own grading.
  if (submission.status !== 'SUBMITTED' && submission.status !== 'RESUBMIT_REQUESTED' && submission.status !== 'GRADED') {
    return { ok: false, reason: 'Nothing to grade yet — the submission is still a draft.' }
  }

  if (input.returnForResubmit) {
    // Returning for resubmit clears any prior score — the grader is sending it
    // back, not approving it with a number attached.
    await db.submission.update({
      where: { id: submission.id },
      data: {
        status: 'RESUBMIT_REQUESTED',
        score: null,
        feedback: input.feedback?.trim() || null,
        gradedById: user.id,
        gradedAt: new Date(),
      },
    })
    return { ok: true, data: { submissionId: submission.id, status: 'RESUBMIT_REQUESTED' } }
  }

  const issues = validateGrade({
    score: input.score ?? null,
    feedback: input.feedback ?? null,
  })
  if (issues.length > 0) return { ok: false, reason: issues[0]!.message }

  if (input.score === null || input.score === undefined) {
    return { ok: false, reason: 'A grade requires a score.' }
  }
  if (!isScoreInRange(input.score, assignment.maxScore)) {
    return {
      ok: false,
      reason: `Score must be a whole number between 0 and ${assignment.maxScore}.`,
    }
  }

  await db.submission.update({
    where: { id: submission.id },
    data: {
      status: 'GRADED',
      score: input.score,
      feedback: input.feedback?.trim() || null,
      gradedById: user.id,
      gradedAt: new Date(),
    },
  })

  return { ok: true, data: { submissionId: submission.id, status: 'GRADED' } }
}

// ─── REOPEN (staff) ─────────────────────────────────────────────────────────

/**
 * Reopens a GRADED submission back to the student as RESUBMIT_REQUESTED. Same
 * permission as grading — graders can correct their own calls.
 *
 * An alias for `gradeSubmission({ returnForResubmit: true })` kept explicit
 * because "reopen" reads clearly in the moderation UI without sounding like a
 * numeric grade.
 */
export async function reopenSubmission(input: {
  submissionId: string
  feedback?: string | null
}): Promise<ActionResult<GradedPayload>> {
  return gradeSubmission({
    submissionId: input.submissionId,
    feedback: input.feedback ?? null,
    returnForResubmit: true,
  })
}
