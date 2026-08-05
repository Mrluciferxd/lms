import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { t } from '@/lib/labels'
import { formatDateTime } from '@/lib/utils'
import { requireUser } from '@/server/auth/rbac'
import { isFeatureEnabled, getOrgSettings } from '@/server/org/settings'
import { loadAssignmentViewer } from '@/server/assignments/access'
import { listAssignmentsForViewer } from '@/server/assignments/assignments'
import { db } from '@/server/db'
import type { ViewableAssignment } from '@/server/assignments/assignments'
import type { SubmissionStatus } from '@/generated/prisma/enums'

export const metadata: Metadata = { title: 'Assignments' }

interface StudentRow extends ViewableAssignment {
  submission: {
    status: SubmissionStatus
    score: number | null
    submittedAt: Date | null
  } | null
}

export default async function AssignmentsPage() {
  const user = await requireUser('/app/assignments')

  // Feature flags gate the route, not only the nav entry.
  if (!(await isFeatureEnabled('assignments'))) notFound()

  const settings = await getOrgSettings()
  const viewer = await loadAssignmentViewer(user.id)
  if (!viewer) notFound()

  const assignments = await listAssignmentsForViewer(viewer)

  // The viewer's submissions against the visible assignments, in one query — a
  // per-assignment lookup would turn a list into N round trips. The
  // `(assignmentId, userId)` unique on Submission backs the join.
  const submissionsByAssignment = new Map<string, StudentRow['submission']>()
  if (assignments.length > 0) {
    const submissions = await db.submission.findMany({
      where: {
        userId: user.id,
        assignmentId: { in: assignments.map((row) => row.id) },
      },
      select: { assignmentId: true, status: true, score: true, submittedAt: true },
    })
    for (const row of submissions) {
      submissionsByAssignment.set(row.assignmentId, {
        status: row.status,
        score: row.score,
        submittedAt: row.submittedAt,
      })
    }
  }

  const rows: StudentRow[] = assignments.map((assignment) => ({
    ...assignment,
    submission: submissionsByAssignment.get(assignment.id) ?? null,
  }))

  const open = rows.filter(
    (row) => row.submission === null || row.submission.status === 'DRAFT' || row.submission.status === 'RESUBMIT_REQUESTED',
  )
  const submitted = rows.filter((row) => row.submission?.status === 'SUBMITTED')
  const graded = rows.filter((row) => row.submission?.status === 'GRADED')

  const format = (date: Date) => formatDateTime(date, settings.timezone, settings.locale)

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-content">{t('nav.assignments')}</h1>
        <p className="text-sm text-content-muted">
          Your assignments, sorted by where they sit in the workflow. Late submissions are flagged
          when graded.
        </p>
      </header>

      <Section
        heading="To submit"
        rows={open}
        emptyText="Nothing to submit right now."
        format={format}
        showDueAt
      />

      {submitted.length > 0 && (
        <Section
          heading="Submitted — waiting on grading"
          rows={submitted}
          emptyText=""
          format={format}
          showSubmittedAt
        />
      )}

      {graded.length > 0 && (
        <Section
          heading="Graded"
          rows={graded}
          emptyText=""
          format={format}
          showScore
        />
      )}
    </div>
  )
}

function Section({
  heading,
  rows,
  emptyText,
  format,
  showDueAt,
  showSubmittedAt,
  showScore,
}: {
  heading: string
  rows: StudentRow[]
  emptyText: string
  format: (date: Date) => string
  showDueAt?: boolean
  showSubmittedAt?: boolean
  showScore?: boolean
}) {
  return (
    <section aria-labelledby={`${heading}-heading`} className="space-y-3">
      <h2
        id={`${heading}-heading`}
        className="text-sm font-medium uppercase tracking-wide text-content-muted"
      >
        {heading} ({rows.length})
      </h2>

      {rows.length === 0 ? (
        emptyText ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            {emptyText}
          </p>
        ) : null
      ) : (
        <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/app/assignments/${row.id}`}
                className="flex flex-wrap items-baseline gap-3 px-4 py-3 hover:bg-surface-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-content">
                    {row.title}
                  </span>
                  <span className="block text-xs text-content-muted">
                    {row.courseTitle ?? 'No course attached'}
                    {row.batchName ? ` · ${row.batchName}` : ''}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
                  {row.submission?.status === 'RESUBMIT_REQUESTED' && (
                    <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">
                      Returned for resubmit
                    </span>
                  )}
                  {row.submission?.status === 'DRAFT' && (
                    <span className="rounded-full bg-surface-muted px-2 py-0.5">Draft</span>
                  )}
                  {row.submission?.status === 'SUBMITTED' && showSubmittedAt && row.submission.submittedAt && (
                    <span>submitted {format(row.submission.submittedAt)}</span>
                  )}
                  {row.submission?.status === 'GRADED' && showScore && row.submission.score !== null && (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 font-medium text-success">
                      {row.submission.score} / {row.maxScore}
                    </span>
                  )}
                  {showDueAt && row.dueAt && (
                    <span>· due {format(row.dueAt)}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
