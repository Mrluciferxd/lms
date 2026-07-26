import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { t } from '@/lib/labels'
import { formatDate } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { db } from '@/server/db'
import { getOrgSettings, isFeatureEnabled } from '@/server/org/settings'
import { getBatchAttendanceReport } from '@/server/sessions/attendance'
import { formatAttendancePercent, isBelowThreshold } from '@/server/sessions/attendance-stats'

export const metadata: Metadata = { title: 'Batch attendance' }

const ATTENDANCE_THRESHOLD = 75

export default async function BatchAttendanceReportPage({
  params,
}: {
  params: Promise<{ batchId: string }>
}) {
  const { batchId } = await params
  await requirePermission('attendance:mark', `/admin/attendance/batch/${batchId}`)

  if (!(await isFeatureEnabled('attendance'))) notFound()

  const settings = await getOrgSettings()

  const batch = await db.batch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      name: true,
      code: true,
      startDate: true,
      course: { select: { title: true } },
    },
  })
  if (!batch) notFound()

  const report = await getBatchAttendanceReport(batch.id)

  const atRisk = report.rows.filter((row) => isBelowThreshold(row.tally, ATTENDANCE_THRESHOLD))

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/admin/attendance" className="text-content-muted hover:text-content">
          ← {t('nav.attendance')}
        </Link>
      </nav>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-content">{batch.name}</h1>
          <p className="mt-0.5 text-sm text-content-muted">
            {batch.course.title} · {report.sessionsHeld} class(es) held since{' '}
            {formatDate(batch.startDate, settings.timezone, settings.locale)}
          </p>
        </div>
        <Link href={`/admin/batches/${batch.id}`} className="text-sm text-primary underline">
          {t('batch.singular')} →
        </Link>
      </div>

      {atRisk.length > 0 && (
        <p className="rounded-brand border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {atRisk.length} student(s) are below {ATTENDANCE_THRESHOLD}%.
        </p>
      )}

      {report.rows.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          Nobody is enrolled in this {t('batch.singular').toLowerCase()}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                <th scope="col" className="py-2 pr-4 font-medium">{t('student.singular')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('attendance.PRESENT')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('attendance.LATE')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('attendance.ABSENT')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('attendance.EXCUSED')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">Not marked</th>
                <th scope="col" className="py-2 font-medium">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {report.rows.map((row) => (
                <tr key={row.userId}>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/students/${row.userId}`}
                      className="text-content hover:text-primary"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-content-muted">{row.tally.present}</td>
                  <td className="py-2 pr-4 tabular-nums text-content-muted">{row.tally.late}</td>
                  <td className="py-2 pr-4 tabular-nums text-content-muted">{row.tally.absent}</td>
                  <td className="py-2 pr-4 tabular-nums text-content-muted">{row.tally.excused}</td>
                  <td className="py-2 pr-4 tabular-nums text-content-muted">{row.tally.unmarked}</td>
                  <td
                    className={`py-2 tabular-nums ${
                      isBelowThreshold(row.tally, ATTENDANCE_THRESHOLD)
                        ? 'text-warning'
                        : 'text-content'
                    }`}
                  >
                    {formatAttendancePercent(row.tally.percent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-content-muted">
        Excused absences are left out of the rate entirely, and classes with no register taken are
        counted as “not marked” rather than as absences.
      </p>
    </div>
  )
}
