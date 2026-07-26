import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { liveSessionKindLabel, t } from '@/lib/labels'
import { formatDateTime } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { STAFF_ROLES } from '@/server/auth/roles'
import { toLocalDateTimeInput } from '@/server/batches/form-datetime'
import { db } from '@/server/db'
import { getOrgSettings, isFeatureEnabled } from '@/server/org/settings'
import { createLiveSession } from '@/server/sessions/actions'
import { describePhase, sessionPhase } from '@/server/sessions/timing'
import { NewSessionSection } from './new-session-section'

export const metadata: Metadata = { title: 'Live sessions' }

const VISIBILITY_LABELS: Record<string, string> = {
  PUBLIC: 'Public',
  ENROLLED: 'Enrolled',
  BATCH: 'Batch',
  ROLE: 'Staff only',
}

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>
}) {
  await requirePermission('session:manage', '/admin/batches/sessions')

  // Feature flags gate routes, not just navigation.
  if (!(await isFeatureEnabled('liveSessions'))) notFound()

  const { window } = await searchParams
  const past = window === 'past'
  const settings = await getOrgSettings()
  const now = new Date()

  const [sessions, batches, courses, hosts] = await Promise.all([
    db.liveSession.findMany({
      where: { scheduledStart: past ? { lt: now } : { gte: now } },
      // streamKey is never selected — it is the academy's broadcast credential.
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
        visibility: true,
        scheduledStart: true,
        scheduledEnd: true,
        actualEnd: true,
        tracksAttendance: true,
        batch: { select: { id: true, name: true } },
        course: { select: { title: true } },
        host: { select: { name: true } },
        _count: { select: { attendance: true } },
      },
      orderBy: { scheduledStart: past ? 'desc' : 'asc' },
      take: 100,
    }),
    db.batch.findMany({
      where: { status: { in: ['UPCOMING', 'ENROLLING', 'RUNNING'] } },
      orderBy: { startDate: 'desc' },
      select: { id: true, name: true, code: true },
    }),
    db.course.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: { title: 'asc' },
      select: { id: true, title: true },
    }),
    db.user.findMany({
      where: { role: { in: [...STAFF_ROLES] }, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ])

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/admin/batches" className="text-content-muted hover:text-content">
          ← {t('nav.batches')}
        </Link>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-content">{t('liveSession.plural')}</h1>
        <div className="flex gap-2 text-sm">
          <Link
            href="/admin/batches/sessions"
            className={past ? 'text-content-muted hover:text-content' : 'font-medium text-primary'}
          >
            Upcoming
          </Link>
          <span aria-hidden className="text-content-muted">·</span>
          <Link
            href="/admin/batches/sessions?window=past"
            className={past ? 'font-medium text-primary' : 'text-content-muted hover:text-content'}
          >
            Past
          </Link>
        </div>
      </div>

      {sessions.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          {past ? 'Nothing has run yet.' : 'Nothing scheduled.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                <th scope="col" className="py-2 pr-4 font-medium">{t('liveSession.singular')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">When</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('batch.singular')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">Visible to</th>
                <th scope="col" className="py-2 pr-4 font-medium">State</th>
                <th scope="col" className="py-2 font-medium">{t('nav.attendance')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td className="py-3 pr-4">
                    <Link
                      href={`/admin/batches/sessions/${session.id}`}
                      className="font-medium text-content hover:text-primary"
                    >
                      {session.title}
                    </Link>
                    <span className="block text-xs text-content-muted">
                      {liveSessionKindLabel(session.kind)}
                      {session.host ? ` · ${session.host.name}` : ''}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-content-muted">
                    {formatDateTime(session.scheduledStart, settings.timezone, settings.locale)}
                  </td>
                  <td className="py-3 pr-4 text-content-muted">
                    {session.batch ? (
                      <Link
                        href={`/admin/batches/${session.batch.id}`}
                        className="hover:text-primary"
                      >
                        {session.batch.name}
                      </Link>
                    ) : (
                      (session.course?.title ?? '—')
                    )}
                  </td>
                  <td className="py-3 pr-4 text-content-muted">
                    {VISIBILITY_LABELS[session.visibility] ?? session.visibility}
                  </td>
                  <td className="py-3 pr-4 text-content-muted">
                    {describePhase(sessionPhase(session, now))}
                  </td>
                  <td className="py-3 tabular-nums text-content-muted">
                    {session.tracksAttendance ? (
                      <Link
                        href={`/admin/attendance/${session.id}`}
                        className="text-primary underline"
                      >
                        {session._count.attendance} marked
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewSessionSection
        action={createLiveSession}
        batches={batches.map((batch) => ({ id: batch.id, label: `${batch.name} (${batch.code})` }))}
        courses={courses.map((course) => ({ id: course.id, label: course.title }))}
        hosts={hosts.map((host) => ({ id: host.id, label: host.name }))}
        defaultStart={toLocalDateTimeInput(now, settings.timezone)}
      />
    </div>
  )
}
