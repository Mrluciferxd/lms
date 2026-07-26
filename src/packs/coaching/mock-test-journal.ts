/**
 * Mock test journal for an exam-prep coaching institute.
 *
 * The same generic JournalDefinition machinery that carries the forex pack's
 * trade journal. Nothing in core changed to support this — different field
 * schema, different computed expressions, identical tables, forms, list views and
 * API. Note `hasLifecycle: false`: a test attempt is a completed event, where a
 * trading position opens and later closes.
 */

import type { PackJournalDefinition } from '../types'

export const mockTestJournal: PackJournalDefinition = {
  key: 'mock-test',
  name: 'Mock Test Log',
  singular: 'Mock Test',
  description:
    'Record every mock attempt with marks, accuracy and timing, then review weak areas with your mentor.',
  icon: 'clipboard-check',
  studentAuthored: true,
  hasLifecycle: false,

  fields: [
    { key: 'testName', label: 'Test name', type: 'text', required: true, placeholder: 'Full Syllabus Test 04' },
    { key: 'testSeries', label: 'Test series', type: 'text', help: 'Which series or package this test belongs to.' },
    {
      key: 'subject',
      label: 'Subject / paper',
      type: 'text',
      help: 'Free text because subjects differ by institute and exam.',
    },
    { key: 'attemptedAt', label: 'Attempted on', type: 'datetime', required: true },

    { key: 'totalQuestions', label: 'Total questions', type: 'number', min: 1 },
    { key: 'totalMarks', label: 'Total marks', type: 'number', required: true, min: 1 },
    { key: 'marksScored', label: 'Marks scored', type: 'number', required: true },

    { key: 'attempted', label: 'Questions attempted', type: 'number', min: 0 },
    { key: 'correct', label: 'Correct', type: 'number', min: 0 },
    { key: 'incorrect', label: 'Incorrect', type: 'number', min: 0 },
    {
      key: 'negativeMarkPerIncorrect',
      label: 'Negative marks per wrong answer',
      type: 'number',
      step: 0.25,
      defaultValue: 0.25,
      help: 'Set to 0 for tests without negative marking.',
    },

    { key: 'durationMinutes', label: 'Allotted time', type: 'number', unit: 'min' },
    { key: 'timeTakenMinutes', label: 'Time taken', type: 'number', unit: 'min' },

    { key: 'rank', label: 'Rank', type: 'number', min: 1 },
    { key: 'totalCandidates', label: 'Total candidates', type: 'number', min: 1 },

    {
      key: 'weakTopics',
      label: 'Weak topics',
      type: 'textarea',
      help: 'The most useful field in the log — what to revise before the next attempt.',
    },
    { key: 'reviewNotes', label: 'Review notes', type: 'textarea' },
    { key: 'questionPaper', label: 'Question paper', type: 'file' },
    { key: 'responseSheet', label: 'Response sheet', type: 'file' },
  ],

  /**
   * All references are raw fields — computed values are not in scope for one
   * another. Division by zero resolves to null, so a test logged without an
   * attempted count shows an em dash for accuracy rather than a broken figure.
   */
  computed: [
    {
      key: 'scorePercent',
      label: 'Score',
      expr: 'marksScored / totalMarks * 100',
      type: 'percent',
      precision: 1,
    },
    {
      key: 'accuracyPercent',
      label: 'Accuracy',
      expr: 'correct / attempted * 100',
      type: 'percent',
      precision: 1,
    },
    {
      key: 'attemptRatePercent',
      label: 'Attempt rate',
      expr: 'attempted / totalQuestions * 100',
      type: 'percent',
      precision: 1,
    },
    {
      key: 'negativeMarksLost',
      label: 'Marks lost to negatives',
      expr: 'incorrect * negativeMarkPerIncorrect',
      type: 'number',
      precision: 2,
    },
    {
      key: 'marksPerMinute',
      label: 'Marks per minute',
      expr: 'marksScored / timeTakenMinutes',
      type: 'number',
      precision: 2,
    },
    {
      key: 'percentile',
      label: 'Percentile',
      expr: '(1 - rank / totalCandidates) * 100',
      type: 'percent',
      precision: 2,
    },
  ],

  listColumns: [
    'testName',
    'attemptedAt',
    'marksScored',
    'totalMarks',
    'scorePercent',
    'accuracyPercent',
    'percentile',
  ],
}
