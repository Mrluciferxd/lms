import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { liveSessionKindLabel, t } from '@/lib/labels'
import { formatDateTime } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { SEAT_OCCUPYING } from '@/server/batches/capacity'
import { db } from '@/server/db'
import { getOrgSettings, isFeatureEnabled } from '@/server/org/settings'
import { attendanceOpen, describePhase, sessionPhase } from '@/server/sessions/timing'

export const metadata: Metadata = { title: 'Attendance' }

/** Sessions older than this are reached from the batch report instead. */
const LOOKBACK_DAYS = 45

export default async function AttendanceQueuePage() {
  await requirePermission('attendance:mark', '/admin/attendance')

  if (!(await isFeatureEnabled('attendance'))) notFound()

  const settings = await getOrgSettings()
  const now = new Date()
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)

  const sessions = await db.liveSession.findMany({
    where: {
      tracksAttendance: true,
      status: { not: 'CANCELLED' },
      scheduledStart: { gte: since, lte: new Date(now.getTime() + 86_400_000) },
    },
    select: {
      id: true,
      title: true,
      kind: true,
      status: true,
      scheduledStart: true,
      scheduledEnd: true,
      actualEnd: true,
      tracksAttendance: true,
      batchId: true,
      batch: { select: { id: true, name: true } },
      _count: { select: { attendance: true } },
    },
    orderBy: { scheduledStart: 'desc' },
    take: 100,
  })

  const batchIds = [...new Set(sessions.flatMap((session) => (session.batchId ? [session.batchId] : [])))]

  // Roster sizes in one grouped query — the "8 of 24 marked" figure is what makes
  // this list a queue rather than a log.
  const rosterCounts = await db.enrollment.groupBy({
    by: ['batchId'],
    where: { batchId: { in: batchIds }, status: { in: [...SEAT_OCCUPYING] } },
    _count: { _all: true },
  })
  const rosterByBatch = new Map(rosterCounts.map((row) => [row.batchId, row._count._all] as const))

  const markable = sessions.filter((session) => attendanceOpen(session, now))
  const upcoming = sessions.filter((session) => !attendanceOpen(session, now))

  const batches = await db.batch.findMany({
    where: { status: { in: ['ENROLLING', 'RUNNING', 'COMPLETED'] } },
    select: { id: true, name: true, code: true, course: { select: { title: true } } },
    orderBy: { startDate: 'desc' },
    take: 30,
  })

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-content">{t('nav.attendance')}</h1>

      <section aria-labelledby="markable-heading" className="space-y-3">
        <h2 id="markable-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
          Registers to take
        </h2>

        {markable.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            Nothing to mark in the last {LOOKBACK_DAYS} days.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {markable.map((session) => {
              const roster = session.batchId ? (rosterByBatch.get(session.batchId) ?? 0) : 0
              const complete = roster > 0 && session._count.attendance >= roster

              return (
                <li key={session.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <Link
                      href={`/admin/attendance/${session.id}`}
                      className="block truncate text-sm font-medium text-content hover:text-primary"
                    >
                      {session.title}
                    </Link>
                    <span className="flex flex-wrap gap-2 text-xs text-content-muted">
                      <span>
                        {formatDateTime(session.scheduledStart, settings.timezone, settings.locale)}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{liveSessionKindLabel(session.kind)}</span>
                      {session.batch && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{session.batch.name}</span>
                        </>
                      )}
                    </span>
                  </span>

                  <span
                    className={`text-xs tabular-nums ${complete ? 'text-success' : 'text-warning'}`}
                  >
                    {session._count.attendance}
                    {roster > 0 ? ` / ${roster}` : ''} marked
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {upcoming.length > 0 && (
        <section aria-labelledby="upcoming-heading" className="space-y-3">
          <h2 id="upcoming-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
            Opening soon
          </h2>
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {upcoming.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm text-content">{session.title}</span>
                <span className="text-xs text-content-muted">
                  {formatDateTime(session.scheduledStart, settings.timezone, settings.locale)} ·{' '}
                  {describePhase(sessionPhase(session, now))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="reports-heading" className="space-y-3">
        <h2 id="reports-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
          {t('nav.reports')}
        </h2>

        {batches.length === 0 ? (
          <p className="text-sm text-content-muted">No {t('batch.plural').toLowerCase()} to report on yet.</p>
        ) : (
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {batches.map((batch) => (
              <li key={batch.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/admin/attendance/batch/${batch.id}`}
                    className="block truncate text-sm text-content hover:text-primary"
                  >
                    {batch.name}
                  </Link>
                  <span className="text-xs text-content-muted">
                    {batch.course.title} · {batch.code}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
