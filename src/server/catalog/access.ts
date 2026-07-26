/**
 * Lesson access authorization.
 *
 * The single decision point for "may this person see this lesson", used by both
 * the student pages and the signed-playback endpoint. Two consumers, one
 * function — a page that renders a lock while the API still hands out a playback
 * token is precisely the bug this prevents.
 *
 * Split into a pure `decideAccess` and a thin database wrapper so the whole
 * matrix — publish state, enrollment lifecycle, expiry, preview, staff bypass,
 * drip — is testable without fixtures.
 *
 * Layering: enrollment is the security boundary; drip is pacing. Drip is checked
 * last, and only for students.
 */

import { cache } from 'react'

import { db } from '@/server/db'
import { isStaffRole } from '@/server/auth/roles'
import { type ReleaseDecision, type ReleaseRule, resolveRelease } from '@/server/batches/release'
import type { EnrollmentStatus, PublishStatus, Role } from '@/generated/prisma/enums'

export type AccessDenialReason =
  | 'NOT_FOUND'
  | 'NOT_AUTHENTICATED'
  | 'NOT_ENROLLED'
  | 'ENROLLMENT_INACTIVE'
  | 'ENROLLMENT_EXPIRED'
  | 'NOT_RELEASED'

/** How access was granted. Recorded on playback grants for the audit trail. */
export type AccessVia = 'PREVIEW' | 'ENROLLMENT' | 'STAFF'

export type AccessDecision =
  | { allowed: true; via: AccessVia }
  | { allowed: false; reason: AccessDenialReason; release?: ReleaseDecision }

export interface AccessEnrollment {
  status: EnrollmentStatus
  enrolledAt: Date
  startsAt: Date | null
  expiresAt: Date | null
  batchStartDate: Date | null
}

export interface AccessInput {
  courseStatus: PublishStatus
  isPreviewLesson: boolean
  viewer: { id: string; role: Role } | null
  enrollment: AccessEnrollment | null
  release: ReleaseRule
  now: Date
}

/**
 * Enrollment states that convey access. COMPLETED is included deliberately:
 * finishing a course should not revoke the library. Time-limited access is
 * expressed through `expiresAt`, not by flipping status.
 */
const ACCESS_BEARING: readonly EnrollmentStatus[] = ['ACTIVE', 'COMPLETED']

export function decideAccess(input: AccessInput): AccessDecision {
  const staff = input.viewer !== null && isStaffRole(input.viewer.role)

  // Unpublished courses are invisible to students — 404, not 403, so the
  // existence of unreleased content is not disclosed.
  if (input.courseStatus !== 'PUBLISHED' && !staff) {
    return { allowed: false, reason: 'NOT_FOUND' }
  }

  // Staff bypass drip: instructors must be able to review locked content before
  // a cohort reaches it, and admins need to verify what they configured.
  if (staff) return { allowed: true, via: 'STAFF' }

  // Preview lessons are the marketing surface — reachable without an account, but
  // only on a published course, which the check above already established.
  if (input.isPreviewLesson) return { allowed: true, via: 'PREVIEW' }

  if (!input.viewer) return { allowed: false, reason: 'NOT_AUTHENTICATED' }

  const enrollment = input.enrollment
  if (!enrollment) return { allowed: false, reason: 'NOT_ENROLLED' }

  if (enrollment.status === 'EXPIRED') {
    return { allowed: false, reason: 'ENROLLMENT_EXPIRED' }
  }
  if (!ACCESS_BEARING.includes(enrollment.status)) {
    // PENDING (payment not settled), PAUSED, CANCELLED.
    return {
      allowed: false,
      reason: enrollment.status === 'PAUSED' ? 'ENROLLMENT_INACTIVE' : 'NOT_ENROLLED',
    }
  }

  // Time-limited access. Checked independently of status because the nightly job
  // that flips status to EXPIRED may not have run yet.
  if (enrollment.expiresAt && enrollment.expiresAt.getTime() <= input.now.getTime()) {
    return { allowed: false, reason: 'ENROLLMENT_EXPIRED' }
  }

  // Access starts later than enrollment (pre-sold cohort).
  if (enrollment.startsAt && enrollment.startsAt.getTime() > input.now.getTime()) {
    return { allowed: false, reason: 'ENROLLMENT_INACTIVE' }
  }

  const release = resolveRelease(input.release, {
    enrolledAt: enrollment.enrolledAt,
    enrollmentStartsAt: enrollment.startsAt,
    batchStartDate: enrollment.batchStartDate,
    now: input.now,
  })

  if (!release.released) {
    return { allowed: false, reason: 'NOT_RELEASED', release }
  }

  return { allowed: true, via: 'ENROLLMENT' }
}

export interface ResolvedLesson {
  id: string
  title: string
  type: string
  courseId: string
  courseSlug: string
  courseTitle: string
  sectionId: string
  videoAssetId: string | null
  durationSec: number | null
  isPreview: boolean
}

export interface LessonAccessResult {
  decision: AccessDecision
  lesson: ResolvedLesson | null
}

/**
 * Loads a lesson and resolves access for a viewer.
 *
 * Uncached. Use this from route handlers, jobs and tests — anywhere outside a
 * React render, where `cache()` has no request scope to key on.
 */
export const loadLessonAccess = async (
  lessonId: string,
  viewerId: string | null,
): Promise<LessonAccessResult> => {
    const lesson = await db.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        title: true,
        type: true,
        isPreview: true,
        durationSec: true,
        videoAssetId: true,
        sectionId: true,
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
        section: {
          select: {
            course: { select: { id: true, slug: true, title: true, status: true } },
          },
        },
      },
    })

    if (!lesson) {
      return { decision: { allowed: false, reason: 'NOT_FOUND' }, lesson: null }
    }

    const course = lesson.section.course

    const viewer = viewerId
      ? await db.user.findUnique({
          where: { id: viewerId },
          select: { id: true, role: true, status: true },
        })
      : null

    // A suspended account is treated as absent rather than as a viewer.
    const activeViewer = viewer && viewer.status === 'ACTIVE' ? { id: viewer.id, role: viewer.role } : null

    const enrollmentRow = activeViewer
      ? await db.enrollment.findFirst({
          where: { userId: activeViewer.id, courseId: course.id },
          select: {
            status: true,
            enrolledAt: true,
            startsAt: true,
            expiresAt: true,
            batch: { select: { startDate: true } },
          },
          // A student who repeated a cohort has several enrollments; the most
          // permissive one decides, so re-enrolling never reduces access.
          orderBy: [{ status: 'asc' }, { enrolledAt: 'desc' }],
        })
      : null

    const decision = decideAccess({
      courseStatus: course.status,
      isPreviewLesson: lesson.isPreview,
      viewer: activeViewer,
      enrollment: enrollmentRow
        ? {
            status: enrollmentRow.status,
            enrolledAt: enrollmentRow.enrolledAt,
            startsAt: enrollmentRow.startsAt,
            expiresAt: enrollmentRow.expiresAt,
            batchStartDate: enrollmentRow.batch?.startDate ?? null,
          }
        : null,
      release: {
        mode: lesson.releaseMode,
        offsetDays: lesson.releaseOffsetDays,
        releaseAt: lesson.releaseAt,
        manuallyReleasedAt: lesson.manuallyReleasedAt,
        gateSession: lesson.releaseAfterSession,
      } satisfies ReleaseRule,
      now: new Date(),
    })

    return {
      decision,
      lesson: {
        id: lesson.id,
        title: lesson.title,
        type: lesson.type,
        courseId: course.id,
        courseSlug: course.slug,
        courseTitle: course.title,
        sectionId: lesson.sectionId,
        videoAssetId: lesson.videoAssetId,
        durationSec: lesson.durationSec,
        isPreview: lesson.isPreview,
      },
    }
}

/**
 * Per-request memoized wrapper. Use from server components: a lesson page, its
 * outline and its sidebar all ask the same question within one render, and this
 * collapses that to a single set of queries.
 */
export const getLessonAccess = cache(loadLessonAccess)
