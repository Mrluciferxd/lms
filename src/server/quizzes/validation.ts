/**
 * Quiz validation — the pure value layer.
 *
 * A `Question` stores its body as Json: `options` (an array of
 * `{ id, text, correct? }` for choice questions) and an optional
 * `correctAnswer`. Core parses both defensively and scores a student response
 * against the parsed key. The same coercion runs on write (admin authoring)
 * and read (scoring an attempt), so a hand-corrupted row and a stray client
 * payload both degrade to a safe default rather than throwing.
 *
 * Grading split:
 *   SINGLE_CHOICE / MULTI_CHOICE / TRUE_FALSE — auto-graded; `isCorrect` is a
 *   boolean and `points` is awarded 0 or `question.points`.
 *   SHORT_ANSWER / LONG_ANSWER — subjective; `isCorrect` is null and `points`
 *   is 0 until a manual grade (a later cut). The attempt's `passed` stays null
 *   until every answer is graded.
 */

import type { QuestionType } from '@/generated/prisma/enums'

export interface QuestionOption {
  id: string
  text: string
}

export interface ParsedQuestion {
  type: QuestionType
  options: QuestionOption[]
  /** Set of option ids marked correct. Empty for subjective types. */
  correctOptionIds: Set<string>
  /** TRUE_FALSE key. Null for everything else. */
  correctBoolean: boolean | null
  points: number
}

export function parseQuestion(raw: {
  type: QuestionType
  options: unknown
  correctAnswer: unknown
  points: number
}): ParsedQuestion {
  const options: QuestionOption[] = []
  const correctOptionIds = new Set<string>()

  if (Array.isArray(raw.options)) {
    const seen = new Set<string>()
    for (const entry of raw.options) {
      const row = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null
      const id = typeof row?.id === 'string' ? row.id.trim() : ''
      const text = typeof row?.text === 'string' ? row.text.trim() : ''
      if (id === '' || text === '' || seen.has(id)) continue
      seen.add(id)
      options.push({ id, text })
      if (row?.correct === true) correctOptionIds.add(id)
    }
  }

  // A stored `correctAnswer` overrides the inline `correct` flag for choice
  // questions — it is how an admin corrects a key without rewriting options.
  if (raw.correctAnswer !== null && typeof raw.correctAnswer === 'object') {
    const ans = raw.correctAnswer as Record<string, unknown>
    if (Array.isArray(ans.optionIds)) {
      correctOptionIds.clear()
      for (const id of ans.optionIds) {
        if (typeof id === 'string' && options.some((o) => o.id === id)) correctOptionIds.add(id)
      }
    }
  }

  // TRUE_FALSE key lives in correctAnswer { value: true } or a bare boolean.
  let correctBoolean: boolean | null = null
  if (raw.type === 'TRUE_FALSE') {
    if (typeof raw.correctAnswer === 'boolean') correctBoolean = raw.correctAnswer
    else if (
      raw.correctAnswer !== null &&
      typeof raw.correctAnswer === 'object' &&
      typeof (raw.correctAnswer as Record<string, unknown>).value === 'boolean'
    ) {
      correctBoolean = (raw.correctAnswer as Record<string, unknown>).value as boolean
    }
  }

  return {
    type: raw.type,
    options,
    correctOptionIds,
    correctBoolean,
    points: Number.isInteger(raw.points) && raw.points > 0 ? raw.points : 1,
  }
}

/**
 * The response shape a student sends. Choice questions send option ids;
 * TRUE_FALSE sends a boolean; subjective questions send text.
 */
export type QuizResponse =
  | { type: 'SINGLE_CHOICE'; optionId: string | null }
  | { type: 'MULTI_CHOICE'; optionIds: string[] }
  | { type: 'TRUE_FALSE'; value: boolean | null }
  | { type: 'SHORT_ANSWER'; text: string }
  | { type: 'LONG_ANSWER'; text: string }

/**
 * Parses an untrusted stored response Json into the tagged union. A response
 * that does not match its question's type degrades to an empty answer.
 */
export function parseResponse(type: QuestionType, raw: unknown): QuizResponse {
  if (typeof raw !== 'object' || raw === null) return emptyResponse(type)
  const r = raw as Record<string, unknown>

  switch (type) {
    case 'SINGLE_CHOICE':
      return { type, optionId: typeof r.optionId === 'string' ? r.optionId : null }
    case 'MULTI_CHOICE':
      return {
        type,
        optionIds: Array.isArray(r.optionIds)
          ? r.optionIds.filter((id): id is string => typeof id === 'string')
          : [],
      }
    case 'TRUE_FALSE':
      return { type, value: typeof r.value === 'boolean' ? r.value : null }
    case 'SHORT_ANSWER':
    case 'LONG_ANSWER':
      return { type, text: typeof r.text === 'string' ? r.text : '' }
  }
}

function emptyResponse(type: QuestionType): QuizResponse {
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

export interface AnswerGrade {
  isCorrect: boolean | null
  points: number
}

/**
 * Grades one answer. Returns `isCorrect: null` for subjective types so the
 * attempt stays "pending grade"; auto-graded types return a strict boolean.
 */
export function scoreAnswer(question: ParsedQuestion, response: QuizResponse): AnswerGrade {
  if (question.type !== response.type) return { isCorrect: false, points: 0 }

  switch (question.type) {
    case 'SINGLE_CHOICE': {
      const r = response as Extract<QuizResponse, { type: 'SINGLE_CHOICE' }>
      const ok = r.optionId !== null && question.correctOptionIds.has(r.optionId)
      return { isCorrect: ok, points: ok ? question.points : 0 }
    }

    case 'MULTI_CHOICE': {
      const r = response as Extract<QuizResponse, { type: 'MULTI_CHOICE' }>
      const selected = new Set(r.optionIds)
      if (selected.size === 0) return { isCorrect: false, points: 0 }
      // Full match required — partial credit is a later cut (see decisions.md).
      const sameSize = selected.size === question.correctOptionIds.size
      const allIn = r.optionIds.every((id) => question.correctOptionIds.has(id))
      const ok = sameSize && allIn
      return { isCorrect: ok, points: ok ? question.points : 0 }
    }

    case 'TRUE_FALSE': {
      const r = response as Extract<QuizResponse, { type: 'TRUE_FALSE' }>
      const ok = r.value !== null && question.correctBoolean === r.value
      return { isCorrect: ok, points: ok ? question.points : 0 }
    }

    case 'SHORT_ANSWER':
    case 'LONG_ANSWER':
      return { isCorrect: null, points: 0 }
  }
}

export interface AttemptScore {
  score: number
  maxScore: number
  /** Null when any subjective answer remains ungraded. */
  passed: boolean | null
  /** False until every answer has a non-null `isCorrect`. */
  allGraded: boolean
}

/**
 * Aggregates per-answer grades into an attempt score. Auto-only attempts are
 * decided immediately; subjective attempts leave `passed` null.
 *
 * `maxPoints` is the question's potential points, separate from the grade's
 * awarded `points` (which is 0 on a miss) — otherwise the max could not be
 * reconstructed from failed answers.
 */
export function scoreAttempt(
  passPercent: number,
  answers: { grade: AnswerGrade; maxPoints: number }[],
): AttemptScore {
  const maxScore = answers.reduce((sum, a) => sum + a.maxPoints, 0)
  const score = answers.reduce(
    (sum, a) => sum + (a.grade.isCorrect === true ? a.maxPoints : 0),
    0,
  )
  const allGraded = answers.every((a) => a.grade.isCorrect !== null)

  if (!allGraded) {
    return { score, maxScore, passed: null, allGraded: false }
  }

  if (maxScore === 0) {
    return { score: 0, maxScore: 0, passed: null, allGraded: true }
  }

  const percent = (score / maxScore) * 100
  const threshold = Number.isFinite(passPercent) && passPercent >= 0 && passPercent <= 100
    ? passPercent
    : 60
  return { score, maxScore, passed: percent >= threshold, allGraded: true }
}

export function isSubjective(type: QuestionType): boolean {
  return type === 'SHORT_ANSWER' || type === 'LONG_ANSWER'
}
