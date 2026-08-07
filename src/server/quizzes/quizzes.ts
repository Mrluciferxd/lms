/**
 * Quiz read queries.
 *
 * Reads only — writes go through ./actions.ts (start/submit attempt) and
 * the admin CRUD actions. The stored `options` / `correctAnswer` are opaque
 * Json out of the database, so every read re-parses them via
 * `parseQuestion`; corrupted rows degrade to an empty question, never throw.
 *
 * Two shapes:
 *  - Student take: PUBLISHED quiz + questions WITHOUT the correct key
 *    (the student must not see which option is correct before submitting).
 *  - Admin: every status + questions WITH the parsed key (for the editor).
 */

import { db } from '@/server/db'
import { getLessonAccess } from '@/server/catalog/access'
import {
  decideQuizRead,
  loadQuizViewer,
  type QuizViewer,
} from './access'
import {
  parseQuestion,
  parseResponse,
  scoreAnswer,
  scoreAttempt,
  type ParsedQuestion,
  type QuizResponse,
  type AnswerGrade,
  type AttemptScore,
} from './validation'
import type { PublishStatus, QuestionType } from '@/generated/prisma/enums'

// ─── Shared view shapes ────────────────────────────────────────────────────

export interface ViewableQuiz {
  id: string
  title: string
  description: string | null
  timeLimitMin: number | null
  passPercent: number
  maxAttempts: number
  shuffleQuestions: boolean
  status: PublishStatus
  /** The lesson this quiz is attached to, if any — for the "back to lesson" link. */
  lessonId: string | null
  lessonTitle: string | null
  courseSlug: string | null
  questions: ViewableQuestion[]
}

export interface ViewableQuestion {
  id: string
  type: QuestionType
  prompt: string
  points: number
  order: number
  /** Options for choice questions; empty for others. */
  options: { id: string; text: string }[]
  /** Present only in the admin view (the editor); never sent to a student. */
  explanation: string | null
}

export interface ViewableAttempt {
  id: string
  startedAt: Date
  submittedAt: Date | null
  score: number | null
  maxScore: number | null
  passed: boolean | null
  /** Pending = subjective answers ungraded. */
  pending: boolean
}

export interface QuizWithAttempts {
  quiz: ViewableQuiz
  attempts: ViewableAttempt[]
}

const QUIZ_SELECT = {
  id: true,
  title: true,
  description: true,
  timeLimitMin: true,
  passPercent: true,
  maxAttempts: true,
  shuffleQuestions: true,
  status: true,
  lessonId: true,
} as const

interface RawQuestion {
  id: string
  type: QuestionType
  prompt: string
  explanation: string | null
  points: number
  order: number
  options: unknown
  correctAnswer: unknown
}

export function shapeQuestionForStudent(row: RawQuestion): ViewableQuestion {
  return {
    id: row.id,
    type: row.type,
    prompt: row.prompt,
    points: row.points > 0 ? row.points : 1,
    order: row.order,
    options: shapeQuestion(row).options,
    explanation: null,
  }
}

export function shapeQuestionForAdmin(row: RawQuestion): ViewableQuestion {
  return {
    id: row.id,
    type: row.type,
    prompt: row.prompt,
    points: row.points > 0 ? row.points : 1,
    order: row.order,
    options: shapeQuestion(row).options,
    explanation: row.explanation,
  }
}

function shapeQuestion(row: RawQuestion): ParsedQuestion {
  return parseQuestion({
    type: row.type,
    options: row.options,
    correctAnswer: row.correctAnswer,
    points: row.points,
  })
}

async function loadQuizRow(quizId: string) {
  return db.quiz.findUnique({
    where: { id: quizId },
    select: {
      ...QUIZ_SELECT,
      lesson: {
        select: { id: true, title: true, section: { select: { course: { select: { slug: true } } } } },
      },
    },
  })
}

async function loadQuestions(quizId: string): Promise<RawQuestion[]> {
  return db.question.findMany({
    where: { quizId },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      type: true,
      prompt: true,
      explanation: true,
      points: true,
      order: true,
      options: true,
      correctAnswer: true,
    },
  })
}

function shapeAttempt(row: {
  id: string
  startedAt: Date
  submittedAt: Date | null
  score: number | null
  maxScore: number | null
  passed: boolean | null
}): ViewableAttempt {
  return {
    id: row.id,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    score: row.score,
    maxScore: row.maxScore,
    passed: row.passed,
    pending: row.submittedAt !== null && row.passed === null,
  }
}

async function loadAttempts(quizId: string, userId: string): Promise<ViewableAttempt[]> {
  const rows = await db.quizAttempt.findMany({
    where: { quizId, userId },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      startedAt: true,
      submittedAt: true,
      score: true,
      maxScore: true,
      passed: true,
    },
  })
  return rows.map(shapeAttempt)
}

async function lessonTitleFor(quizRow: { lessonId: string | null }): Promise<{ lessonTitle: string | null; courseSlug: string | null }> {
  if (!quizRow.lessonId) return { lessonTitle: null, courseSlug: null }
  const lesson = await db.lesson.findUnique({
    where: { id: quizRow.lessonId },
    select: { title: true, section: { select: { course: { select: { slug: true } } } } },
  })
  if (!lesson) return { lessonTitle: null, courseSlug: null }
  return { lessonTitle: lesson.title, courseSlug: lesson.section.course.slug }
}

// ─── Student reads ─────────────────────────────────────────────────────────

/**
 * Resolves whether a lesson-attached quiz is reachable for a student. Staff
 * bypass; students need an allowed lesson-access decision (enrollment + drip).
 * Standalone quizzes (no lesson) are reachable by any signed-in member.
 */
async function quizReachable(
  quiz: { lessonId: string | null; status: PublishStatus },
  viewer: QuizViewer,
): Promise<boolean> {
  if (!quiz.lessonId) return true
  if (viewer.isStaff) return true
  const access = await getLessonAccess(quiz.lessonId, viewer.id)
  return Boolean(access.lesson && access.decision.allowed)
}

/** All PUBLISHED quizzes reachable by the viewer, with their attempt history. */
export async function listQuizzesForStudent(viewer: QuizViewer): Promise<QuizWithAttempts[]> {
  const rows = await db.quiz.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: [{ title: 'asc' }],
    select: { ...QUIZ_SELECT },
  })

  const out: QuizWithAttempts[] = []
  for (const row of rows) {
    if (!decideQuizRead(row, viewer).ok) continue
    if (!(await quizReachable(row, viewer))) continue

    const questions = (await loadQuestions(row.id)).map(shapeQuestionForStudent)
    const { lessonTitle, courseSlug } = await lessonTitleFor(row)
    const attempts = await loadAttempts(row.id, viewer.id)

    out.push({
      quiz: {
        id: row.id,
        title: row.title,
        description: row.description,
        timeLimitMin: row.timeLimitMin,
        passPercent: row.passPercent,
        maxAttempts: row.maxAttempts,
        shuffleQuestions: row.shuffleQuestions,
        status: row.status,
        lessonId: row.lessonId,
        lessonTitle,
        courseSlug,
        questions,
      },
      attempts,
    })
  }
  return out
}

/** A single quiz for a student to take; null if not visible/reachable. */
export async function loadQuizForStudent(
  quizId: string,
  viewer: QuizViewer,
): Promise<QuizWithAttempts | null> {
  const row = await loadQuizRow(quizId)
  if (!row) return null
  if (!decideQuizRead(row, viewer).ok) return null
  if (!(await quizReachable(row, viewer))) return null

  const questions = (await loadQuestions(row.id)).map(shapeQuestionForStudent)
  const { lessonTitle, courseSlug } = await lessonTitleFor(row)
  const attempts = await loadAttempts(row.id, viewer.id)

  return {
    quiz: {
      id: row.id,
      title: row.title,
      description: row.description,
      timeLimitMin: row.timeLimitMin,
      passPercent: row.passPercent,
      maxAttempts: row.maxAttempts,
      shuffleQuestions: row.shuffleQuestions,
      status: row.status,
      lessonId: row.lessonId,
      lessonTitle,
      courseSlug,
      questions,
    },
    attempts,
  }
}

/** Count of submitted attempts by a user, for the start gate. */
export async function countSubmittedAttempts(quizId: string, userId: string): Promise<number> {
  return db.quizAttempt.count({
    where: { quizId, userId, submittedAt: { not: null } },
  })
}

// ─── Admin reads ───────────────────────────────────────────────────────────

export async function listQuizzesForAdmin(viewer: QuizViewer): Promise<ViewableQuiz[]> {
  if (!viewer.canManage) return []

  const rows = await db.quiz.findMany({
    orderBy: [{ title: 'asc' }],
    select: { ...QUIZ_SELECT },
  })

  const out: ViewableQuiz[] = []
  for (const row of rows) {
    const { lessonTitle, courseSlug } = await lessonTitleFor(row)
    out.push({
      id: row.id,
      title: row.title,
      description: row.description,
      timeLimitMin: row.timeLimitMin,
      passPercent: row.passPercent,
      maxAttempts: row.maxAttempts,
      shuffleQuestions: row.shuffleQuestions,
      status: row.status,
      lessonId: row.lessonId,
      lessonTitle,
      courseSlug,
      questions: [],
    })
  }
  return out
}

export async function loadQuizForAdmin(
  quizId: string,
  viewer: QuizViewer,
): Promise<ViewableQuiz | null> {
  if (!viewer.canManage) return null

  const row = await loadQuizRow(quizId)
  if (!row) return null

  const questions = (await loadQuestions(row.id)).map(shapeQuestionForAdmin)
  const { lessonTitle, courseSlug } = await lessonTitleFor(row)

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    timeLimitMin: row.timeLimitMin,
    passPercent: row.passPercent,
    maxAttempts: row.maxAttempts,
    shuffleQuestions: row.shuffleQuestions,
    status: row.status,
    lessonId: row.lessonId,
    lessonTitle,
    courseSlug,
    questions,
  }
}

// ─── Scoring helper (used by the submit action) ────────────────────────────

/**
 * Scores a submission against the quiz's questions. Returns per-answer grades
 * + the aggregate attempt score. Used by `submitAttempt` after re-parsing the
 * response Json from each answer row.
 */
export function gradeSubmission(
  questions: RawQuestion[],
  responsesByQuestion: Map<string, unknown>,
  passPercent: number,
): {
  answerGrades: Map<string, AnswerGrade>
  score: AttemptScore
} {
  const answerGrades = new Map<string, AnswerGrade>()
  const inputs: { grade: AnswerGrade; maxPoints: number }[] = []

  for (const q of questions) {
    const parsed = shapeQuestion(q)
    const raw = responsesByQuestion.get(q.id)
    const response: QuizResponse = raw !== undefined ? parseResponse(q.type, raw) : emptyFor(q.type)
    const grade = scoreAnswer(parsed, response)
    answerGrades.set(q.id, grade)
    inputs.push({ grade, maxPoints: parsed.points })
  }

  return { answerGrades, score: scoreAttempt(passPercent, inputs) }
}

function emptyFor(type: QuestionType): QuizResponse {
  switch (type) {
    case 'SINGLE_CHOICE':
      return { type, optionId: null }
    case 'MULTI_CHOICE':
      return { type, optionIds: [] }
    case 'TRUE_FALSE':
      return { type, value: null }
    case 'SHORT_ANSWER':
    case 'LONG_ANSWER':
      return { type, text: '' }
  }
}

export { loadQuizViewer }
