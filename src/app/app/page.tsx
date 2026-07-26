import type { Metadata } from 'next'

import { t } from '@/lib/labels'
import { requireUser } from '@/server/auth/rbac'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { formatDateTime } from '@/lib/utils'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const user = await requireUser('/app')
  const settings = await getOrgSettings()

  const [enrollments, upcomingSessions] = await Promise.all([
    db.enrollment.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      select: {
        id: true,
        percentComplete: true,
        course: { select: { title: true, slug: true } },
        batch: { select: { name: true } },
      },
      orderBy: { lastActivityAt: 'desc' },
      take: 6,
    }),
    db.liveSession.findMany({
      where: {
        status: { in: ['SCHEDULED', 'LIVE'] },
        scheduledStart: { gte: new Date() },
      },
      select: { id: true, title: true, kind: true, scheduledStart: true },
      orderBy: { scheduledStart: 'asc' },
      take: 5,
    }),
  ])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-content">
          {t('dashboard.welcome', { name: user.name.split(' ')[0] ?? user.name })}
        </h1>
        <p className="mt-1 text-sm text-content-muted">
          {settings.name} · {settings.timezone}
        </p>
      </div>

      <section aria-labelledby="courses-heading" className="space-y-3">
        <h2 id="courses-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
          {t('dashboard.continueLearning')}
        </h2>

        {enrollments.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            {t('dashboard.noCourses')}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {enrollments.map((enrollment) => (
              <li
                key={enrollment.id}
                className="rounded-brand border border-surface-border p-4"
              >
                <p className="font-medium text-content">{enrollment.course.title}</p>
                {enrollment.batch && (
                  <p className="mt-0.5 text-xs text-content-muted">{enrollment.batch.name}</p>
                )}
                <div
                  className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted"
                  role="progressbar"
                  aria-valuenow={enrollment.percentComplete}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${enrollment.course.title} progress`}
                >
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${enrollment.percentComplete}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-content-muted">
                  {enrollment.percentComplete}% complete
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sessions-heading" className="space-y-3">
        <h2 id="sessions-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
          {t('liveSession.upcoming')}
        </h2>

        {upcomingSessions.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            Nothing scheduled yet.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {upcomingSessions.map((session) => (
              <li key={session.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="text-sm text-content">{session.title}</span>
                <time
                  dateTime={session.scheduledStart.toISOString()}
                  className="text-xs text-content-muted"
                >
                  {formatDateTime(session.scheduledStart, settings.timezone, settings.locale)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
