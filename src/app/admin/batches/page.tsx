import type { Metadata } from 'next'
import Link from 'next/link'

import { t } from '@/lib/labels'
import { formatDate } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { STAFF_ROLES } from '@/server/auth/roles'
import { createBatch } from '@/server/batches/actions'
import { SEAT_OCCUPYING, describeSeats, seatState } from '@/server/batches/capacity'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { NewBatchSection } from './new-batch-section'

export const metadata: Metadata = { title: 'Batches' }

const STATUS_STYLES: Record<string, string> = {
  RUNNING: 'bg-success/15 text-success',
  ENROLLING: 'bg-primary/15 text-primary',
  UPCOMING: 'bg-surface-muted text-content-muted',
  COMPLETED: 'bg-surface-muted text-content-muted',
  CANCELLED: 'bg-danger/15 text-danger',
}

export default async function AdminBatchesPage() {
  await requirePermission('batch:manage', '/admin/batches')
  const settings = await getOrgSettings()

  const [batches, courses, instructors] = await Promise.all([
    db.batch.findMany({
      orderBy: [{ startDate: 'desc' }],
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        startDate: true,
        endDate: true,
        capacity: true,
        instructorId: true,
        course: { select: { title: true } },
        _count: { select: { liveSessions: true } },
      },
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

  // Seat counts in one grouped query rather than one per row: a batch list is
  // the page most likely to grow to a few hundred rows.
  const occupancy = await db.enrollment.groupBy({
    by: ['batchId'],
    where: { batchId: { in: batches.map((batch) => batch.id) }, status: { in: [...SEAT_OCCUPYING] } },
    _count: { _all: true },
  })
  const occupiedByBatch = new Map(
    occupancy.map((row) => [row.batchId, row._count._all] as const),
  )

  // `Batch.instructorId` carries no relation in the schema, so the name is
  // resolved from the staff list already loaded for the form.
  const instructorNames = new Map(instructors.map((user) => [user.id, user.name] as const))

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-content">{t('nav.batches')}</h1>
        <Link href="/admin/batches/sessions" className="text-sm text-primary underline">
          {t('liveSession.plural')} →
        </Link>
      </div>

      {batches.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          {courses.length === 0
            ? 'Create a course first — every batch runs one.'
            : `No ${t('batch.plural').toLowerCase()} yet. Create the first one below.`}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                <th scope="col" className="py-2 pr-4 font-medium">{t('batch.singular')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('course.singular')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                <th scope="col" className="py-2 pr-4 font-medium">Starts</th>
                <th scope="col" className="py-2 pr-4 font-medium">Seats</th>
                <th scope="col" className="py-2 font-medium">Classes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {batches.map((batch) => {
                const seats = seatState(occupiedByBatch.get(batch.id) ?? 0, batch.capacity)
                const instructorName = batch.instructorId
                  ? instructorNames.get(batch.instructorId)
                  : null

                return (
                  <tr key={batch.id}>
                    <td className="py-3 pr-4">
                      <Link
                        href={`/admin/batches/${batch.id}`}
                        className="font-medium text-content hover:text-primary"
                      >
                        {batch.name}
                      </Link>
                      <span className="block font-mono text-xs text-content-muted">
                        {batch.code}
                        {instructorName ? ` · ${instructorName}` : ''}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-content-muted">{batch.course.title}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[batch.status] ?? ''}`}
                      >
                        {batch.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-content-muted">
                      {formatDate(batch.startDate, settings.timezone, settings.locale)}
                      {batch.endDate && (
                        <span className="block text-xs">
                          to {formatDate(batch.endDate, settings.timezone, settings.locale)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-content-muted">
                      {describeSeats(seats)}
                      {seats.overSubscribed && (
                        <span className="block text-xs text-warning">over capacity</span>
                      )}
                      {seats.full && !seats.overSubscribed && (
                        <span className="block text-xs text-warning">full</span>
                      )}
                    </td>
                    <td className="py-3 tabular-nums text-content-muted">
                      {batch._count.liveSessions}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <NewBatchSection
        action={createBatch}
        courses={courses.map((course) => ({ id: course.id, label: course.title }))}
        instructors={instructors.map((user) => ({ id: user.id, label: user.name }))}
      />
    </div>
  )
}
