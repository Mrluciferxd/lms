import type { Metadata } from 'next'
import Link from 'next/link'

import { t } from '@/lib/labels'
import { requireUser } from '@/server/auth/rbac'
import { db } from '@/server/db'

export const metadata: Metadata = { title: 'Courses' }

export default async function CoursesPage() {
  const user = await requireUser('/app/courses')

  const enrollments = await db.enrollment.findMany({
    where: { userId: user.id, status: { in: ['ACTIVE', 'COMPLETED', 'PAUSED'] } },
    select: {
      id: true,
      status: true,
      percentComplete: true,
      course: { select: { slug: true, title: true, subtitle: true } },
      batch: { select: { name: true } },
    },
    orderBy: [{ lastActivityAt: 'desc' }, { enrolledAt: 'desc' }],
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-content">{t('nav.courses')}</h1>

      {enrollments.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          {t('dashboard.noCourses')}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {enrollments.map((enrollment) => (
            <li key={enrollment.id}>
              <Link
                href={`/app/courses/${enrollment.course.slug}`}
                className="block rounded-brand border border-surface-border p-4 transition-colors hover:bg-surface-muted"
              >
                <p className="font-medium text-content">{enrollment.course.title}</p>
                {enrollment.batch && (
                  <p className="mt-0.5 text-xs text-content-muted">{enrollment.batch.name}</p>
                )}
                {enrollment.status === 'PAUSED' && (
                  <p className="mt-1 text-xs text-warning">Enrollment paused</p>
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
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
