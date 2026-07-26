/**
 * Lesson progress and its rollup onto the enrollment.
 *
 * `Enrollment.percentComplete` is denormalized on purpose: it appears on every
 * dashboard, roster and reminder query, and aggregating LessonProgress each time
 * is the query that degrades first as a cohort grows. It is recomputed here on
 * every write rather than trusted from the client.
 */

import { db } from '@/server/db'
import { loadLessonAccess } from './access'

export interface RecordProgressInput {
  userId: string
  lessonId: string
  positionSec: number
  completed: boolean
}

export type RecordProgressResult =
  | { ok: true; percentComplete: number }
  | { ok: false; status: 403 | 404 }

/**
 * Percentage of *mandatory* lessons completed.
 *
 * Optional lessons are excluded from the denominator so a course with bonus
 * material can still reach 100%, which matters because certificate issuance keys
 * off completion.
 */
async function recomputeCourseProgress(
  userId: string,
  courseId: string,
): Promise<number> {
  const [mandatoryTotal, completedCount] = await Promise.all([
    db.lesson.count({
      where: { section: { courseId }, isMandatory: true },
    }),
    db.lessonProgress.count({
      where: {
        userId,
        status: 'COMPLETED',
        lesson: { section: { courseId }, isMandatory: true },
      },
    }),
  ])

  if (mandatoryTotal === 0) return 0
  return Math.min(100, Math.round((completedCount / mandatoryTotal) * 100))
}

export async function recordProgress(
  input: RecordProgressInput,
): Promise<RecordProgressResult> {
  /**
   * Re-checks access rather than trusting the caller. A student could otherwise
   * POST progress for a locked lesson and, since completion drives certificates
   * and the "next lesson" pointer, march through a course they cannot open.
   */
  const { decision, lesson } = await loadLessonAccess(input.lessonId, input.userId)
  if (!lesson) return { ok: false, status: 404 }
  if (!decision.allowed) return { ok: false, status: 403 }

  const positionSec = Math.max(0, Math.floor(input.positionSec))
  const now = new Date()

  const existing = await db.lessonProgress.findUnique({
    where: { userId_lessonId: { userId: input.userId, lessonId: input.lessonId } },
    select: { status: true, watchedSec: true, completedAt: true },
  })

  // Completion is sticky: rewatching a finished lesson must not un-complete it.
  const alreadyComplete = existing?.status === 'COMPLETED'
  const status = alreadyComplete || input.completed ? 'COMPLETED' : 'IN_PROGRESS'

  await db.lessonProgress.upsert({
    where: { userId_lessonId: { userId: input.userId, lessonId: input.lessonId } },
    create: {
      userId: input.userId,
      lessonId: input.lessonId,
      status,
      lastPositionSec: positionSec,
      watchedSec: positionSec,
      firstViewedAt: now,
      completedAt: status === 'COMPLETED' ? now : null,
    },
    update: {
      status,
      lastPositionSec: positionSec,
      // Furthest point reached, not the latest position — scrubbing backwards
      // should not reduce recorded watch time.
      watchedSec: Math.max(existing?.watchedSec ?? 0, positionSec),
      completedAt: existing?.completedAt ?? (status === 'COMPLETED' ? now : null),
    },
  })

  const percentComplete = await recomputeCourseProgress(input.userId, lesson.courseId)

  await db.enrollment.updateMany({
    where: { userId: input.userId, courseId: lesson.courseId },
    data: {
      percentComplete,
      lastActivityAt: now,
      // Mark the enrollment complete when everything mandatory is done, but never
      // revoke a completion already recorded.
      ...(percentComplete >= 100 ? { status: 'COMPLETED', completedAt: now } : {}),
    },
  })

  return { ok: true, percentComplete }
}
