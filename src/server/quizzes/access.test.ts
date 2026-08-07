import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  decideCanStartAttempt,
  decideQuizRead,
  type QuizViewer,
} from './access'

const STUDENT = (id = 'u1'): QuizViewer => ({ id, role: 'STUDENT', canManage: false, isStaff: false })
const INSTRUCTOR = (id = 'i1'): QuizViewer => ({ id, role: 'INSTRUCTOR', canManage: true, isStaff: true })
const ADMIN = (id = 'a1'): QuizViewer => ({ id, role: 'ADMIN', canManage: true, isStaff: true })

describe('decideQuizRead', () => {
  it('denies anonymous viewers', () => {
    assert.equal(decideQuizRead({ status: 'PUBLISHED', lessonId: null }, null).ok, false)
  })

  it('students see PUBLISHED quizzes', () => {
    assert.equal(decideQuizRead({ status: 'PUBLISHED', lessonId: null }, STUDENT()).ok, true)
  })

  it('students are denied DRAFT and ARCHIVED with distinct reasons', () => {
    const draft = decideQuizRead({ status: 'DRAFT', lessonId: null }, STUDENT())
    assert.equal(draft.ok, false)
    if (!draft.ok) assert.equal(draft.reason, 'QUIZ_NOT_PUBLISHED')

    const archived = decideQuizRead({ status: 'ARCHIVED', lessonId: null }, STUDENT())
    assert.equal(archived.ok, false)
    if (!archived.ok) assert.equal(archived.reason, 'QUIZ_ARCHIVED')
  })

  it('staff with course:write see every status', () => {
    for (const status of ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const) {
      assert.equal(decideQuizRead({ status, lessonId: null }, INSTRUCTOR()).ok, true)
      assert.equal(decideQuizRead({ status, lessonId: null }, ADMIN()).ok, true)
    }
  })
})

describe('decideCanStartAttempt', () => {
  const published = (maxAttempts: number) => ({
    status: 'PUBLISHED' as const,
    lessonId: null,
    maxAttempts,
  })

  it('allows a student under the limit', () => {
    assert.equal(decideCanStartAttempt(published(3), 2, STUDENT()).ok, true)
  })

  it('allows unlimited attempts when maxAttempts is 0', () => {
    assert.equal(decideCanStartAttempt(published(0), 99, STUDENT()).ok, true)
  })

  it('refuses at the limit', () => {
    const result = decideCanStartAttempt(published(2), 2, STUDENT())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'MAX_ATTEMPTS_REACHED')
  })

  it('refuses a draft quiz for a student before the limit', () => {
    const result = decideCanStartAttempt(
      { status: 'DRAFT', lessonId: null, maxAttempts: 3 },
      0,
      STUDENT(),
    )
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'QUIZ_NOT_PUBLISHED')
  })

  it('lets an instructor preview a DRAFT quiz', () => {
    assert.equal(
      decideCanStartAttempt({ status: 'DRAFT', lessonId: null, maxAttempts: 0 }, 0, INSTRUCTOR()).ok,
      true,
    )
  })
})
