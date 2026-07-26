/**
 * Course outline with per-lesson access state.
 *
 * Deliberately three queries regardless of course size: course-with-sections-and-
 * lessons, the viewer's enrollment, and the viewer's progress. Access is then
 * decided in memory by the same `decideAccess` the playback endpoint uses, so the
 * lock a student sees and the lock the API enforces can never disagree.
 *
 * Calling `loadLessonAccess` per lesson would have been simpler and would have
 * issued three queries per lesson — a 60-lesson course would be 180 round trips
 * to render one page.
 */

import { db } from '@/server/db'
import { describeRelease } from '@/server/batches/release'
import { decideAccess, type AccessDecision, type AccessEnrollment } from './access'
import type { LessonType, ProgressStatus } from '@/generated/prisma/enums'

export interface OutlineLesson {
  id: string
  title: string
  summary: string | null
  type: LessonType
  durationSec: number | null
  isPreview: boolean
  hasVideo: boolean
  access: AccessDecision
  /** Student-facing lock explanation, null when unlocked. */
  lockedReason: string | null
  progress: { status: ProgressStatus; positionSec: number } | null
  /** Set when the release rule is misconfigured. Staff-only in the UI. */
  configWarning: string | null
}

export interface OutlineSection {
  id: string
  title: string
  summary: string | null
  lessons: OutlineLesson[]
}

export interface CourseOutline {
  courseId: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  sections: OutlineSection[]
  enrolled: boolean
  percentComplete: number
  totals: { lessons: number; unlocked: number; completed: number }
  nextLessonId: string | null
}

export async function getCourseOutline(
  slug: string,
  viewerId: string | null,
  formatDate: (date: Date) => string,
): Promise<CourseOutline | null> {
  const course = await db.course.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      description: true,
      status: true,
      sections: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          summary: true,
          lessons: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              title: true,
              summary: true,
              type: true,
              durationSec: true,
              isPreview: true,
              videoAssetId: true,
              releaseMode: true,
              releaseOffsetDays: true,
              releaseAt: true,
              manuallyReleasedAt: true,
              releaseAfterSession: {
                select: {
                  id: true,
                  title: true,
                  scheduledStart: true,
                  actualEnd: true,
                  status: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!course) return null

  const viewer = viewerId
    ? await db.user.findUnique({
        where: { id: viewerId },
        select: { id: true, role: true, status: true },
      })
    : null

  const activeViewer = viewer && viewer.status === 'ACTIVE' ? { id: viewer.id, role: viewer.role } : null

  const enrollmentRow = activeViewer
    ? await db.enrollment.findFirst({
        where: { userId: activeViewer.id, courseId: course.id },
        select: {
          status: true,
          enrolledAt: true,
          startsAt: true,
          expiresAt: true,
          percentComplete: true,
          batch: { select: { startDate: true } },
        },
        orderBy: [{ status: 'asc' }, { enrolledAt: 'desc' }],
      })
    : null

  const enrollment: AccessEnrollment | null = enrollmentRow
    ? {
        status: enrollmentRow.status,
        enrolledAt: enrollmentRow.enrolledAt,
        startsAt: enrollmentRow.startsAt,
        expiresAt: enrollmentRow.expiresAt,
        batchStartDate: enrollmentRow.batch?.startDate ?? null,
      }
    : null

  const lessonIds = course.sections.flatMap((section) => section.lessons.map((l) => l.id))

  const progressRows = activeViewer
    ? await db.lessonProgress.findMany({
        where: { userId: activeViewer.id, lessonId: { in: lessonIds } },
        select: { lessonId: true, status: true, lastPositionSec: true },
      })
    : []

  const progressByLesson = new Map(progressRows.map((row) => [row.lessonId, row]))
  const now = new Date()

  let unlocked = 0
  let completed = 0
  let nextLessonId: string | null = null

  const sections: OutlineSection[] = course.sections.map((section) => ({
    id: section.id,
    title: section.title,
    summary: section.summary,
    lessons: section.lessons.map((lesson) => {
      const access = decideAccess({
        courseStatus: course.status,
        isPreviewLesson: lesson.isPreview,
        viewer: activeViewer,
        enrollment,
        release: {
          mode: lesson.releaseMode,
          offsetDays: lesson.releaseOffsetDays,
          releaseAt: lesson.releaseAt,
          manuallyReleasedAt: lesson.manuallyReleasedAt,
          gateSession: lesson.releaseAfterSession,
        },
        now,
      })

      const progress = progressByLesson.get(lesson.id)
      const isCompleted = progress?.status === 'COMPLETED'

      if (access.allowed) {
        unlocked += 1
        // First unlocked, unfinished lesson is where "continue" should go.
        if (!isCompleted && !nextLessonId) nextLessonId = lesson.id
      }
      if (isCompleted) completed += 1

      return {
        id: lesson.id,
        title: lesson.title,
        summary: lesson.summary,
        type: lesson.type,
        durationSec: lesson.durationSec,
        isPreview: lesson.isPreview,
        hasVideo: lesson.videoAssetId !== null,
        access,
        lockedReason: access.allowed
          ? null
          : access.reason === 'NOT_RELEASED' && access.release
            ? describeRelease(access.release, formatDate)
            : 'Not available',
        progress: progress
          ? { status: progress.status, positionSec: progress.lastPositionSec }
          : null,
        configWarning: !access.allowed ? (access.release?.warning ?? null) : null,
      }
    }),
  }))

  return {
    courseId: course.id,
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description,
    sections,
    enrolled: enrollmentRow !== null,
    percentComplete: enrollmentRow?.percentComplete ?? 0,
    totals: { lessons: lessonIds.length, unlocked, completed },
    nextLessonId,
  }
}
