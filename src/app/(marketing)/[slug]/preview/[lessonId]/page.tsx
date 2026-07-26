import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { t } from '@/lib/labels'
import { formatDuration } from '@/lib/utils'
import { findLandingPage, getPreviewLesson } from '@/server/marketing/content'
import { checkoutHref, enquiryHref, landingHref } from '@/server/marketing/links'
import { absoluteUrl, isIndexable, summarize } from '@/server/marketing/seo'
import { isFeatureEnabled } from '@/server/org/settings'

/**
 * A free preview lesson, open to anyone.
 *
 * Authorization is `decideAccess` with a null viewer — the same decision the
 * playback endpoint makes — so this route serves exactly the lessons the client
 * flagged `isPreview` on a published course, and nothing an enrolment or a staff
 * session might otherwise unlock. Anything else 404s rather than 403s: a visitor
 * guessing lesson ids should not learn which ones exist.
 *
 * KNOWN GAP: video does not play here. `issuePlayback` refuses a request with no
 * viewer (src/server/media/playback.ts) because a grant and a forensic watermark
 * both need an account to bind to, so a VIDEO preview shows its details and a
 * sign-in prompt rather than a player. That is stated plainly to the visitor
 * instead of being dressed up as a broken player. TEXT and EMBED previews are
 * fully public.
 */

async function resolvePreview(slug: string, lessonId: string) {
  const landing = findLandingPage(slug)
  if (!landing) return null

  const lesson = await getPreviewLesson(landing.courseSlug, lessonId)
  return lesson ? { landing, lesson } : null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; lessonId: string }>
}): Promise<Metadata> {
  const { slug, lessonId } = await params
  const resolved = await resolvePreview(slug, lessonId)
  if (!resolved) return {}

  const url = absoluteUrl(`/${slug}/preview/${lessonId}`)

  return {
    title: resolved.lesson.title,
    description: summarize(resolved.lesson.summary),
    alternates: { canonical: url },
    openGraph: { type: 'article', url, title: resolved.lesson.title },
    robots: { index: isIndexable(), follow: isIndexable() },
  }
}

export default async function PreviewLessonPage({
  params,
}: {
  params: Promise<{ slug: string; lessonId: string }>
}) {
  const { slug, lessonId } = await params
  const resolved = await resolvePreview(slug, lessonId)
  if (!resolved) notFound()

  const { landing, lesson } = resolved
  const selfServeCheckout = await isFeatureEnabled('selfServeCheckout')

  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={landingHref(slug)} className="text-content-muted hover:text-content">
          ← {lesson.courseTitle}
        </Link>
      </nav>

      <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-content-muted">
        Free preview
      </p>

      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-content">{lesson.title}</h1>

      {lesson.durationSec !== null && (
        <p className="mt-2 text-sm text-content-muted">{formatDuration(lesson.durationSec)}</p>
      )}

      {lesson.summary && (
        <div className="mt-6 space-y-4 text-base leading-relaxed text-content-muted">
          {lesson.summary
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean)
            .map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
        </div>
      )}

      {lesson.embedUrl && (
        <div className="mt-8 overflow-hidden rounded-brand border border-surface-border">
          <iframe
            src={lesson.embedUrl}
            title={lesson.title}
            allowFullScreen
            className="aspect-video w-full"
          />
        </div>
      )}

      {lesson.hasVideo && (
        <div className="mt-8 rounded-brand border border-surface-border bg-surface-muted px-5 py-6">
          <h2 className="text-base font-semibold text-content">Watch this {t('lesson.singular')}</h2>
          <p className="mt-1 text-sm text-content-muted">
            Video is streamed to a signed-in account so playback can be secured to the viewer. Sign
            in — or enrol — and it opens straight away.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={`/sign-in?next=${encodeURIComponent(`/app/courses/${lesson.courseSlug}/lessons/${lesson.id}`)}`}
            >
              <Button>{t('action.signIn')}</Button>
            </Link>
            <Link
              href={
                selfServeCheckout ? checkoutHref(lesson.courseSlug) : enquiryHref(landing.slug)
              }
            >
              <Button variant="secondary">
                {selfServeCheckout ? 'Enroll now' : 'Request a call back'}
              </Button>
            </Link>
          </div>
        </div>
      )}

      <div className="mt-12 rounded-brand bg-primary px-6 py-8 text-center">
        <h2 className="text-xl font-semibold text-primary-foreground">
          Want the rest of {lesson.courseTitle}?
        </h2>
        <div className="mt-5 flex justify-center">
          <Link href={landingHref(slug)}>
            <Button variant="secondary">See the full {t('course.singular')}</Button>
          </Link>
        </div>
      </div>
    </article>
  )
}
