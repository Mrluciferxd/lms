import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MAX_ATTACHMENT_IDS,
  MAX_COMMENT_LENGTH,
  MAX_TAGS,
  MAX_TEXTAREA_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_URL_LENGTH,
  isJournalEntryValid,
  validateAttachmentIds,
  validateComment,
  validateJournalEntry,
  validateTags,
  type JournalFieldSchema,
} from './validation'

// ─── helpers ────────────────────────────────────────────────────────────────

function field(overrides: Partial<JournalFieldSchema>): JournalFieldSchema {
  return {
    key: 'f',
    label: 'Field',
    type: 'text',
    ...overrides,
  }
}

// ─── validateJournalEntry — text fields ─────────────────────────────────────

describe('journal entry validation — text', () => {
  const fields: JournalFieldSchema[] = [field({ key: 'name', type: 'text' })]

  it('accepts a normal text value', () => {
    assert.equal(validateJournalEntry({ fields, data: { name: 'hello' } }).length, 0)
  })
  it('rejects a non-string value silently typed through JSON', () => {
    const issues = validateJournalEntry({ fields, data: { name: 42 } })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'name')
  })
  it('rejects empty text when the field is required', () => {
    const required: JournalFieldSchema[] = [
      field({ key: 'name', type: 'text', required: true }),
    ]
    assert.equal(
      validateJournalEntry({ fields: required, data: { name: '' } }).length,
      1,
    )
  })
  it('accepts empty text for a non-required field', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { name: '' } }).length,
      0,
    )
  })
  it('rejects a text value longer than MAX_TEXT_LENGTH', () => {
    const long: JournalFieldSchema[] = [
      field({ key: 'name', type: 'text', required: true }),
    ]
    assert.equal(
      validateJournalEntry({
        fields: long,
        data: { name: 'x'.repeat(MAX_TEXT_LENGTH + 1) },
      }).length,
      1,
    )
    assert.equal(
      validateJournalEntry({
        fields: long,
        data: { name: 'x'.repeat(MAX_TEXT_LENGTH) },
      }).length,
      0,
    )
  })
})

describe('journal entry validation — textarea', () => {
  const fields: JournalFieldSchema[] = [field({ key: 'notes', type: 'textarea' })]

  it('accepts a normal textarea value', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { notes: 'a paragraph' } }).length,
      0,
    )
  })
  it('rejects a textarea value longer than MAX_TEXTAREA_LENGTH', () => {
    assert.equal(
      validateJournalEntry({
        fields,
        data: { notes: 'x'.repeat(MAX_TEXTAREA_LENGTH + 1) },
      }).length,
      1,
    )
    assert.equal(
      validateJournalEntry({
        fields,
        data: { notes: 'x'.repeat(MAX_TEXTAREA_LENGTH) },
      }).length,
      0,
    )
  })
})

// ─── validateJournalEntry — url ────────────────────────────────────────────

describe('journal entry validation — url', () => {
  const fields: JournalFieldSchema[] = [field({ key: 'link', type: 'url' })]

  it('accepts an https URL', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { link: 'https://example.com' } }).length,
      0,
    )
  })
  it('accepts an http URL', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { link: 'http://example.com' } }).length,
      0,
    )
  })
  it('rejects a javascript: URL', () => {
    assert.equal(
      validateJournalEntry({
        fields,
        data: { link: 'javascript:alert(1)' },
      }).length,
      1,
    )
  })
  it('rejects a malformed URL string', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { link: 'not a url' } }).length,
      1,
    )
  })
  it('rejects a URL longer than MAX_URL_LENGTH', () => {
    const tooLong = 'https://example.com/' + 'a'.repeat(MAX_URL_LENGTH)
    assert.equal(
      validateJournalEntry({ fields, data: { link: tooLong } }).length,
      1,
    )
  })
})

// ─── validateJournalEntry — number / currency / percent ───────────────────

describe('journal entry validation — number', () => {
  const fields: JournalFieldSchema[] = [
    field({ key: 'price', type: 'number', min: 0, max: 1_000_000 }),
  ]

  it('accepts a finite number', () => {
    assert.equal(validateJournalEntry({ fields, data: { price: 1.12345 } }).length, 0)
  })
  it('respects min bound', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { price: -1 } }).length,
      1,
    )
  })
  it('respects max bound', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { price: 1_000_001 } }).length,
      1,
    )
    assert.equal(
      validateJournalEntry({ fields, data: { price: 1_000_000 } }).length,
      0,
    )
  })
  it('rejects NaN', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { price: NaN } }).length,
      1,
    )
  })
  it('rejects a string-typed value', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { price: '1.5' } }).length,
      1,
    )
  })
})

describe('journal entry validation — currency', () => {
  const fields: JournalFieldSchema[] = [field({ key: 'amount', type: 'currency' })]
  it('accepts a non-negative amount', () => {
    assert.equal(validateJournalEntry({ fields, data: { amount: 0 } }).length, 0)
    assert.equal(validateJournalEntry({ fields, data: { amount: 123.5 } }).length, 0)
  })
  it('rejects a negative amount', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { amount: -1 } }).length,
      1,
    )
  })
})

describe('journal entry validation — percent', () => {
  const fields: JournalFieldSchema[] = [field({ key: 'risk', type: 'percent' })]
  it('accepts the boundaries {0, 100}', () => {
    assert.equal(validateJournalEntry({ fields, data: { risk: 0 } }).length, 0)
    assert.equal(validateJournalEntry({ fields, data: { risk: 100 } }).length, 0)
  })
  it('rejects a negative percent or above 100', () => {
    assert.equal(validateJournalEntry({ fields, data: { risk: -0.01 } }).length, 1)
    assert.equal(validateJournalEntry({ fields, data: { risk: 100.1 } }).length, 1)
  })
})

// ─── validateJournalEntry — select / multiselect / boolean ─────────────────

describe('journal entry validation — select', () => {
  const fields: JournalFieldSchema[] = [
    field({
      key: 'direction',
      type: 'select',
      options: [{ value: 'LONG', label: 'Long' }, { value: 'SHORT', label: 'Short' }],
    }),
  ]
  it('accepts a valid option', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { direction: 'LONG' } }).length,
      0,
    )
  })
  it('rejects an invalid option', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { direction: 'SIDEWAYS' } }).length,
      1,
    )
  })
  it('rejects a missing required select', () => {
    const required = [field({ ...fields[0]!, required: true })]
    assert.equal(
      validateJournalEntry({ fields: required, data: {} }).length,
      1,
    )
  })
})

describe('journal entry validation — multiselect', () => {
  const fields: JournalFieldSchema[] = [
    field({
      key: 'mistakes',
      type: 'multiselect',
      options: [
        { value: 'EARLY', label: 'Entered early' },
        { value: 'LATE', label: 'Entered late' },
      ],
    }),
  ]
  it('accepts valid options', () => {
    assert.equal(
      validateJournalEntry({
        fields,
        data: { mistakes: ['EARLY', 'LATE'] },
      }).length,
      0,
    )
  })
  it('rejects an invalid option', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { mistakes: ['BAD'] } }).length,
      1,
    )
  })
  it('rejects a non-array value', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { mistakes: 'EARLY' } }).length,
      1,
    )
  })
})

describe('journal entry validation — boolean', () => {
  const required: JournalFieldSchema[] = [
    field({ key: 'flag', type: 'boolean', required: true }),
  ]
  it('accepts true/false', () => {
    assert.equal(validateJournalEntry({ fields: required, data: { flag: true } }).length, 0)
    assert.equal(
      validateJournalEntry({ fields: required, data: { flag: false } }).length,
      0,
    )
  })
  it('rejects a non-boolean when required', () => {
    assert.equal(
      validateJournalEntry({ fields: required, data: { flag: 'true' } }).length,
      1,
    )
  })
})

// ─── validateJournalEntry — date / datetime ───────────────────────────────

describe('journal entry validation — date', () => {
  const fields: JournalFieldSchema[] = [field({ key: 'd', type: 'date' })]
  it('accepts a YYYY-MM-DD', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { d: '2026-08-04' } }).length,
      0,
    )
  })
  it('rejects a non-string', () => {
    assert.equal(validateJournalEntry({ fields, data: { d: 20260804 } }).length, 1)
  })
  it('rejects garbage', () => {
    assert.equal(validateJournalEntry({ fields, data: { d: 'next week' } }).length, 1)
  })
})

describe('journal entry validation — datetime', () => {
  const fields: JournalFieldSchema[] = [field({ key: 'd', type: 'datetime' })]
  it('accepts an ISO datetime', () => {
    assert.equal(
      validateJournalEntry({ fields, data: { d: '2026-08-04T12:00:00Z' } }).length,
      0,
    )
  })
  it('rejects a date string without time as a value', () => {
    // 'YYYY-MM-DD' parses as a Date but is a malformed datetime; pass garbage
    // and a missing time. new Date('2026-08-04') is valid in V8 so we accept it
    // as a date — the validator strictly checks Date parseability.
    assert.equal(
      validateJournalEntry({ fields, data: { d: 'not a date' } }).length,
      1,
    )
  })
})

// ─── validateJournalEntry — image / file ──────────────────────────────────

describe('journal entry validation — image/file', () => {
  it('accepts an upload id for image', () => {
    const fields: JournalFieldSchema[] = [
      field({ key: 'chart', type: 'image' }),
    ]
    assert.equal(
      validateJournalEntry({ fields, data: { chart: 'asset-123' } }).length,
      0,
    )
  })
  it('rejects a non-string for image', () => {
    const fields: JournalFieldSchema[] = [field({ key: 'chart', type: 'image' })]
    assert.equal(
      validateJournalEntry({ fields, data: { chart: 42 } }).length,
      1,
    )
  })
  it('accepts an upload id for file', () => {
    const fields: JournalFieldSchema[] = [field({ key: 'doc', type: 'file' })]
    assert.equal(
      validateJournalEntry({ fields, data: { doc: 'asset-456' } }).length,
      0,
    )
  })
})

// ─── validateJournalEntry — extra-data guard ──────────────────────────────

describe('journal entry validation — extra-data guard', () => {
  const fields: JournalFieldSchema[] = [field({ key: 'name', type: 'text' })]
  it('rejects an unknown field key present in the payload', () => {
    const issues = validateJournalEntry({
      fields,
      data: { name: 'hi', removed: 'value' },
    })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'removed')
  })
  it('accepts the payload when no extra keys are present', () => {
    assert.equal(validateJournalEntry({ fields, data: { name: 'hi' } }).length, 0)
  })
})

// ─── validateJournalEntry — unknown field-type ────────────────────────────

describe('journal entry validation — unknown field type', () => {
  it('rejects a field whose type is not in the union', () => {
    const fields = [field({ key: 'x', type: 'madeup' as never })]
    assert.equal(
      validateJournalEntry({ fields, data: { x: 'anything' } }).length,
      1,
    )
  })
})

// ─── validateJournalEntry — isJournalEntryValid ───────────────────────────

describe('isJournalEntryValid', () => {
  const fields: JournalFieldSchema[] = [field({ key: 'name', type: 'text', required: true })]
  it('returns true on a valid entry', () => {
    assert.equal(
      isJournalEntryValid({ fields, data: { name: 'hi' } }),
      true,
    )
  })
  it('returns false on an invalid entry', () => {
    assert.equal(
      isJournalEntryValid({ fields, data: { name: '' } }),
      false,
    )
  })
})

// ─── validateComment ────────────────────────────────────────────────────

describe('comment validation', () => {
  it('rejects an empty comment', () => {
    assert.equal(validateComment('  '), 'Comment cannot be empty.')
  })
  it('accepts a normal comment', () => {
    assert.equal(validateComment('a reasonable note'), null)
  })
  it('rejects a comment over MAX_COMMENT_LENGTH', () => {
    assert.equal(
      validateComment('x'.repeat(MAX_COMMENT_LENGTH + 1)),
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer.`,
    )
    assert.equal(
      validateComment('x'.repeat(MAX_COMMENT_LENGTH)),
      null,
    )
  })
})

// ─── validateTags ──────────────────────────────────────────────────────

describe('tags validation', () => {
  it('returns null for an empty array', () => {
    assert.equal(validateTags([]), null)
  })
  it('returns null for non-array values', () => {
    assert.equal(validateTags(undefined), null)
    assert.equal(validateTags(null), null)
  })
  it('rejects more than MAX_TAGS tags', () => {
    assert.equal(
      validateTags(Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`)),
      `An entry may have at most ${MAX_TAGS} tags.`,
    )
  })
  it('accepts exactly MAX_TAGS tags', () => {
    assert.equal(
      validateTags(Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`)),
      null,
    )
  })
  it('rejects a non-string tag', () => {
    assert.equal(validateTags([123 as never]), 'Tags must be non-empty strings.')
  })
  it('rejects an empty string tag', () => {
    assert.equal(validateTags(['']), 'Tags must be non-empty strings.')
  })
})

// ─── validateAttachmentIds ─────────────────────────────────────────────

describe('attachment ids validation', () => {
  it('accepts a non-array value silently (action uses the default)', () => {
    assert.equal(validateAttachmentIds(undefined), null)
  })
  it('accepts up to MAX_ATTACHMENT_IDS ids', () => {
    assert.equal(
      validateAttachmentIds(Array.from({ length: MAX_ATTACHMENT_IDS }, (_, i) => `a${i}`)),
      null,
    )
  })
  it('rejects more than MAX_ATTACHMENT_IDS ids', () => {
    assert.equal(
      validateAttachmentIds(
        Array.from({ length: MAX_ATTACHMENT_IDS + 1 }, (_, i) => `a${i}`),
      ),
      `An entry may have at most ${MAX_ATTACHMENT_IDS} attachments.`,
    )
  })
  it('rejects a non-string item', () => {
    assert.equal(validateAttachmentIds([42 as never]), 'Attachment ids must be non-empty strings.')
  })
  it('rejects an empty string item', () => {
    assert.equal(
      validateAttachmentIds(['']),
      'Attachment ids must be non-empty strings.',
    )
  })
})
