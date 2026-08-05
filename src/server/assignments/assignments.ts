/**
 * Assignment read queries.
 *
 * Reads only — every mutating call goes through ./actions.ts. Separation follows
 * the pattern in ../chat/channels.ts: every exported async in a `'use server'`
 * module is a callable endpoint, so report queries that take ids from the
 * caller must not live there.
 */

import { db } from '@/server/db'
import { isStaffRole } from '@/server/auth/roles'
import { decideAssignmentVisibility, type AssignmentViewer } from './access'
import type { PublishStatus, SubmissionStatus } from '@/generated/prisma/enums'

/** Fields safe to expose to a student surface. */
export interface ViewableAssignment {
  id: string
  title: string
  instructions: string | null
  courseId: string | null
  batchId: string | null
  dueAt: Date | null
  maxScore: number
  allowLateSubmission: boolean
  status: PublishStatus
  createdAt: Date
  batchName: string | null
  courseTitle: string | null
  courseSlug: string | null
}

const ASSIGNMENT_SELECT = {
  id: true,
  title: true,
  instructions: true,
  courseId: true,
  batchId: true,
  dueAt: true,
  maxScore: true,
  allowLateSubmission: true,
  status: true,
  createdAt: true,
  course: { select: { title: true, slug: true } },
  batch: { select: { name: true } },
} as const

interface AssignmentRow {
  id: string
  title: string
  instructions: string | null
  courseId: string | null
  batchId: string | null
  dueAt: Date | null
  maxScore: number
  allowLateSubmission: boolean
  status: PublishStatus
  createdAt: Date
  course: { title: string; slug: string } | null
  batch: { name: string } | null
}

function toViewable(row: AssignmentRow): ViewableAssignment {
  return {
    id: row.id,
    title: row.title,
    instructions: row.instructions,
    courseId: row.courseId,
    batchId: row.batchId,
    dueAt: row.dueAt,
    maxScore: row.maxScore,
    allowLateSubmission: row.allowLateSubmission,
    status: row.status,
    createdAt: row.createdAt,
    batchName: row.batch?.name ?? null,
    courseTitle: row.course?.title ?? null,
    courseSlug: row.course?.slug ?? null,
  }
}

/**
 * Assignments a viewer may see. The query is a coarse prefilter — every row it
 * returns is still put through `decideAssignmentVisibility`, so there is one
 * implementation of the rule. Prefiltering matters for size: a course with
 * hundreds of archived assignments would otherwise all hit the in-memory step.
 */
export async function listAssignmentsForViewer(
  viewer: AssignmentViewer,
): Promise<ViewableAssignment[]> {
  const staff = isStaffRole(viewer.role)

  const rows = await db.assignment.findMany({
    where: staff
      ? undefined
      : {
          status: 'PUBLISHED',
          OR: [
            ...(viewer.courseIds.length > 0
              ? [{ courseId: { in: [...viewer.courseIds] } }]
              : []),
            ...(viewer.batchIds.length > 0
              ? [{ batchId: { in: [...viewer.batchIds] } }]
              : []),
          ],
        },
    select: ASSIGNMENT_SELECT,
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { title: 'asc' }],
  })

  return rows
    .filter((row) => decideAssignmentVisibility(row, viewer).visible)
    .map((row) => toViewable(row))
}

/** All assignments an admin with `assignment:manage` can author and audit. */
export async function listAllAssignmentsForStaff(): Promise<ViewableAssignment[]> {
  const rows = await db.assignment.findMany({
    select: ASSIGNMENT_SELECT,
    orderBy: [{ status: 'asc' }, { dueAt: 'desc' }, { title: 'asc' }],
  })
  return rows.map((row) => toViewable(row))
}

export interface AssignmentAccessResult {
  decision: ReturnType<typeof decideAssignmentVisibility>
  assignment: ViewableAssignment | null
}

/** Loads one assignment and resolves visibility. Callers 404 on any denial. */
export async function loadAssignmentForViewer(
  assignmentId: string,
  viewer: AssignmentViewer,
): Promise<AssignmentAccessResult> {
  const row = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: ASSIGNMENT_SELECT,
  })

  if (!row) {
    return { decision: { visible: false, reason: 'NOT_FOUND' }, assignment: null }
  }

  const decision = decideAssignmentVisibility(row, viewer)
  return { decision, assignment: decision.visible ? toViewable(row) : null }
}

/** The viewer's own submission against an assignment, if one exists. */
export interface ViewableSubmission {
  id: string
  status: SubmissionStatus
  contentText: string | null
  attachmentIds: string[]
  submittedAt: Date | null
  isLate: boolean
  score: number | null
  feedback: string | null
  gradedAt: Date | null
  gradedByName: string | null
  createdAt: Date
  updatedAt: Date
}

export async function loadSubmissionForViewer(
  assignmentId: string,
  viewerId: string,
): Promise<ViewableSubmission | null> {
  const row = await db.submission.findUnique({
    where: { assignmentId_userId: { assignmentId, userId: viewerId } },
    select: {
      id: true,
      status: true,
      contentText: true,
      attachmentIds: true,
      submittedAt: true,
      isLate: true,
      score: true,
      feedback: true,
      gradedAt: true,
      gradedBy: { select: { name: true } },
      createdAt: true,
      updatedAt: true,
    },
  })

  if (!row) return null
  return {
    id: row.id,
    status: row.status,
    contentText: row.contentText,
    attachmentIds: row.attachmentIds,
    submittedAt: row.submittedAt,
    isLate: row.isLate,
    score: row.score,
    feedback: row.feedback,
    gradedAt: row.gradedAt,
    gradedByName: row.gradedBy?.name ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * A submission and its author for the grading console. Includes the author's
 * name and email — staff with `assignment:grade` see who submitted; that is
 * the whole point of a grading console.
 */
export interface GradingQueueRow {
  submission: ViewableSubmission
  authorId: string
  authorName: string
  authorEmail: string | null
}

export async function loadGradingQueue(
  assignmentId: string,
): Promise<GradingQueueRow[]> {
  const rows = await db.submission.findMany({
    where: { assignmentId },
    select: {
      id: true,
      status: true,
      contentText: true,
      attachmentIds: true,
      submittedAt: true,
      isLate: true,
      score: true,
      feedback: true,
      gradedAt: true,
      gradedBy: { select: { name: true } },
      createdAt: true,
      updatedAt: true,
      userId: true,
      user: { select: { name: true, email: true } },
    },
    // SUBMITTED first (these are the deliverables waiting for a grader), then by
    // the time they were submitted — FIFO grading.
    orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }],
  })

  return rows.map((row) => ({
    submission: {
      id: row.id,
      status: row.status,
      contentText: row.contentText,
      attachmentIds: row.attachmentIds,
      submittedAt: row.submittedAt,
      isLate: row.isLate,
      score: row.score,
      feedback: row.feedback,
      gradedAt: row.gradedAt,
      gradedByName: row.gradedBy?.name ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    authorId: row.userId,
    authorName: row.user.name,
    authorEmail: row.user.email,
  }))
}

/** Counts for the admin overview — quick at-a-glance status of every assignment. */
export interface AssignmentOverviewCount {
  assignmentId: string
  draftSubmissions: number
  submitted: number
  graded: number
  resubmitRequested: number
}

export async function gradingCounts(
  assignmentIds: readonly string[],
): Promise<Map<string, AssignmentOverviewCount>> {
  const result = new Map<string, AssignmentOverviewCount>()
  if (assignmentIds.length === 0) return result

  const rows = await db.submission.groupBy({
    by: ['assignmentId', 'status'],
    where: { assignmentId: { in: [...assignmentIds] } },
    _count: { status: true },
  })

  for (const id of assignmentIds) {
    result.set(id, {
      assignmentId: id,
      draftSubmissions: 0,
      submitted: 0,
      graded: 0,
      resubmitRequested: 0,
    })
  }
  for (const row of rows) {
    const entry = result.get(row.assignmentId)
    if (!entry) continue
    if (row.status === 'DRAFT') entry.draftSubmissions = row._count.status
    else if (row.status === 'SUBMITTED') entry.submitted = row._count.status
    else if (row.status === 'GRADED') entry.graded = row._count.status
    else if (row.status === 'RESUBMIT_REQUESTED') entry.resubmitRequested = row._count.status
  }

  return result
}
