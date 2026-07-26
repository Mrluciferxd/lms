import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { liveSessionKindLabel, t } from '@/lib/labels'
import { formatDateTime } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { getAttendanceSheet } from '@/server/sessions/attendance'
import { attendanceOpen, describePhase, sessionPhase } from '@/server/sessions/timing'
import { getOrgSettings, isFeatureEnabled } from '@/server/org/settings'
import { AttendanceGrid, type AttendanceGridRow } from './attendance-grid'

export const metadata: Metadata = { title: 'Attendance' }

export default async function MarkAttendancePage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  await requirePermission('attendance:mark', `/admin/attendance/${sessionId}`)

  if (!(await isFeatureEnabled('attendance'))) notFound()

  const settings = await getOrgSettings()
  const sheet = await getAttendanceSheet(sessionId)
  if (!sheet) notFound()

  const now = new Date()
  const phase = sessionPhase(sheet.session, now)
  const open = attendanceOpen(sheet.session, now)

  const rows = sheet.rows.map(
    (row): AttendanceGridRow => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      status: row.status,
      note: row.note,
      markedOn: row.markedAt
        ? formatDateTime(row.markedAt, settings.timezone, settings.locale)
        : null,
      markedByName: row.markedByName,
      onRoster: row.enrollmentStatus !== null,
    }),
  )

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/admin/attendance" className="text-content-muted hover:text-content">
          ← {t('nav.attendance')}
        </Link>
      </nav>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-content">{sheet.session.title}</h1>
          <p className="mt-0.5 text-sm text-content-muted">
            {liveSessionKindLabel(sheet.session.kind)} ·{' '}
            {formatDateTime(sheet.session.scheduledStart, settings.timezone, settings.locale)} ·{' '}
            {describePhase(phase)}
            {sheet.session.batchName ? ` · ${sheet.session.batchName}` : ''}
          </p>
        </div>

        <Link
          href={`/admin/batches/sessions/${sheet.session.id}`}
          className="text-sm text-primary underline"
        >
          Edit {t('liveSession.singular').toLowerCase()} →
        </Link>
      </div>

      {!sheet.session.tracksAttendance && (
        <p className="rounded-brand border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          This {t('liveSession.singular').toLowerCase()} does not track attendance. Turn it on in
          the session settings to take a register.
        </p>
      )}

      {sheet.session.status === 'CANCELLED' && (
        <p className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          Cancelled — there is no register to take.
        </p>
      )}

      {sheet.session.tracksAttendance && sheet.session.status !== 'CANCELLED' && !open && (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-3 py-2 text-sm text-content-muted">
          The register opens 15 minutes before the class starts.
        </p>
      )}

      <AttendanceGrid
        sessionId={sheet.session.id}
        rows={rows}
        canMark={open && sheet.session.status !== 'CANCELLED'}
      />
    </div>
  )
}
