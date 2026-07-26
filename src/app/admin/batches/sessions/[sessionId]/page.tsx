import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { liveSessionKindLabel, t } from '@/lib/labels'
import { formatDateTime } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { STAFF_ROLES } from '@/server/auth/roles'
import { toLocalDateTimeInput } from '@/server/batches/form-datetime'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { updateLiveSession } from '@/server/sessions/actions'
import { describePhase, sessionPhase } from '@/server/sessions/timing'
import { SessionForm } from '../session-form'
import { SessionControls } from './session-controls'

export const metadata: Metadata = { title: 'Live session' }

export default async function EditSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  await requirePermission('session:manage', `/admin/batches/sessions/${sessionId}`)
  const settings = await getOrgSettings()

  const session = await db.liveSession.findUnique({
    where: { id: sessionId },
    /**
     * `streamKey` is reduced to a boolean and never leaves the server. Selecting
     * it here would put a live broadcast credential into the RSC payload of an
     * ordinary edit page.
     */
    select: {
      id: true,
      kind: true,
      title: true,
      description: true,
      batchId: true,
      courseId: true,
      hostId: true,
      scheduledStart: true,
      scheduledEnd: true,
      actualStart: true,
      actualEnd: true,
      mode: true,
      status: true,
      visibility: true,
      location: true,
      joinUrl: true,
      streamProvider: true,
      recordingAssetId: true,
      tracksAttendance: true,
      capacity: true,
      batch: { select: { id: true, name: true } },
      _count: { select: { attendance: true, gatedLessons: true } },
    },
  })

  if (!session) notFound()

  const [hasStreamKey, batches, courses, hosts] = await Promise.all([
    db.liveSession
      .count({ where: { id: sessionId, NOT: { streamKey: null } } })
      .then((count) => count > 0),
    db.batch.findMany({
      where: {
        OR: [
          { status: { in: ['UPCOMING', 'ENROLLING', 'RUNNING'] } },
          // Keep the current batch selectable even if the cohort has finished.
          ...(session.batchId ? [{ id: session.batchId }] : []),
        ],
      },
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

  const phase = sessionPhase(session, new Date())

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/admin/batches/sessions" className="text-content-muted hover:text-content">
          ← {t('liveSession.plural')}
        </Link>
      </nav>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-content">{session.title}</h1>
          <p className="mt-0.5 text-sm text-content-muted">
            {liveSessionKindLabel(session.kind)} ·{' '}
            {formatDateTime(session.scheduledStart, settings.timezone, settings.locale)} ·{' '}
            {describePhase(phase)}
            {session.batch ? ` · ${session.batch.name}` : ''}
          </p>
        </div>

        {session.tracksAttendance && (
          <Link href={`/admin/attendance/${session.id}`} className="text-sm text-primary underline">
            {t('nav.attendance')} ({session._count.attendance}) →
          </Link>
        )}
      </div>

      <section aria-labelledby="controls-heading" className="space-y-3">
        <h2 id="controls-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
          Controls
        </h2>
        <SessionControls
          sessionId={session.id}
          status={session.status}
          gatedLessonCount={session._count.gatedLessons}
        />
      </section>

      <section aria-labelledby="details-heading" className="space-y-4">
        <h2 id="details-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
          Details
        </h2>
        <SessionForm
          action={(formData) => updateLiveSession(session.id, formData)}
          batches={batches.map((batch) => ({ id: batch.id, label: `${batch.name} (${batch.code})` }))}
          courses={courses.map((course) => ({ id: course.id, label: course.title }))}
          hosts={hosts.map((host) => ({ id: host.id, label: host.name }))}
          initial={{
            kind: session.kind,
            title: session.title,
            description: session.description,
            batchId: session.batchId,
            courseId: session.courseId,
            hostId: session.hostId,
            scheduledStart: toLocalDateTimeInput(session.scheduledStart, settings.timezone),
            scheduledEnd: toLocalDateTimeInput(session.scheduledEnd, settings.timezone),
            mode: session.mode,
            visibility: session.visibility,
            status: session.status,
            location: session.location,
            joinUrl: session.joinUrl,
            streamProvider: session.streamProvider,
            hasStreamKey,
            recordingAssetId: session.recordingAssetId,
            tracksAttendance: session.tracksAttendance,
            capacity: session.capacity,
          }}
          submitLabel="Save session"
        />
      </section>
    </div>
  )
}
