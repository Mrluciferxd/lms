import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { liveSessionKindLabel, t } from '@/lib/labels'
import { formatDateTime } from '@/lib/utils'
import { getCurrentUser } from '@/server/auth/rbac'
import { getOrgSettings, isFeatureEnabled } from '@/server/org/settings'
import { canJoin, describePhase, sessionPhase } from '@/server/sessions/timing'
import { loadSessionForViewer, loadSessionViewer } from '@/server/sessions/visibility'

export const metadata: Metadata = { title: 'Live session' }

export default async function LiveSessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  if (!(await isFeatureEnabled('liveSessions'))) notFound()

  // Not `requireUser`: a PUBLIC session is reachable without an account, and the
  // visibility decision — not the route — is what decides that.
  const user = await getCurrentUser()
  const viewer = await loadSessionViewer(user?.id ?? null)

  const { decision, session } = await loadSessionForViewer(id, viewer)

  // Every denial is a 404. A student who is not in this batch should not be able
  // to learn that the session exists, let alone when it runs.
  if (!decision.visible || !session) notFound()

  const settings = await getOrgSettings()
  const now = new Date()
  const phase = sessionPhase(session, now)
  const joinable = canJoin(session, now) && session.joinUrl !== null

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/app/live" className="text-content-muted hover:text-content">
          ← {t('liveSession.plural')}
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold text-content">{session.title}</h1>
        <p className="mt-1 text-sm text-content-muted">
          {liveSessionKindLabel(session.kind)} ·{' '}
          <time dateTime={session.scheduledStart.toISOString()}>
            {formatDateTime(session.scheduledStart, settings.timezone, settings.locale)}
          </time>
          {session.scheduledEnd && (
            <>
              {' '}
              to {formatDateTime(session.scheduledEnd, settings.timezone, settings.locale)}
            </>
          )}
        </p>
        <p className="mt-0.5 text-sm text-content-muted">
          {describePhase(phase)}
          {session.hostName ? ` · ${session.hostName}` : ''}
          {session.batchName ? ` · ${session.batchName}` : ''}
          {session.courseTitle && !session.batchName ? ` · ${session.courseTitle}` : ''}
        </p>
      </div>

      {session.status === 'CANCELLED' && (
        <p role="status" className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          This {liveSessionKindLabel(session.kind).toLowerCase()} was cancelled.
        </p>
      )}

      {session.description && (
        <p className="whitespace-pre-line text-sm text-content">{session.description}</p>
      )}

      {session.mode !== 'ONLINE' && session.location && (
        <p className="text-sm text-content">
          <span className="text-content-muted">Where: </span>
          {session.location}
        </p>
      )}

      {joinable && session.joinUrl ? (
        <a
          href={session.joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex rounded-brand bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          {t('liveSession.joinNow')}
        </a>
      ) : (
        session.status !== 'CANCELLED' &&
        phase === 'UPCOMING' && (
          <p className="text-sm text-content-muted">
            The join link appears here 15 minutes before the start.
          </p>
        )
      )}

      {session.recordingAssetId && phase === 'ENDED' && (
        <p className="text-sm text-content-muted">
          A {t('liveSession.recording').toLowerCase()} of this session has been captured. It becomes
          watchable once it is published to the {t('course.singular').toLowerCase()}.
        </p>
      )}
    </div>
  )
}
