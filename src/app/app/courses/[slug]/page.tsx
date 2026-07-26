import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { formatDate, formatDuration } from '@/lib/utils'
import { requireUser } from '@/server/auth/rbac'
import { isStaffRole } from '@/server/auth/roles'
import { getCourseOutline, type OutlineLesson } from '@/server/catalog/outline'
import { getOrgSettings } from '@/server/org/settings'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  return { title: slug }
}

function LessonRow({
  lesson,
  courseSlug,
  showWarnings,
}: {
  lesson: OutlineLesson
  courseSlug: string
  showWarnings: boolean
}) {
  const unlocked = lesson.access.allowed
  const isCompleted = lesson.progress?.status === 'COMPLETED'

  const content = (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        aria-hidden
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
          isCompleted
            ? 'bg-success text-white'
            : unlocked
              ? 'bg-primary/15 text-primary'
              : 'bg-surface-muted text-content-muted'
        }`}
      >
        {isCompleted ? '✓' : unlocked ? '▶' : '🔒'}
      </span>

      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${unlocked ? 'text-content' : 'text-content-muted'}`}>
          {lesson.title}
        </span>
        {!unlocked && lesson.lockedReason && (
          <span className="block text-xs text-content-muted">{lesson.lockedReason}</span>
        )}
        {showWarnings && lesson.configWarning && (
          <span className="mt-0.5 block text-xs text-warning">⚠ {lesson.configWarning}</span>
        )}
      </span>

      {lesson.isPreview && !isCompleted && (
        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
          Preview
        </span>
      )}

      {lesson.durationSec !== null && (
        <span className="shrink-0 text-xs tabular-nums text-content-muted">
          {formatDuration(lesson.durationSec)}
        </span>
      )}
    </div>
  )

  if (!unlocked) {
    // Rendered as plain content, not a disabled link: there is no href to guess
    // at, and the route would 404 anyway.
    return <li aria-disabled className="opacity-70">{content}</li>
  }

  return (
    <li>
      <Link
        href={`/app/courses/${courseSlug}/lessons/${lesson.id}`}
        className="block transition-colors hover:bg-surface-muted"
      >
        {content}
      </Link>
    </li>
  )
}

export default async function CoursePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const user = await requireUser(`/app/courses/${slug}`)
  const settings = await getOrgSettings()

  const outline = await getCourseOutline(slug, user.id, (date) =>
    formatDate(date, settings.timezone, settings.locale),
  )

  if (!outline) notFound()

  // Staff see configuration warnings; students never do.
  const showWarnings = isStaffRole(user.role)

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold text-content">{outline.title}</h1>
        {outline.subtitle && <p className="text-content-muted">{outline.subtitle}</p>}

        <div className="flex flex-wrap items-center gap-4 text-sm text-content-muted">
          <span>
            {outline.totals.completed} of {outline.totals.lessons} lessons complete
          </span>
          <span aria-hidden>·</span>
          <span>{outline.totals.unlocked} unlocked</span>
        </div>

        <div
          className="h-1.5 max-w-md overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuenow={outline.percentComplete}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Course progress"
        >
          <div className="h-full bg-primary" style={{ width: `${outline.percentComplete}%` }} />
        </div>

        {outline.nextLessonId && (
          <Link href={`/app/courses/${outline.slug}/lessons/${outline.nextLessonId}`}>
            <Button>
              {outline.totals.completed > 0 ? 'Continue where you left off' : 'Start the course'}
            </Button>
          </Link>
        )}
      </header>

      {!outline.enrolled && !showWarnings && (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-3 text-sm text-content-muted">
          You are not enrolled in this course. Preview lessons are available below.
        </p>
      )}

      <div className="space-y-6">
        {outline.sections.map((section, index) => (
          <section key={section.id} aria-labelledby={`section-${section.id}`}>
            <h2 id={`section-${section.id}`} className="mb-2 text-sm font-semibold text-content">
              <span className="text-content-muted">{index + 1}.</span> {section.title}
            </h2>
            {section.summary && (
              <p className="mb-2 text-sm text-content-muted">{section.summary}</p>
            )}
            <ul className="divide-y divide-surface-border overflow-hidden rounded-brand border border-surface-border">
              {section.lessons.map((lesson) => (
                <LessonRow
                  key={lesson.id}
                  lesson={lesson}
                  courseSlug={outline.slug}
                  showWarnings={showWarnings}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
