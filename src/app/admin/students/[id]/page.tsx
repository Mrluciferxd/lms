import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { t } from '@/lib/labels'
import { formatDate, formatDateTime } from '@/lib/utils'
import { can, requirePermission } from '@/server/auth/rbac'
import { listSiblingBatches } from '@/server/batches/roster'
import { db } from '@/server/db'
import { getOrgSettings, isFeatureEnabled } from '@/server/org/settings'
import {
  formatAttendancePercent,
  isBelowThreshold,
} from '@/server/sessions/attendance-stats'
import { getStudentAttendanceReport } from '@/server/sessions/attendance'
import { EnrollmentRowActions } from './enrollment-row-actions'

export const metadata: Metadata = { title: 'Student' }

/** Below this, the roster flags a student for follow-up. */
const ATTENDANCE_THRESHOLD = 75

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requirePermission('student:read', `/admin/students/${id}`)

  const [settings, canManageEnrollment, attendanceEnabled] = await Promise.all([
    getOrgSettings(),
    can('enrollment:manage'),
    isFeatureEnabled('attendance'),
  ])

  const student = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      role: true,
      createdAt: true,
      lastActiveAt: true,
      enrollments: {
        select: {
          id: true,
          status: true,
          enrolledAt: true,
          expiresAt: true,
          percentComplete: true,
          courseId: true,
          batchId: true,
          course: { select: { id: true, title: true, slug: true } },
          batch: { select: { id: true, name: true, code: true } },
        },
        orderBy: { enrolledAt: 'desc' },
      },
    },
  })

  if (!student) notFound()

  const [attendance, moveTargetsByEnrollment] = await Promise.all([
    attendanceEnabled ? getStudentAttendanceReport(student.id) : null,
    canManageEnrollment
      ? Promise.all(
          student.enrollments.map(async (enrollment) => ({
            enrollmentId: enrollment.id,
            targets: await listSiblingBatches(enrollment.courseId, enrollment.batchId ?? ''),
          })),
        )
      : Promise.resolve([]),
  ])

  const targetsByEnrollment = new Map(
    moveTargetsByEnrollment.map((entry) => [entry.enrollmentId, entry.targets] as const),
  )

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/admin/students" className="text-content-muted hover:text-content">
          ← {t('nav.students')}
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold text-content">{student.name}</h1>
        <p className="mt-0.5 text-sm text-content-muted">
          {[student.email, student.phone].filter(Boolean).join(' · ') || 'No contact details'} ·{' '}
          {student.status} · joined{' '}
          {formatDate(student.createdAt, settings.timezone, settings.locale)}
        </p>
      </div>

      <section aria-labelledby="enrollments-heading" className="space-y-4">
        <h2 id="enrollments-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
          Enrollments
        </h2>

        {student.enrollments.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            Not enrolled in anything yet. Add them from a {t('batch.singular').toLowerCase()}{' '}
            roster.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">{t('course.singular')}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t('batch.singular')}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Progress</th>
                  {canManageEnrollment && <th scope="col" className="py-2 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {student.enrollments.map((enrollment) => (
                  <tr key={enrollment.id}>
                    <td className="py-3 pr-4">
                      <Link
                        href={`/admin/courses/${enrollment.course.id}`}
                        className="font-medium text-content hover:text-primary"
                      >
                        {enrollment.course.title}
                      </Link>
                      <span className="block text-xs text-content-muted">
                        since {formatDate(enrollment.enrolledAt, settings.timezone, settings.locale)}
                        {enrollment.expiresAt
                          ? ` · expires ${formatDate(enrollment.expiresAt, settings.timezone, settings.locale)}`
                          : ''}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-content-muted">
                      {enrollment.batch ? (
                        <Link
                          href={`/admin/batches/${enrollment.batch.id}`}
                          className="hover:text-primary"
                        >
                          {enrollment.batch.name}
                        </Link>
                      ) : (
                        'Self-paced'
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs font-medium text-content-muted">
                      {enrollment.status}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-content-muted">
                      {enrollment.percentComplete}%
                    </td>
                    {canManageEnrollment && (
                      <td className="py-3">
                        <EnrollmentRowActions
                          enrollmentId={enrollment.id}
                          status={enrollment.status}
                          targets={(targetsByEnrollment.get(enrollment.id) ?? []).map((batch) => ({
                            id: batch.id,
                            label: `${batch.name} (${batch.code})`,
                          }))}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {attendance && (
        <section aria-labelledby="attendance-heading" className="space-y-4">
          <h2 id="attendance-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
            {t('nav.attendance')}
          </h2>

          <div className="flex flex-wrap gap-6 rounded-brand border border-surface-border p-4">
            <div>
              <p className="text-2xl font-semibold text-content">
                {formatAttendancePercent(attendance.overall.percent)}
              </p>
              <p className="text-xs text-content-muted">
                {attendance.overall.attended} of {attendance.overall.countable} marked classes
                attended
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-content-muted sm:grid-cols-4">
              <div>
                <dt className="inline">{t('attendance.PRESENT')}: </dt>
                <dd className="inline tabular-nums">{attendance.overall.present}</dd>
              </div>
              <div>
                <dt className="inline">{t('attendance.LATE')}: </dt>
                <dd className="inline tabular-nums">{attendance.overall.late}</dd>
              </div>
              <div>
                <dt className="inline">{t('attendance.ABSENT')}: </dt>
                <dd className="inline tabular-nums">{attendance.overall.absent}</dd>
              </div>
              <div>
                <dt className="inline">{t('attendance.EXCUSED')}: </dt>
                <dd className="inline tabular-nums">{attendance.overall.excused}</dd>
              </div>
            </dl>
          </div>

          {attendance.batches.length > 0 && (
            <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
              {attendance.batches.map((batch) => (
                <li key={batch.batchId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <Link
                      href={`/admin/batches/${batch.batchId}`}
                      className="block truncate text-sm text-content hover:text-primary"
                    >
                      {batch.batchName}
                    </Link>
                    <span className="text-xs text-content-muted">{batch.courseTitle}</span>
                  </span>
                  <span className="text-sm tabular-nums text-content">
                    {formatAttendancePercent(batch.tally.percent)}
                  </span>
                  {isBelowThreshold(batch.tally, ATTENDANCE_THRESHOLD) && (
                    <span className="text-xs text-warning">below {ATTENDANCE_THRESHOLD}%</span>
                  )}
                  {batch.tally.unmarked > 0 && (
                    <span className="text-xs text-content-muted">
                      {batch.tally.unmarked} not marked
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {attendance.recent.length > 0 && (
            <details className="rounded-brand border border-surface-border p-4">
              <summary className="cursor-pointer text-sm text-content">Recent classes</summary>
              <ul className="mt-3 space-y-1.5">
                {attendance.recent.map((record) => (
                  <li
                    key={record.sessionId}
                    className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                  >
                    <span className="text-content">{record.title}</span>
                    <span className="text-content-muted">
                      {formatDateTime(record.scheduledStart, settings.timezone, settings.locale)} ·{' '}
                      {t(`attendance.${record.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  )
}
