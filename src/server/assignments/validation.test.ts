import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type AssignmentFieldIssue,
  type GradeIssue,
  type SubmissionFieldIssue,
  MAX_ATTACHMENT_IDS,
  MAX_FEEDBACK_LENGTH,
  MAX_INSTRUCTIONS_LENGTH,
  MAX_SCORE_CEILING,
  MAX_SUBMISSION_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  isScoreInRange,
  validateAssignment,
  validateGrade,
  validateSubmission,
} from './validation'

describe('assignment validation — title', () => {
  it('rejects an empty title', () => {
    const issues = validateAssignment({ title: '   ' })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'title')
  })
  it('accepts a normal title', () => {
    assert.equal(validateAssignment({ title: 'Trade Plan Submission' }).length, 0)
  })
  it('rejects a title over MAX_TITLE_LENGTH', () => {
    // Exact-boundary test on both sides: an off-by-one would let a 201-char title through.
    assert.equal(validateAssignment({ title: 'x'.repeat(MAX_TITLE_LENGTH) }).length, 0)
    assert.equal(validateAssignment({ title: 'x'.repeat(MAX_TITLE_LENGTH + 1) }).length, 1)
  })
  it('always trims title whitespace before counting length', () => {
    assert.equal(
      validateAssignment({ title: `   ${'x'.repeat(MAX_TITLE_LENGTH)}   ` }).length,
      0,
    )
  })
})

describe('assignment validation — instructions', () => {
  it('accepts a null instructions field', () => {
    assert.equal(validateAssignment({ title: 'T', instructions: null }).length, 0)
  })
  it('accepts instructions up to MAX_INSTRUCTIONS_LENGTH', () => {
    assert.equal(
      validateAssignment({ title: 'T', instructions: 'x'.repeat(MAX_INSTRUCTIONS_LENGTH) }).length,
      0,
    )
  })
  it('rejects instructions over MAX_INSTRUCTIONS_LENGTH', () => {
    const issues = validateAssignment({
      title: 'T',
      instructions: 'x'.repeat(MAX_INSTRUCTIONS_LENGTH + 1),
    })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'instructions')
  })
})

describe('assignment validation — maxScore', () => {
  it('accepts a null/undefined maxScore (means: use default)', () => {
    assert.equal(validateAssignment({ title: 'T', maxScore: null }).length, 0)
    assert.equal(validateAssignment({ title: 'T', maxScore: undefined }).length, 0)
  })
  it('accepts the boundary score MAX_SCORE_CEILING', () => {
    assert.equal(validateAssignment({ title: 'T', maxScore: MAX_SCORE_CEILING }).length, 0)
  })
  it('rejects a score above MAX_SCORE_CEILING', () => {
    const issues = validateAssignment({ title: 'T', maxScore: MAX_SCORE_CEILING + 1 })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'maxScore')
  })
  it('rejects a negative score', () => {
    const issues = validateAssignment({ title: 'T', maxScore: -1 })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'maxScore')
  })
  it('rejects a non-integer score', () => {
    const issues = validateAssignment({ title: 'T', maxScore: 50.5 })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'maxScore')
  })
})

describe('assignment validation — attachments', () => {
  it('rejects more than MAX_ATTACHMENT_IDS attachments', () => {
    const ids = Array.from({ length: MAX_ATTACHMENT_IDS + 1 }, (_, i) => `att-${i}`)
    const issues = validateAssignment({ title: 'T', attachmentIds: ids })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'attachmentIds')
  })
  it('accepts exactly MAX_ATTACHMENT_IDS attachments', () => {
    const ids = Array.from({ length: MAX_ATTACHMENT_IDS }, (_, i) => `att-${i}`)
    assert.equal(validateAssignment({ title: 'T', attachmentIds: ids }).length, 0)
  })
})

describe('submission validation', () => {
  it('rejects an empty submission with no attachments', () => {
    const issues = validateSubmission({ contentText: '   ', attachmentIds: [] })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'contentText')
  })
  it('accepts an empty text when attachments are present', () => {
    assert.equal(
      validateSubmission({ contentText: '', attachmentIds: ['att-1'] }).length,
      0,
    )
  })
  it('rejects a submission body longer than MAX_SUBMISSION_TEXT_LENGTH', () => {
    // Boundary on both sides — a 50_001-char paste must fail at the surface.
    assert.equal(
      validateSubmission({ contentText: 'x'.repeat(MAX_SUBMISSION_TEXT_LENGTH) }).length,
      0,
    )
    const issues = validateSubmission({
      contentText: 'x'.repeat(MAX_SUBMISSION_TEXT_LENGTH + 1),
    })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'contentText')
  })
  it('always trims text before counting', () => {
    assert.equal(
      validateSubmission({
        contentText: `   ${'x'.repeat(MAX_SUBMISSION_TEXT_LENGTH)}   `,
      }).length,
      0,
    )
  })
  it('rejects more than MAX_ATTACHMENT_IDS attachments on a submission', () => {
    const ids = Array.from({ length: MAX_ATTACHMENT_IDS + 1 }, (_, i) => `att-${i}`)
    const issues = validateSubmission({ contentText: 'a', attachmentIds: ids })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'attachmentIds')
  })
})

describe('grade validation', () => {
  it('accepts a null score (means: no numeric grade)', () => {
    assert.equal(validateGrade({ score: null }).length, 0)
  })
  it('accepts a zero score', () => {
    assert.equal(validateGrade({ score: 0 }).length, 0)
  })
  it('rejects a negative score', () => {
    const issues = validateGrade({ score: -1 })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'score')
  })
  it('rejects a non-integer score', () => {
    const issues = validateGrade({ score: 7.5 })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'score')
  })
  it('accepts feedback up to MAX_FEEDBACK_LENGTH', () => {
    assert.equal(
      validateGrade({ score: 5, feedback: 'x'.repeat(MAX_FEEDBACK_LENGTH) }).length,
      0,
    )
  })
  it('rejects feedback over MAX_FEEDBACK_LENGTH', () => {
    const issues = validateGrade({
      score: 5,
      feedback: 'x'.repeat(MAX_FEEDBACK_LENGTH + 1),
    })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'feedback')
  })
})

describe('isScoreInRange', () => {
  it('true for a score within the bounds', () => {
    assert.equal(isScoreInRange(50, 100), true)
    assert.equal(isScoreInRange(0, 100), true)
    assert.equal(isScoreInRange(100, 100), true)
  })
  it('false for a score above max', () => {
    assert.equal(isScoreInRange(101, 100), false)
  })
  it('false for a score below zero', () => {
    assert.equal(isScoreInRange(-1, 100), false)
  })
  it('false for a non-integer score', () => {
    assert.equal(isScoreInRange(50.5, 100), false)
  })
  it('false for a non-integer maxScore', () => {
    assert.equal(isScoreInRange(50, 100.5), false)
  })
  it('false for a maxScore of zero or less (avoid div-by-zero downstream)', () => {
    assert.equal(isScoreInRange(0, 0), false)
    assert.equal(isScoreInRange(0, -5), false)
  })
})

// Re-export unused-type sentinels so the imports stay used by the test runner
// (TypeScript's resolver strips these references without an explicit use).
export type { AssignmentFieldIssue, GradeIssue, SubmissionFieldIssue }
