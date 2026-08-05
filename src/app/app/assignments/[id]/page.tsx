import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { t } from '@/lib/labels'
import { formatDateTime } from '@/lib/utils'
import { requireUser } from '@/server/auth/rbac'
import { isFeatureEnabled, getOrgSettings } from '@/server/org/settings'
import {
  decideCanSubmit,
  loadAssignmentViewer,
} from '@/server/assignments/access'
import {
  loadAssignmentForViewer,
  loadSubmissionForViewer,
} from '@/server/assignments/assignments'
import { SubmissionComposer } from '@/components/assignments/submission-composer'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  return { title: `Assignment ${id}` }
}

export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: assignmentId } = await params

  if (!(await isFeatureEnabled('assignments'))) notFound()

  const user = await requireUser(`/app/assignments/${assignmentId}`)
  const settings = await getOrgSettings()
  const viewer = await loadAssignmentViewer(user.id)
  if (!viewer) notFound()

  const access = await loadAssignmentForViewer(assignmentId, viewer)
  // Visibility decisions are 404s, not 403s — a student probing an unknown
  // draft assignment should not learn the slug is taken.
  if (!access.assignment) notFound()
  const assignment = access.assignment

  const submission = await loadSubmissionForViewer(assignmentId, user.id)

  // The decision is the authority for whether the composer is writable; the
  // action re-runs the same pure function server-side so a stale page (post
  // due, post-lapse) cannot get a submission in.
  const canSubmitDecision = decideCanSubmit(
    {
      status: assignment.status,
      courseId: assignment.courseId,
      batchId: assignment.batchId,
      dueAt: assignment.dueAt,
      allowLateSubmission: assignment.allowLateSubmission,
    },
    submission,
    viewer,
    new Date(),
  )

  // Human-readable reason copied from the same reasons table the action uses,
  // so an inline lock and an action failure read identically.
  const cannotSubmitReason = canSubmitDecision.canSubmit
    ? null
    : describeDenial(canSubmitDecision.reason)

  const format = (date: Date) => formatDateTime(date, settings.timezone, settings.locale)

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs text-content-muted">
          <Link href="/app/assignments" className="hover:underline">
            {t('nav.assignments')}
          </Link>{' '}
          /
        </p>
        <h1 className="text-2xl font-semibold text-content">{assignment.title}</h1>
        <div className="flex flex-wrap items-center gap-3 text-xs text-content-muted">
          {assignment.courseTitle && (
            <span>{assignment.courseTitle}</span>
          )}
          {assignment.batchName && <span>· {assignment.batchName}</span>}
          {assignment.dueAt && (
            <span>
              · due {format(assignment.dueAt)}
              {!assignment.allowLateSubmission && ' (no late submissions)'}
            </span>
          )}
          {assignment.dueAt === null && <span>· no due date</span>}
          <span>· max {assignment.maxScore} pts</span>
        </div>
        {assignment.instructions && (
          <div className="whitespace-pre-wrap break-words rounded-brand border border-surface-border bg-surface-muted px-4 py-3 text-sm text-content">
            {assignment.instructions}
          </div>
        )}
      </header>

      <section
        aria-labelledby="submission-heading"
        className="space-y-3"
      >
        <h2
          id="submission-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Your submission
        </h2>
        <SubmissionComposer
          assignmentId={assignmentId}
          initial={{
            contentText: submission?.contentText ?? '',
            attachmentIds: submission?.attachmentIds ?? [],
          }}
          canSubmit={canSubmitDecision.canSubmit}
          cannotSubmitReason={cannotSubmitReason}
          currentStatus={submission?.status ?? null}
          maxScore={assignment.maxScore}
          showScoreBlock={
            submission?.status === 'GRADED'
              ? {
                  score: submission.score,
                  feedback: submission.feedback,
                  gradedByName: submission.gradedByName,
                }
              : null
          }
        />
      </section>
    </div>
  )
}

function describeDenial(reason: string): string {
  const reasons: Record<string, string> = {
    NOT_AUTHENTICATED: 'You must be signed in.',
    NOT_PUBLISHED: 'This assignment is not yet published.',
    NOT_ENROLLED: 'You are not enrolled in this course.',
    NOT_IN_BATCH: 'You are not in the batch this assignment belongs to.',
    NO_SCOPE: 'This assignment has no audience.',
    PAST_DUE_NO_LATE: 'The due date has passed and late submissions are not allowed.',
    ALREADY_GRADED: 'This submission has been graded. Ask your instructor to reopen it.',
    RESUBMIT_NOT_REQUESTED:
      'Your submission is being reviewed. Wait for the grader to return it.',
  }
  return reasons[reason] ?? 'You cannot submit here right now.'
}
