import type { Metadata } from 'next'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t } from '@/lib/labels'
import { formatDate } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'

export const metadata: Metadata = { title: 'Students' }

const PAGE_SIZE = 100

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'text-success',
  INVITED: 'text-warning',
  SUSPENDED: 'text-danger',
  DEACTIVATED: 'text-content-muted',
}

export default async function AdminStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await requirePermission('student:read', '/admin/students')
  const settings = await getOrgSettings()

  const { q } = await searchParams
  const search = (q ?? '').trim()

  const students = await db.user.findMany({
    where: {
      role: 'STUDENT',
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      createdAt: true,
      enrollments: {
        where: { status: { in: ['ACTIVE', 'PENDING', 'PAUSED', 'COMPLETED'] } },
        select: {
          id: true,
          course: { select: { title: true } },
          batch: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: PAGE_SIZE,
  })

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold text-content">{t('nav.students')}</h1>

        <form method="get" className="flex items-end gap-2">
          <Input
            label="Search"
            name="q"
            defaultValue={search}
            placeholder="Name, email or phone"
            className="h-9"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
      </div>

      {students.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          {search ? `No students match “${search}”.` : 'No students yet.'}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">{t('student.singular')}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t('course.plural')}</th>
                  <th scope="col" className="py-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {students.map((student) => (
                  <tr key={student.id}>
                    <td className="py-3 pr-4">
                      <Link
                        href={`/admin/students/${student.id}`}
                        className="font-medium text-content hover:text-primary"
                      >
                        {student.name}
                      </Link>
                      <span className="block text-xs text-content-muted">
                        {student.email ?? student.phone ?? '—'}
                      </span>
                    </td>
                    <td className={`py-3 pr-4 text-xs font-medium ${STATUS_STYLES[student.status] ?? ''}`}>
                      {student.status}
                    </td>
                    <td className="py-3 pr-4 text-content-muted">
                      {student.enrollments.length === 0 ? (
                        '—'
                      ) : (
                        <ul>
                          {student.enrollments.map((enrollment) => (
                            <li key={enrollment.id} className="text-xs">
                              {enrollment.course.title}
                              {enrollment.batch ? ` · ${enrollment.batch.name}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-3 text-content-muted">
                      {formatDate(student.createdAt, settings.timezone, settings.locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {students.length === PAGE_SIZE && (
            <p className="text-xs text-content-muted">
              Showing the {PAGE_SIZE} most recent. Search to narrow the list.
            </p>
          )}
        </>
      )}
    </div>
  )
}
