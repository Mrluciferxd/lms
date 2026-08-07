/**
 * Quiz access authorization.
 *
 * Publish-state mirrors the catalog: a DRAFT quiz is invisible to students
 * (404, not 403) and editable by staff with `course:write`. PUBLISHED quizzes
 * are take-able by any signed-in member — a coaching institute's "test series"
 * is a quiz with no lesson attached, open to every student, which is why the
 * coaching pack counts attempts with a COUNTER tracker.
 *
 * A quiz attached to a lesson additionally requires lesson access
 * (enrollment + drip), checked in the read layer via `getLessonAccess` — that
 * gate is not pure (it reads the live enrollment row), so it lives in
 * `quizzes.ts`, not here.
 */

import { db } from '@/server/db'
import { isStaffRole, roleHasPermission } from '@/server/auth/roles'
import type { PublishStatus, Role } from '@/generated/prisma/enums'

export type QuizReadDenialReason = 'NOT_AUTHENTICATED' | 'QUIZ_NOT_PUBLISHED' | 'QUIZ_ARCHIVED'

export interface QuizDefinitionSubject {
  status: PublishStatus
  lessonId: string | null
}

/**
 * May the viewer *see* this quiz in a list or open its page?
 *
 * Staff with `course:write` see every status (they author quizzes); other
 * signed-in members see PUBLISHED only. ARCHIVED quizzes are hidden from
 * students even though they remain in the table — same posture as archived
 * courses.
 */
export function decideQuizRead(
  quiz: QuizDefinitionSubject,
  viewer: QuizViewer | null,
): { ok: true } | { ok: false; reason: QuizReadDenialReason } {
  if (!viewer) return { ok: false, reason: 'NOT_AUTHENTICATED' }

  if (quiz.status === 'PUBLISHED') return { ok: true }

  // Staff with course:write may author and preview DRAFT quizzes, and review /
  // restore ARCHIVED ones — both are invisible to students.
  if (viewer.canManage) return { ok: true }

  return quiz.status === 'ARCHIVED'
    ? { ok: false, reason: 'QUIZ_ARCHIVED' }
    : { ok: false, reason: 'QUIZ_NOT_PUBLISHED' }
}

/**
 * May the viewer *take* this quiz (start an attempt)?
 *
 * A DRAFT quiz is take-able by its author for a preview, but not by students.
 * Lesson-attached quizzes additionally need lesson access — checked in the
 * read layer, not here.
 */
export function decideCanTakeQuiz(
  quiz: QuizDefinitionSubject,
  viewer: QuizViewer | null,
): { ok: true } | { ok: false; reason: QuizReadDenialReason } {
  return decideQuizRead(quiz, viewer)
}

export type AttemptStartDenialReason = QuizReadDenialReason | 'MAX_ATTEMPTS_REACHED'

/**
 * May the viewer start a new attempt? Enforces `maxAttempts` (0 = unlimited)
 * against the count of already-submitted attempts. An in-flight attempt that
 * has not been submitted is NOT counted — a student abandoning a tab should
 * not burn an attempt; the cron that reaps stale attempts is the reaper, not
 * the start gate.
 */
export function decideCanStartAttempt(
  quiz: QuizDefinitionSubject & { maxAttempts: number },
  submittedAttempts: number,
  viewer: QuizViewer | null,
): { ok: true } | { ok: false; reason: AttemptStartDenialReason } {
  const take = decideCanTakeQuiz(quiz, viewer)
  if (!take.ok) return take

  if (quiz.maxAttempts > 0 && submittedAttempts >= quiz.maxAttempts) {
    return { ok: false, reason: 'MAX_ATTEMPTS_REACHED' }
  }
  return { ok: true }
}

export interface QuizViewer {
  id: string
  role: Role
  /** Holds `course:write` — the quiz authoring permission (admin/owner/instructor). */
  canManage: boolean
  isStaff: boolean
}

/** Loads the per-page quiz viewer. Mirrors `loadJournalViewer` / `loadTrackerViewer`. */
export async function loadQuizViewer(viewerId: string | null): Promise<QuizViewer | null> {
  if (!viewerId) return null

  const user = await db.user.findUnique({
    where: { id: viewerId },
    select: { id: true, role: true, status: true },
  })

  if (!user || user.status !== 'ACTIVE') return null

  return {
    id: user.id,
    role: user.role,
    canManage: roleHasPermission(user.role, 'course:write'),
    isStaff: isStaffRole(user.role),
  }
}
