import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { formatDateTime } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { createSection, updateCourse } from '@/server/catalog/actions'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { CourseForm } from '../course-form'
import { AddSectionForm } from './add-section-form'
import { SectionEditor, type AdminLesson } from './section-editor'

export const metadata: Metadata = { title: 'Edit course' }

/** `datetime-local` needs `YYYY-MM-DDTHH:mm` with no timezone suffix. */
function toDatetimeLocal(date: Date | null): string | null {
  if (!date) return null
  return date.toISOString().slice(0, 16)
}

export default async function EditCoursePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requirePermission('course:write', `/admin/courses/${id}`)
  const settings = await getOrgSettings()

  const course = await db.course.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      description: true,
      status: true,
      priceMinor: true,
      accessDurationDays: true,
      sections: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          lessons: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              title: true,
              summary: true,
              type: true,
              order: true,
              isPreview: true,
              isMandatory: true,
              videoAssetId: true,
              durationSec: true,
              releaseMode: true,
              releaseOffsetDays: true,
              releaseAt: true,
              manuallyReleasedAt: true,
              releaseAfterSessionId: true,
              videoAsset: { select: { status: true } },
              _count: { select: { progress: true } },
            },
          },
        },
      },
      liveSessions: {
        orderBy: { scheduledStart: 'asc' },
        select: { id: true, title: true, scheduledStart: true },
      },
    },
  })

  if (!course) notFound()

  const sessionOptions = course.liveSessions.map((session) => ({
    id: session.id,
    label: `${session.title} — ${formatDateTime(session.scheduledStart, settings.timezone, settings.locale)}`,
  }))

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/admin/courses" className="text-content-muted hover:text-content">
          ← Courses
        </Link>
      </nav>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-content">{course.title}</h1>
        <Link
          href={`/app/courses/${course.slug}`}
          className="text-sm text-primary underline"
          // Staff bypass drip, so this previews the outline as configured.
        >
          View as staff →
        </Link>
      </div>

      <section aria-labelledby="details-heading" className="space-y-4">
        <h2 id="details-heading" className="text-sm font-medium uppercase tracking-wide text-content-muted">
          Details
        </h2>
        <CourseForm
          action={(formData) => updateCourse(course.id, formData)}
          initial={{
            title: course.title,
            slug: course.slug,
            subtitle: course.subtitle,
            description: course.description,
            status: course.status,
            priceMinor: course.priceMinor,
            accessDurationDays: course.accessDurationDays,
          }}
          submitLabel="Save course"
        />
      </section>

      <section aria-labelledby="curriculum-heading" className="space-y-4">
        <h2
          id="curriculum-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Curriculum
        </h2>

        {course.sections.length === 0 && (
          <p className="text-sm text-content-muted">
            No sections yet. Add one to start building the curriculum.
          </p>
        )}

        {course.sections.map((section) => (
          <SectionEditor
            key={section.id}
            sectionId={section.id}
            title={section.title}
            sessions={sessionOptions}
            lessons={section.lessons.map(
              (lesson): AdminLesson => ({
                id: lesson.id,
                title: lesson.title,
                summary: lesson.summary,
                type: lesson.type,
                order: lesson.order,
                isPreview: lesson.isPreview,
                isMandatory: lesson.isMandatory,
                videoAssetId: lesson.videoAssetId,
                durationSec: lesson.durationSec,
                releaseMode: lesson.releaseMode,
                releaseOffsetDays: lesson.releaseOffsetDays,
                releaseAt: toDatetimeLocal(lesson.releaseAt),
                releaseAfterSessionId: lesson.releaseAfterSessionId,
                manuallyReleased: lesson.manuallyReleasedAt !== null,
                assetStatus: lesson.videoAsset?.status ?? null,
                progressCount: lesson._count.progress,
              }),
            )}
          />
        ))}

        <AddSectionForm action={(formData) => createSection(course.id, formData)} />
      </section>
    </div>
  )
}
