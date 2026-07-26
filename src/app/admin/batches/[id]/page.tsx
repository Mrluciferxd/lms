import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t } from '@/lib/labels'
import { formatDate, formatDateTime } from '@/lib/utils'
import { can, requirePermission } from '@/server/auth/rbac'
import { STAFF_ROLES } from '@/server/auth/roles'
import { updateBatch } from '@/server/batches/actions'
import { describeSeats } from '@/server/batches/capacity'
import { toLocalDateInput } from '@/server/batches/form-datetime'
import { findEnrollableStudents, getBatchRoster, listSiblingBatches } from '@/server/batches/roster'
import { describeRecurrence, parseSchedule } from '@/server/batches/schedule'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { describePhase, sessionPhase } from '@/server/sessions/timing'
import { BatchForm } from '../batch-form'
import { DeleteBatchButton } from './delete-batch-button'
import { RosterPanel, type RosterRow } from './roster-panel'
import { SessionsPanel, type BatchSessionRow } from './sessions-panel'

export const metadata: Metadata = { title: 'Batch' }

export default async function BatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ q?: string }>
}) {
  const { id } = await params
  const { q } = await searchParams

  await requirePermission('batch:manage', `/admin/batches/${id}`)
  // Instructors hold batch:manage but not enrollment:manage, and ops staff the
  // reverse — so the controls are resolved per permission, not per page.
  const [settings, canManageEnrollment, canManageSessions] = await Promise.all([
    getOrgSettings(),
    can('enrollment:manage'),
    can('session:manage'),
  ])

  const batch = await db.batch.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      status: true,
      startDate: true,
      endDate: true,
      capacity: true,
      instructorId: true,
      schedule: true,
      courseId: true,
      course: { select: { id: true, title: true } },
    },
  })

  if (!batch) notFound()

  const search = (q ?? '').trim()

  const [roster, enrollable, siblings, sessions, courses, instructors] = await Promise.all([
    getBatchRoster(batch.id, batch.capacity),
    findEnrollableStudents(batch.id, search, 50),
    listSiblingBatches(batch.courseId, batch.id),
    db.liveSession.findMany({
      where: { batchId: batch.id },
      // streamKey is deliberately absent — see src/server/sessions/actions.ts.
      select: {
        id: true,
        title: true,
        kind: true,
        scheduledStart: true,
        scheduledEnd: true,
        actualEnd: true,
        status: true,
        tracksAttendance: true,
        _count: { select: { attendance: true } },
      },
      orderBy: { scheduledStart: 'asc' },
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

  const schedule = parseSchedule(batch.schedule)
  const now = new Date()

  const sessionRows = sessions.map(
    (session): BatchSessionRow => ({
      id: session.id,
      title: session.title,
      kind: session.kind,
      when: formatDateTime(session.scheduledStart, settings.timezone, settings.locale),
      status: session.status,
      phaseLabel: describePhase(sessionPhase(session, now)),
      tracksAttendance: session.tracksAttendance,
      markedCount: session._count.attendance,
    }),
  )

  const rosterRows = roster.entries.map(
    (entry): RosterRow => ({
      enrollmentId: entry.enrollmentId,
      userId: entry.userId,
      name: entry.name,
      email: entry.email,
      status: entry.status,
      enrolledOn: formatDate(entry.enrolledAt, settings.timezone, settings.locale),
      percentComplete: entry.percentComplete,
    }),
  )

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/admin/batches" className="text-content-muted hover:text-content">
          ← {t('nav.batches')}
        </Link>
      </nav>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-content">{batch.name}</h1>
          <p className="mt-0.5 text-sm text-content-muted">
            <span className="font-mono">{batch.code}</span> · {batch.course.title} ·{' '}
            {describeSeats(roster.seats)}
          </p>
        </div>
        <Link href="/admin/batches/sessions" className="text-sm text-primary underline">
          All {t('liveSession.plural').toLowerCase()} →
        </Link>
      </div>

      <section aria-labelledby="details-heading" className="space-y-4">
        <h2 id="details-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
          Details
        </h2>
        <BatchForm
          action={(formData) => updateBatch(batch.id, formData)}
          courses={courses.map((course) => ({ id: course.id, label: course.title }))}
          instructors={instructors.map((user) => ({ id: user.id, label: user.name }))}
          initial={{
            courseId: batch.courseId,
            name: batch.name,
            code: batch.code,
            description: batch.description,
            status: batch.status,
            startDate: toLocalDateInput(batch.startDate, settings.timezone),
            endDate: toLocalDateInput(batch.endDate, settings.timezone),
            capacity: batch.capacity,
            instructorId: batch.instructorId,
            rrule: readRrule(batch.schedule),
            startTime: readStartTime(batch.schedule),
            durationMin: readDuration(batch.schedule),
          }}
          submitLabel="Save batch"
        />
      </section>

      <section aria-labelledby="roster-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="roster-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
            Roster
          </h2>

          {canManageEnrollment && (
            <form method="get" className="flex items-end gap-2">
              <Input
                label="Find a student to add"
                name="q"
                defaultValue={search}
                placeholder="Name, email or phone"
                className="h-9"
              />
              <Button type="submit" variant="secondary" size="sm">
                Search
              </Button>
            </form>
          )}
        </div>

        <RosterPanel
          batchId={batch.id}
          rows={rosterRows}
          enrollable={enrollable.map((student) => ({
            id: student.id,
            label: student.email ? `${student.name} — ${student.email}` : student.name,
          }))}
          siblingBatches={siblings.map((sibling) => ({
            id: sibling.id,
            label: `${sibling.name} (${sibling.code})`,
          }))}
          canManage={canManageEnrollment}
          seatsLabel={describeSeats(roster.seats)}
          full={roster.seats.full}
        />
      </section>

      <section aria-labelledby="sessions-heading" className="space-y-4">
        <h2 id="sessions-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
          {t('liveSession.plural')}
        </h2>

        <SessionsPanel
          batchId={batch.id}
          sessions={sessionRows}
          scheduleSummary={
            schedule.status === 'valid' ? describeRecurrence(schedule.recurrence) : null
          }
          scheduleError={schedule.status === 'invalid' ? schedule.error : null}
          defaultFrom={toLocalDateInput(batch.startDate, settings.timezone)}
          defaultTo={toLocalDateInput(
            batch.endDate ?? new Date(batch.startDate.getTime() + 90 * 86_400_000),
            settings.timezone,
          )}
          canManage={canManageSessions}
        />
      </section>

      <section aria-labelledby="danger-heading" className="space-y-3 border-t border-surface-border pt-6">
        <h2 id="danger-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
          Danger zone
        </h2>
        <DeleteBatchButton batchId={batch.id} name={batch.name} />
      </section>
    </div>
  )
}

/**
 * The schedule JSON is admin-authored data, so the form re-renders whatever is
 * stored — including a value the parser rejected. Showing an empty field for an
 * invalid rule would silently discard it on the next save.
 */
function readRrule(schedule: unknown): string {
  const value = (schedule as Record<string, unknown> | null)?.rrule
  return typeof value === 'string' ? value : ''
}

function readStartTime(schedule: unknown): string {
  const value = (schedule as Record<string, unknown> | null)?.startTime
  return typeof value === 'string' ? value : ''
}

function readDuration(schedule: unknown): number | null {
  const value = (schedule as Record<string, unknown> | null)?.durationMin
  return typeof value === 'number' ? value : null
}
