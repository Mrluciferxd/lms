import type { Metadata } from 'next'
import Link from 'next/link'

import { formatMoney } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { createCourse } from '@/server/catalog/actions'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { NewCourseSection } from './new-course-section'

export const metadata: Metadata = { title: 'Courses' }

const STATUS_STYLES: Record<string, string> = {
  PUBLISHED: 'bg-success/15 text-success',
  DRAFT: 'bg-surface-muted text-content-muted',
  ARCHIVED: 'bg-warning/15 text-warning',
}

export default async function AdminCoursesPage() {
  await requirePermission('course:read', '/admin/courses')
  const settings = await getOrgSettings()

  const courses = await db.course.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      priceMinor: true,
      currency: true,
      _count: { select: { sections: true, enrollments: true, batches: true } },
    },
  })

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-content">Courses</h1>
      </div>

      {courses.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          No courses yet. Create the first one below.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                <th scope="col" className="py-2 pr-4 font-medium">Course</th>
                <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                <th scope="col" className="py-2 pr-4 font-medium">Price</th>
                <th scope="col" className="py-2 pr-4 font-medium">Sections</th>
                <th scope="col" className="py-2 pr-4 font-medium">Batches</th>
                <th scope="col" className="py-2 font-medium">Students</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {courses.map((course) => (
                <tr key={course.id}>
                  <td className="py-3 pr-4">
                    <Link
                      href={`/admin/courses/${course.id}`}
                      className="font-medium text-content hover:text-primary"
                    >
                      {course.title}
                    </Link>
                    <span className="block font-mono text-xs text-content-muted">
                      /{course.slug}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[course.status] ?? ''}`}
                    >
                      {course.status}
                    </span>
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-content-muted">
                    {course.priceMinor != null
                      ? formatMoney(course.priceMinor, course.currency, settings.locale)
                      : '—'}
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-content-muted">
                    {course._count.sections}
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-content-muted">
                    {course._count.batches}
                  </td>
                  <td className="py-3 tabular-nums text-content-muted">
                    {course._count.enrollments}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewCourseSection action={createCourse} />
    </div>
  )
}
