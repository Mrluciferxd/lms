import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { liveSessionKindLabel, t } from '@/lib/labels'
import { formatDateTime } from '@/lib/utils'
import { requireUser } from '@/server/auth/rbac'
import { getOrgSettings, isFeatureEnabled } from '@/server/org/settings'
import { canJoin, describePhase, sessionPhase } from '@/server/sessions/timing'
import { listVisibleSessions, loadSessionViewer, type ViewableSession } from '@/server/sessions/visibility'

export const metadata: Metadata = { title: 'Live sessions' }

function SessionRow({
  session,
  when,
  now,
}: {
  session: ViewableSession
  when: string
  now: Date
}) {
  const phase = sessionPhase(session, now)
  const joinable = canJoin(session, now) && session.joinUrl !== null

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <Link
          href={`/app/live/${session.id}`}
          className="block truncate text-sm font-medium text-content hover:text-primary"
        >
          {session.title}
        </Link>
        <span className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
          <span>{liveSessionKindLabel(session.kind)}</span>
          <span aria-hidden>·</span>
          <time dateTime={session.scheduledStart.toISOString()}>{when}</time>
          {session.batchName && (
            <>
              <span aria-hidden>·</span>
              <span>{session.batchName}</span>
            </>
          )}
          {session.status === 'CANCELLED' && (
            <>
              <span aria-hidden>·</span>
              <span className="text-danger">{describePhase(phase)}</span>
            </>
          )}
          {phase === 'LIVE' && (
            <>
              <span aria-hidden>·</span>
              <span className="text-success">{t('dashboard.liveNow')}</span>
            </>
          )}
          {session.recordingAssetId && (
            <>
              <span aria-hidden>·</span>
              <span>{t('liveSession.recording')} available</span>
            </>
          )}
        </span>
      </span>

      {/* The link is only rendered inside the join window, so it cannot be
          copied out of the page days ahead of the class. */}
      {joinable && session.joinUrl && (
        <a
          href={session.joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-brand bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          {t('liveSession.joinNow')}
        </a>
      )}
    </li>
  )
}

export default async function LiveSessionsPage() {
  const user = await requireUser('/app/live')

  // Feature flags gate the route, not only the navigation entry.
  if (!(await isFeatureEnabled('liveSessions'))) notFound()

  const settings = await getOrgSettings()
  const viewer = await loadSessionViewer(user.id)

  const [upcoming, past] = await Promise.all([
    listVisibleSessions(viewer, { window: 'upcoming', take: 25 }),
    listVisibleSessions(viewer, { window: 'past', take: 25 }),
  ])

  const now = new Date()
  const format = (date: Date) => formatDateTime(date, settings.timezone, settings.locale)

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-content">{t('liveSession.plural')}</h1>

      <section aria-labelledby="upcoming-heading" className="space-y-3">
        <h2 id="upcoming-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
          {t('liveSession.upcoming')}
        </h2>

        {upcoming.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            Nothing scheduled yet.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {upcoming.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                when={format(session.scheduledStart)}
                now={now}
              />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past-heading" className="space-y-3">
          <h2 id="past-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
            Past
          </h2>
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {past.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                when={format(session.scheduledStart)}
                now={now}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
