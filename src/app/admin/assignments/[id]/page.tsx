import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { formatDateTime } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { isFeatureEnabled, getOrgSettings } from '@/server/org/settings'
import {
  loadAssignmentForViewer,
  loadGradingQueue,
} from '@/server/assignments/assignments'
import { loadAssignmentViewer } from '@/server/assignments/access'
import { getCurrentUser } from '@/server/auth/rbac'
import { GradingForm } from '@/components/assignments/grading-form'

export const metadata: Metadata = { title: 'Grading Queue · Admin' }

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-surface-muted text-content-muted',
  SUBMITTED: 'bg-warning/10 text-warning',
  RESUBMIT_REQUESTED: 'bg-info/10 text-info',
  GRADED: 'bg-success/10 text-success',
}

export default async function AdminAssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isFeatureEnabled('assignments'))) notFound()
  await requirePermission('assignment:grade', '/admin/assignments')

  const { id } = await params
  const user = await getCurrentUser()
  if (!user) notFound()

  const viewer = await loadAssignmentViewer(user.id)
  if (!viewer) notFound()

  const { decision, assignment } = await loadAssignmentForViewer(id, viewer)
  if (!decision.visible || !assignment) notFound()

  const queue = await loadGradingQueue(id)

  const settings = await getOrgSettings()
  const format = (date: Date) => formatDateTime(date, settings.timezone, settings.locale)

  const waitingCount = queue.filter(
    (row) => row.submission.status === 'SUBMITTED',
  ).length
  const gradedCount = queue.filter(
    (row) => row.submission.status === 'GRADED',
  ).length
  const resubmitCount = queue.filter(
    (row) => row.submission.status === 'RESUBMIT_REQUESTED',
  ).length

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="text-xs text-content-muted">
          <a href="/admin/assignments" className="hover:text-primary">
            Assignments
          </a>{' '}
          / Grading
        </p>
        <h1 className="text-2xl font-semibold text-content">{assignment.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
          <span
            className={
              'rounded-full px-2 py-0.5 uppercase tracking-wide ' +
              (assignment.status === 'PUBLISHED'
                ? 'bg-success/10 text-success'
                : assignment.status === 'ARCHIVED'
                  ? 'bg-surface-muted text-content-muted'
                  : 'bg-warning/10 text-warning')
            }
          >
            {assignment.status}
          </span>
          {assignment.courseTitle && <span>· {assignment.courseTitle}</span>}
          {assignment.batchName && <span>· {assignment.batchName}</span>}
          {assignment.dueAt && <span>· due {format(assignment.dueAt)}</span>}
          <span>· max {assignment.maxScore} pts</span>
        </div>
        {assignment.instructions && (
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-content">
            {assignment.instructions}
          </p>
        )}
      </header>

      <section aria-labelledby="queue-summary" className="flex flex-wrap gap-4 text-sm">
        <div className="rounded-brand border border-surface-border bg-surface px-4 py-2">
          <span className="text-content-muted">Waiting</span>{' '}
          <span className="font-medium text-warning">{waitingCount}</span>
        </div>
        <div className="rounded-brand border border-surface-border bg-surface px-4 py-2">
          <span className="text-content-muted">Graded</span>{' '}
          <span className="font-medium text-success">{gradedCount}</span>
        </div>
        <div className="rounded-brand border border-surface-border bg-surface px-4 py-2">
          <span className="text-content-muted">Resubmit requested</span>{' '}
          <span className="font-medium text-info">{resubmitCount}</span>
        </div>
        <div className="rounded-brand border border-surface-border bg-surface px-4 py-2">
          <span className="text-content-muted">Total</span>{' '}
          <span className="font-medium text-content">{queue.length}</span>
        </div>
      </section>

      <section aria-labelledby="submissions" className="space-y-3">
        <h2
          id="submissions"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Submissions ({queue.length})
        </h2>

        {queue.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            No submissions yet. Students will appear here once they submit their work.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {queue.map((row) => (
              <li key={row.submission.id} className="space-y-4 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-content">
                      {row.authorName}
                      <span className="ml-2 font-normal text-content-muted">
                        {row.authorEmail}
                      </span>
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-content-muted">
                      <span
                        className={
                          'rounded-full px-2 py-0.5 uppercase tracking-wide ' +
                          (STATUS_BADGE[row.submission.status] ?? '')
                        }
                      >
                        {row.submission.status.replace('_', ' ')}
                      </span>
                      {row.submission.isLate && (
                        <span className="text-danger">late</span>
                      )}
                      {row.submission.submittedAt && (
                        <span>submitted {format(row.submission.submittedAt)}</span>
                      )}
                      {row.submission.score !== null && (
                        <span>
                          score {row.submission.score} / {assignment.maxScore}
                        </span>
                      )}
                      {row.submission.gradedByName && (
                        <span>graded by {row.submission.gradedByName}</span>
                      )}
                    </div>
                  </div>
                </div>

                {row.submission.contentText && (
                  <div className="rounded-brand border border-surface-border bg-surface-muted px-4 py-3">
                    <p className="whitespace-pre-wrap break-words text-sm text-content">
                      {row.submission.contentText}
                    </p>
                  </div>
                )}

                {row.submission.attachmentIds.length > 0 && (
                  <p className="text-xs text-content-muted">
                    {row.submission.attachmentIds.length} attachment
                    {row.submission.attachmentIds.length !== 1 ? 's' : ''}
                  </p>
                )}

                <GradingForm
                  submissionId={row.submission.id}
                  maxScore={assignment.maxScore}
                  currentStatus={row.submission.status}
                  currentScore={row.submission.score}
                  currentFeedback={row.submission.feedback}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
