import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  parseQuestion,
  parseResponse,
  scoreAnswer,
  scoreAttempt,
  isSubjective,
  type QuizResponse,
} from './validation'

function question(overrides: Partial<Parameters<typeof parseQuestion>[0]>) {
  return parseQuestion({
    type: 'SINGLE_CHOICE',
    options: [],
    correctAnswer: null,
    points: 1,
    ...overrides,
  })
}

describe('parseQuestion', () => {
  it('keeps valid options and drops empty/dup ids', () => {
    const q = question({
      type: 'SINGLE_CHOICE',
      options: [
        { id: 'a', text: 'A', correct: true },
        { id: 'a', text: 'dup' },
        { id: '', text: 'no id' },
        { id: 'b', text: 'B' },
        { id: 'c', text: 5 },
        null,
      ],
      correctAnswer: null,
    })
    assert.deepEqual(q.options, [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ])
    assert.deepEqual([...q.correctOptionIds], ['a'])
  })

  it('correctAnswer overrides the inline correct flag', () => {
    const q = question({
      type: 'MULTI_CHOICE',
      options: [
        { id: 'a', text: 'A', correct: true },
        { id: 'b', text: 'B' },
        { id: 'c', text: 'C' },
      ],
      correctAnswer: { optionIds: ['b', 'c'] },
    })
    assert.deepEqual([...q.correctOptionIds].sort(), ['b', 'c'])
  })

  it('parses TRUE_FALSE key from a bare boolean', () => {
    const q = question({ type: 'TRUE_FALSE', correctAnswer: true })
    assert.equal(q.correctBoolean, true)
  })

  it('parses TRUE_FALSE key from { value }', () => {
    const q = question({ type: 'TRUE_FALSE', correctAnswer: { value: false } })
    assert.equal(q.correctBoolean, false)
  })

  it('coerces a non-positive points to 1', () => {
    assert.equal(question({ points: 0 }).points, 1)
    assert.equal(question({ points: -3 }).points, 1)
    assert.equal(question({ points: 2.5 }).points, 1)
    assert.equal(question({ points: 5 }).points, 5)
  })
})

describe('parseResponse', () => {
  it('degrades garbage to an empty answer for each type', () => {
    assert.deepEqual(parseResponse('SINGLE_CHOICE', null), { type: 'SINGLE_CHOICE', optionId: null })
    assert.deepEqual(parseResponse('MULTI_CHOICE', 'x'), { type: 'MULTI_CHOICE', optionIds: [] })
    assert.deepEqual(parseResponse('TRUE_FALSE', 7), { type: 'TRUE_FALSE', value: null })
    assert.deepEqual(parseResponse('SHORT_ANSWER', { text: 5 }), { type: 'SHORT_ANSWER', text: '' })
    assert.deepEqual(parseResponse('LONG_ANSWER', {}), { type: 'LONG_ANSWER', text: '' })
  })

  it('parses each type shape', () => {
    assert.deepEqual(parseResponse('SINGLE_CHOICE', { optionId: 'a' }), {
      type: 'SINGLE_CHOICE',
      optionId: 'a',
    })
    assert.deepEqual(parseResponse('MULTI_CHOICE', { optionIds: ['a', 'b', 9] }), {
      type: 'MULTI_CHOICE',
      optionIds: ['a', 'b'],
    })
    assert.deepEqual(parseResponse('TRUE_FALSE', { value: true }), { type: 'TRUE_FALSE', value: true })
    assert.deepEqual(parseResponse('SHORT_ANSWER', { text: 'hello' }), {
      type: 'SHORT_ANSWER',
      text: 'hello',
    })
  })
})

describe('scoreAnswer', () => {
  it('awards full points for a correct single choice', () => {
    const q = question({
      type: 'SINGLE_CHOICE',
      options: [
        { id: 'a', text: 'A', correct: true },
        { id: 'b', text: 'B' },
      ],
      points: 3,
    })
    assert.deepEqual(scoreAnswer(q, { type: 'SINGLE_CHOICE', optionId: 'a' }), {
      isCorrect: true,
      points: 3,
    })
    assert.deepEqual(scoreAnswer(q, { type: 'SINGLE_CHOICE', optionId: 'b' }), {
      isCorrect: false,
      points: 0,
    })
    assert.deepEqual(scoreAnswer(q, { type: 'SINGLE_CHOICE', optionId: null }), {
      isCorrect: false,
      points: 0,
    })
  })

  it('requires exact multi-choice match (no partial credit)', () => {
    const q = question({
      type: 'MULTI_CHOICE',
      options: [
        { id: 'a', text: 'A', correct: true },
        { id: 'b', text: 'B', correct: true },
        { id: 'c', text: 'C' },
      ],
      points: 2,
    })
    assert.deepEqual(scoreAnswer(q, { type: 'MULTI_CHOICE', optionIds: ['a', 'b'] }), {
      isCorrect: true,
      points: 2,
    })
    assert.deepEqual(scoreAnswer(q, { type: 'MULTI_CHOICE', optionIds: ['a'] }), {
      isCorrect: false,
      points: 0,
    })
    assert.deepEqual(scoreAnswer(q, { type: 'MULTI_CHOICE', optionIds: ['a', 'b', 'c'] }), {
      isCorrect: false,
      points: 0,
    })
  })

  it('grades true/false strictly', () => {
    const q = question({ type: 'TRUE_FALSE', correctAnswer: true, points: 1 })
    assert.deepEqual(scoreAnswer(q, { type: 'TRUE_FALSE', value: true }), {
      isCorrect: true,
      points: 1,
    })
    assert.deepEqual(scoreAnswer(q, { type: 'TRUE_FALSE', value: false }), {
      isCorrect: false,
      points: 0,
    })
    assert.deepEqual(scoreAnswer(q, { type: 'TRUE_FALSE', value: null }), {
      isCorrect: false,
      points: 0,
    })
  })

  it('leaves subjective answers ungraded', () => {
    const q = question({ type: 'SHORT_ANSWER', points: 4 })
    assert.deepEqual(scoreAnswer(q, { type: 'SHORT_ANSWER', text: 'anything' }), {
      isCorrect: null,
      points: 0,
    })
  })

  it('zeroes a response that does not match the question type', () => {
    const q = question({ type: 'TRUE_FALSE', correctAnswer: true })
    assert.deepEqual(scoreAnswer(q, { type: 'SINGLE_CHOICE', optionId: 'a' }), {
      isCorrect: false,
      points: 0,
    })
  })
})

describe('scoreAttempt', () => {
  it('passes when the percent meets the threshold', () => {
    const result = scoreAttempt(70, [
      { grade: { isCorrect: true, points: 2 }, maxPoints: 2 },
      { grade: { isCorrect: true, points: 2 }, maxPoints: 2 },
      { grade: { isCorrect: false, points: 0 }, maxPoints: 2 },
    ])
    assert.deepEqual(result, { score: 4, maxScore: 6, passed: false, allGraded: true })
  })

  it('passes just above the threshold', () => {
    const result = scoreAttempt(60, [
      { grade: { isCorrect: true, points: 2 }, maxPoints: 2 },
      { grade: { isCorrect: true, points: 2 }, maxPoints: 2 },
      { grade: { isCorrect: false, points: 0 }, maxPoints: 2 },
    ])
    assert.equal(result.passed, true)
  })

  it('clamps a malformed passPercent to 60', () => {
    const result = scoreAttempt(999, [{ grade: { isCorrect: true, points: 1 }, maxPoints: 1 }])
    assert.equal(result.passed, true)
  })

  it('leaves passed null when any answer is subjective', () => {
    const result = scoreAttempt(60, [
      { grade: { isCorrect: true, points: 1 }, maxPoints: 1 },
      { grade: { isCorrect: null, points: 0 }, maxPoints: 4 },
    ])
    assert.equal(result.allGraded, false)
    assert.equal(result.passed, null)
    assert.equal(result.score, 1)
    assert.equal(result.maxScore, 5)
  })

  it('returns passed null when maxScore is zero', () => {
    const result = scoreAttempt(60, [])
    assert.equal(result.allGraded, true)
    assert.equal(result.passed, null)
  })
})

describe('isSubjective', () => {
  it('flags short and long answer', () => {
    assert.equal(isSubjective('SHORT_ANSWER'), true)
    assert.equal(isSubjective('LONG_ANSWER'), true)
    assert.equal(isSubjective('SINGLE_CHOICE'), false)
    assert.equal(isSubjective('MULTI_CHOICE'), false)
    assert.equal(isSubjective('TRUE_FALSE'), false)
  })
})
