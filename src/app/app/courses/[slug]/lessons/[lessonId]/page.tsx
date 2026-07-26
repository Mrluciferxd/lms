import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { VideoPlayer } from '@/components/player/video-player'
import { formatDate } from '@/lib/utils'
import { requireUser } from '@/server/auth/rbac'
import { describeRelease } from '@/server/batches/release'
import { getLessonAccess } from '@/server/catalog/access'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'

export const metadata: Metadata = { title: 'Lesson' }

export default async function LessonPage({
  params,
}: {
  params: Promise<{ slug: string; lessonId: string }>
}) {
  const { slug, lessonId } = await params
  const user = await requireUser(`/app/courses/${slug}/lessons/${lessonId}`)
  const settings = await getOrgSettings()

  const { decision, lesson } = await getLessonAccess(lessonId, user.id)

  /**
   * A locked lesson 404s rather than rendering a "locked" page. The outline
   * already communicates the lock with its unlock date; a reachable page here
   * would confirm the lesson's existence and title to someone who guessed the id.
   */
  if (!lesson || !decision.allowed) {
    if (decision.allowed === false && decision.reason === 'NOT_RELEASED') {
      const reason = decision.release
        ? describeRelease(decision.release, (date) =>
            formatDate(date, settings.timezone, settings.locale),
          )
        : null

      return (
        <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
          <h1 className="text-xl font-semibold text-content">Not available yet</h1>
          <p className="text-sm text-content-muted">{reason ?? 'This lesson is locked.'}</p>
          <Link href={`/app/courses/${slug}`} className="inline-block text-sm text-primary underline">
            Back to the course
          </Link>
        </div>
      )
    }
    notFound()
  }

  // Resume point, so the player can seek on load.
  const progress = await db.lessonProgress.findUnique({
    where: { userId_lessonId: { userId: user.id, lessonId: lesson.id } },
    select: { lastPositionSec: true },
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/courses/${slug}`} className="text-content-muted hover:text-content">
          ← {lesson.courseTitle}
        </Link>
      </nav>

      <h1 className="text-xl font-semibold text-content">{lesson.title}</h1>

      {lesson.videoAssetId ? (
        <VideoPlayer
          lessonId={lesson.id}
          title={lesson.title}
          durationSec={lesson.durationSec}
          initialPositionSec={progress?.lastPositionSec ?? 0}
        />
      ) : (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          This lesson has no video attached yet.
        </p>
      )}
    </div>
  )
}
