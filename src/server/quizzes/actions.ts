/**
 * Quiz server actions — the only path to start an attempt, submit answers, and
 * author quizzes. Every action re-checks against the live user row, because a
 * server action is a directly invocable endpoint and the client passing ids is
 * a hint, not authority. Convention matches ../journals/actions.ts and
 * ../trackers/actions.ts.
 *
 * Grading: SINGLE_CHOICE / MULTI_CHOICE / TRUE_FALSE auto-grade on submit; the
 * action writes `isCorrect` + `points` and sets the attempt's `score`/
 * `maxScore`/`passed`. SHORT_ANSWER / LONG_ANSWER get `isCorrect: null`,
 * `points: 0`, and the attempt's `passed` stays null until a manual grade
 * (a later cut — see quizzes.md).
 */

'use server'

import { db } from '@/server/db'
import { getCurrentUser } from '@/server/auth/rbac'
import { roleHasPermission } from '@/server/auth/roles'
import {
  decideCanStartAttempt,
  loadQuizViewer,
  type QuizViewer,
} from './access'
import {
  countSubmittedAttempts,
  gradeSubmission,
} from './quizzes'
import { parseQuestion, isSubjective, type QuizResponse } from './validation'
import type { PublishStatus, QuestionType } from '@/generated/prisma/enums'

export type ActionResult<T = void> =
  | ({ ok: true; data?: T })
  | { ok: false; reason: string }

const NOT_AUTH = { ok: false, reason: 'You must be signed in.' } as const
const NOT_FOUND = { ok: false, reason: 'Quiz not found.' } as const
const NOT_ALLOWED = { ok: false, reason: 'You cannot do that here.' } as const

type Json = Parameters<typeof db.question.create>[0]['data']['options']

function asJson(value: unknown): Json {
  return value as Json
}

async function loadViewer(): Promise<QuizViewer | null> {
  const user = await getCurrentUser()
  if (!user) return null
  return loadQuizViewer(user.id)
}

// ─── STUDENT: START ATTEMPT ────────────────────────────────────────────────

export async function startAttempt(input: { quizId: string }): Promise<ActionResult<{ attemptId: string }>> {
  const viewer = await loadViewer()
  if (!viewer) return NOT_AUTH

  const quiz = await db.quiz.findUnique({
    where: { id: input.quizId },
    select: { id: true, title: true, status: true, lessonId: true, maxAttempts: true },
  })
  if (!quiz) return NOT_FOUND

  const submitted = await countSubmittedAttempts(quiz.id, viewer.id)
  const decision = decideCanStartAttempt(
    { status: quiz.status, lessonId: quiz.lessonId, maxAttempts: quiz.maxAttempts },
    submitted,
    viewer,
  )
  if (!decision.ok) {
    if (decision.reason === 'MAX_ATTEMPTS_REACHED') {
      return { ok: false, reason: 'You have used all attempts for this quiz.' }
    }
    return NOT_FOUND
  }

  // An in-flight (unsubmitted) attempt is resumed rather than starting a new
  // one — a student who abandons a tab should not burn an attempt.
  const existing = await db.quizAttempt.findFirst({
    where: { quizId: quiz.id, userId: viewer.id, submittedAt: null },
    select: { id: true },
  })
  if (existing) return { ok: true, data: { attemptId: existing.id } }

  const attempt = await db.quizAttempt.create({
    data: { quizId: quiz.id, userId: viewer.id },
    select: { id: true },
  })

  // Pre-create one answer row per question so submit is a flat update and the
  // `@@unique([attemptId, questionId])` index is the shape authority.
  const questions = await db.question.findMany({
    where: { quizId: quiz.id },
    select: { id: true },
  })
  if (questions.length > 0) {
    await db.quizAnswer.createMany({
      data: questions.map((q) => ({
        attemptId: attempt.id,
        questionId: q.id,
        response: asJson({}) ?? {},
        isCorrect: null,
        points: 0,
      })),
      skipDuplicates: true,
    })
  }

  return { ok: true, data: { attemptId: attempt.id } }
}

// ─── STUDENT: SUBMIT ATTEMPT ──────────────────────────────────────────────

export interface SubmitPayload {
  attemptId: string
  /** responses keyed by questionId; each entry is the raw QuizResponse */
  responses: Record<string, unknown>
}

export async function submitAttempt(input: SubmitPayload): Promise<ActionResult<{ passed: boolean | null; score: number; maxScore: number }>> {
  const viewer = await loadViewer()
  if (!viewer) return NOT_AUTH

  const attempt = await db.quizAttempt.findUnique({
    where: { id: input.attemptId },
    select: { id: true, quizId: true, userId: true, submittedAt: true },
  })
  if (!attempt || attempt.userId !== viewer.id) return NOT_FOUND
  if (attempt.submittedAt !== null) {
    return { ok: false, reason: 'This attempt has already been submitted.' }
  }

  const quiz = await db.quiz.findUnique({
    where: { id: attempt.quizId },
    select: { id: true, status: true, lessonId: true, passPercent: true },
  })
  if (!quiz) return NOT_FOUND

  const questions = await db.question.findMany({
    where: { quizId: quiz.id },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      type: true,
      prompt: true,
      explanation: true,
      options: true,
      correctAnswer: true,
      points: true,
      order: true,
    },
  })

  const responses = new Map<string, unknown>()
  for (const [questionId, response] of Object.entries(input.responses ?? {})) {
    responses.set(questionId, response)
  }

  const { answerGrades, score } = gradeSubmission(questions, responses, quiz.passPercent)

  const now = new Date()

  await db.$transaction(async (tx) => {
    for (const [questionId, grade] of answerGrades) {
      const raw = responses.get(questionId)
      await tx.quizAnswer.update({
        where: {
          attemptId_questionId: { attemptId: attempt.id, questionId },
        },
        data: {
          response: asJson(raw ?? {}),
          isCorrect: grade.isCorrect,
          points: grade.points,
        },
      })
    }
    await tx.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        submittedAt: now,
        score: score.score,
        maxScore: score.maxScore,
        passed: score.passed,
      },
    })
  })

  return {
    ok: true,
    data: {
      passed: score.passed,
      score: score.score,
      maxScore: score.maxScore,
    },
  }
}

// ─── ADMIN: QUIZ CRUD ──────────────────────────────────────────────────────

export async function saveQuiz(input: {
  quizId?: string
  title: string
  description?: string | null
  timeLimitMin?: number | null
  passPercent?: number
  maxAttempts?: number
  shuffleQuestions?: boolean
  lessonId?: string | null
}): Promise<ActionResult<{ quizId: string }>> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'course:write')) return NOT_ALLOWED

  const title = input.title.trim()
  if (title === '') return { ok: false, reason: 'Title is required.' }

  const passPercent =
    Number.isInteger(input.passPercent) && input.passPercent! >= 0 && input.passPercent! <= 100
      ? input.passPercent!
      : 60
  const maxAttempts =
    Number.isInteger(input.maxAttempts) && input.maxAttempts! >= 0 ? input.maxAttempts! : 0
  const timeLimitMin =
    Number.isInteger(input.timeLimitMin) && input.timeLimitMin! > 0 ? input.timeLimitMin! : null

  if (input.quizId) {
    await db.quiz.update({
      where: { id: input.quizId },
      data: {
        title,
        description: input.description ?? null,
        timeLimitMin,
        passPercent,
        maxAttempts,
        shuffleQuestions: input.shuffleQuestions ?? false,
        lessonId: input.lessonId ?? null,
      },
    })
    return { ok: true, data: { quizId: input.quizId } }
  }

  const created = await db.quiz.create({
    data: {
      title,
      description: input.description ?? null,
      timeLimitMin,
      passPercent,
      maxAttempts,
      shuffleQuestions: input.shuffleQuestions ?? false,
      lessonId: input.lessonId ?? null,
      status: 'DRAFT',
    },
    select: { id: true },
  })
  return { ok: true, data: { quizId: created.id } }
}

export async function setQuizStatus(input: {
  quizId: string
  status: PublishStatus
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'course:write')) return NOT_ALLOWED

  if (input.status !== 'DRAFT' && input.status !== 'PUBLISHED' && input.status !== 'ARCHIVED') {
    return { ok: false, reason: 'Unknown status.' }
  }

  const existing = await db.quiz.findUnique({
    where: { id: input.quizId },
    select: { id: true },
  })
  if (!existing) return NOT_FOUND

  await db.quiz.update({
    where: { id: input.quizId },
    data: { status: input.status },
  })
  return { ok: true }
}

// ─── ADMIN: QUESTION CRUD ──────────────────────────────────────────────────

export interface QuestionInput {
  questionId?: string
  type: QuestionType
  prompt: string
  explanation?: string | null
  points?: number
  order?: number
  options?: unknown
  correctAnswer?: unknown
}

export async function saveQuestion(input: {
  quizId: string
  question: QuestionInput
}): Promise<ActionResult<{ questionId: string }>> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'course:write')) return NOT_ALLOWED

  const quiz = await db.quiz.findUnique({
    where: { id: input.quizId },
    select: { id: true },
  })
  if (!quiz) return NOT_FOUND

  const prompt = input.question.prompt?.trim() ?? ''
  if (prompt === '') return { ok: false, reason: 'Question prompt is required.' }

  // Validate the option shape through the same parser the reader uses so a
  // malformed admin payload refuses rather than storing a row that the page
  // cannot render. The stored options retain the `correct` flag for the
  // editor; the student shape strips it.
  const parsed = parseQuestion({
    type: input.question.type,
    options: input.question.options ?? [],
    correctAnswer: input.question.correctAnswer ?? null,
    points: input.question.points ?? 1,
  })
  if (
    (input.question.type === 'SINGLE_CHOICE' || input.question.type === 'MULTI_CHOICE') &&
    parsed.options.length < 2
  ) {
    return { ok: false, reason: 'Choice questions need at least two options.' }
  }
  if (
    (input.question.type === 'SINGLE_CHOICE' || input.question.type === 'MULTI_CHOICE') &&
    parsed.correctOptionIds.size === 0
  ) {
    return { ok: false, reason: 'Mark at least one option as correct.' }
  }
  if (input.question.type === 'TRUE_FALSE' && parsed.correctBoolean === null) {
    return { ok: false, reason: 'Set the correct answer for true/false.' }
  }

  const points = parsed.points
  const order = Number.isInteger(input.question.order) ? input.question.order! : 0

  if (input.question.questionId) {
    await db.question.update({
      where: { id: input.question.questionId },
      data: {
        type: input.question.type,
        prompt,
        explanation: input.question.explanation ?? null,
        points,
        order,
        options: asJson(input.question.options ?? []),
        correctAnswer: asJson(input.question.correctAnswer ?? null),
      },
    })
    return { ok: true, data: { questionId: input.question.questionId } }
  }

  const created = await db.question.create({
    data: {
      quizId: input.quizId,
      type: input.question.type,
      prompt,
      explanation: input.question.explanation ?? null,
      points,
      order,
      options: asJson(input.question.options ?? []),
      correctAnswer: asJson(input.question.correctAnswer ?? null),
    },
    select: { id: true },
  })
  return { ok: true, data: { questionId: created.id } }
}

export async function deleteQuestion(input: { questionId: string }): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'course:write')) return NOT_ALLOWED

  await db.question.delete({ where: { id: input.questionId } })
  return { ok: true }
}

export async function deleteQuiz(input: { quizId: string }): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'course:write')) return NOT_ALLOWED

  await db.quiz.delete({ where: { id: input.quizId } })
  return { ok: true }
}
