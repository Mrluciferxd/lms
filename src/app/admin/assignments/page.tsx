import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { formatDateTime } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { isFeatureEnabled, getOrgSettings } from '@/server/org/settings'
import { listAllAssignmentsForStaff, gradingCounts } from '@/server/assignments/assignments'
import { createAssignment, setAssignmentStatus } from '@/server/assignments/actions'
import { db } from '@/server/db'

export const metadata: Metadata = { title: 'Assignments · Admin' }

export default async function AdminAssignmentsPage() {
  if (!(await isFeatureEnabled('assignments'))) notFound()
  await requirePermission('assignment:manage', '/admin/assignments')

  const settings = await getOrgSettings()
  const format = (date: Date) => formatDateTime(date, settings.timezone, settings.locale)

  const [assignments, courses, batches] = await Promise.all([
    listAllAssignmentsForStaff(),
    db.course.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: { title: 'asc' },
      select: { id: true, title: true },
    }),
    db.batch.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, course: { select: { title: true } } },
    }),
  ])

  const counts = await gradingCounts(assignments.map((row) => row.id))

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-content">Assignments</h1>
        <p className="text-sm text-content-muted">
          Author, publish and grade student work. Drafts are invisible to students; publishing
          surfaces the assignment to its audience (course or batch roster).
        </p>
      </header>

      <section aria-labelledby="new-assignment" className="space-y-3">
        <h2
          id="new-assignment"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          New assignment
        </h2>
        <CreateAssignmentForm courses={courses} batches={batches} />
      </section>

      <section aria-labelledby="all-assignments" className="space-y-3">
        <h2
          id="all-assignments"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          All assignments ({assignments.length})
        </h2>

        {assignments.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            No assignments yet. Use the form above to create one.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {assignments.map((assignment) => {
              const count = counts.get(assignment.id)
              return (
                <li
                  key={assignment.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/assignments/${assignment.id}`}
                      className="block truncate text-sm font-medium text-content hover:text-primary"
                    >
                      {assignment.title}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
                      <span
                        className={
                          'rounded-full px-2 py-0.5 uppercase tracking-wide ' +
                          (assignment.status === 'PUBLISHED'
                            ? 'bg-success/10 text-success'
                            : assignment.status === 'ARCHIVED'
                              ? 'bg-surface-muted text-content-muted'
                              : 'bg-warning/10 text-warning')
                        }
                      >
                        {assignment.status}
                      </span>
                      {assignment.courseTitle && <span>· {assignment.courseTitle}</span>}
                      {assignment.batchName && <span>· {assignment.batchName}</span>}
                      {assignment.dueAt && <span>· due {format(assignment.dueAt)}</span>}
                      {count && (
                        <span>
                          · {count.submitted} grading · {count.graded} graded
                          {count.resubmitRequested > 0 && ` · ${count.resubmitRequested} to redo`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {assignment.status === 'DRAFT' && (
                      <form
                        action={async () => {
                          'use server'
                          await setAssignmentStatus({
                            assignmentId: assignment.id,
                            status: 'PUBLISHED',
                          })
                        }}
                      >
                        <button
                          type="submit"
                          className="rounded-brand bg-primary px-3 py-1 text-xs text-primary-foreground"
                        >
                          Publish
                        </button>
                      </form>
                    )}
                    {assignment.status === 'PUBLISHED' && (
                      <form
                        action={async () => {
                          'use server'
                          await setAssignmentStatus({
                            assignmentId: assignment.id,
                            status: 'ARCHIVED',
                          })
                        }}
                      >
                        <button
                          type="submit"
                          className="rounded-brand border border-surface-border px-3 py-1 text-xs text-content-muted hover:bg-surface-muted"
                        >
                          Archive
                        </button>
                      </form>
                    )}
                    {assignment.status === 'ARCHIVED' && (
                      <form
                        action={async () => {
                          'use server'
                          await setAssignmentStatus({
                            assignmentId: assignment.id,
                            status: 'PUBLISHED',
                          })
                        }}
                      >
                        <button
                          type="submit"
                          className="rounded-brand border border-surface-border px-3 py-1 text-xs text-content-muted hover:bg-surface-muted"
                        >
                          Re-publish
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

interface CourseOption {
  id: string
  title: string
}
interface BatchOption {
  id: string
  name: string
  course: { title: string } | null
}

function CreateAssignmentForm({ courses, batches }: { courses: CourseOption[]; batches: BatchOption[] }) {
  return (
    <form
      action={async (formData: FormData) => {
        'use server'
        const { createAssignment } = await import('@/server/assignments/actions')
        const title = String(formData.get('title') ?? '')
        const instructionsValue = formData.get('instructions')
        const instructions =
          instructionsValue === null || String(instructionsValue).length === 0
            ? null
            : String(instructionsValue)
        const courseIdValue = formData.get('courseId')
        const courseId =
          courseIdValue === null || String(courseIdValue) === 'none'
            ? null
            : String(courseIdValue)
        const batchIdValue = formData.get('batchId')
        const batchId =
          batchIdValue === null || String(batchIdValue) === 'none'
            ? null
            : String(batchIdValue)
        const maxScoreValue = formData.get('maxScore')
        const maxScore =
          maxScoreValue === null || String(maxScoreValue).length === 0
            ? null
            : Number(maxScoreValue)
        const dueAtValue = formData.get('dueAt')
        const dueAt =
          dueAtValue === null || String(dueAtValue).length === 0
            ? null
            : new Date(String(dueAtValue))
        await createAssignment({ title, instructions, courseId, batchId, dueAt, maxScore })
      }}
      className="grid gap-3 rounded-brand border border-surface-border bg-surface p-4 sm:grid-cols-2"
    >
      <label className="space-y-1 text-sm sm:col-span-2">
        <span className="text-content-muted">Title</span>
        <input
          name="title"
          required
          maxLength={200}
          className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
      </label>
      <label className="space-y-1 text-sm sm:col-span-2">
        <span className="text-content-muted">Instructions</span>
        <textarea
          name="instructions"
          maxLength={20_000}
          rows={5}
          className="block w-full resize-y rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-content-muted">Course</span>
        <select
          name="courseId"
          defaultValue="none"
          className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        >
          <option value="none">(no course)</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-content-muted">Batch</span>
        <select
          name="batchId"
          defaultValue="none"
          className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        >
          <option value="none">(no batch)</option>
          {batches.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.name}
              {batch.course ? ` · ${batch.course.title}` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-content-muted">Due date (org timezone)</span>
        <input
          type="datetime-local"
          name="dueAt"
          className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-content-muted">Max score</span>
        <input
          type="number"
          name="maxScore"
          defaultValue={100}
          min={0}
          max={10_000}
          className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
      </label>
      <div className="sm:col-span-2 flex justify-end">
        <button
          type="submit"
          className="rounded-brand bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Create as draft
        </button>
      </div>
    </form>
  )
}
