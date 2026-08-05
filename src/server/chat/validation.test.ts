import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type ChannelNameIssue,
  type MessageIssue,
  MAX_ATTACHMENTS,
  MAX_MESSAGE_LENGTH,
  MAX_REPLY_DEPTH,
  deriveSlug,
  firstMessageIssue,
  validateChannelDescription,
  validateChannelName,
  validateChannelSlug,
  validateMessage,
} from './validation'

describe('message validation', () => {
  it('accepts a plain text body', () => {
    assert.equal(validateMessage({ body: 'hello' }).length, 0)
  })

  it('accepts an empty body when attachments are present', () => {
    assert.equal(
      validateMessage({ body: '' }, { hasAttachments: true }).length,
      0,
    )
  })

  it('rejects an empty body when there are no attachments', () => {
    const issues = validateMessage({ body: '   ' })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'body')
  })

  it('rejects a body longer than MAX_MESSAGE_LENGTH', () => {
    // An off-by-one here would let a 4001-character message through, so test the
    // exact boundary on both sides.
    assert.equal(
      validateMessage({ body: 'x'.repeat(MAX_MESSAGE_LENGTH) }).length,
      0,
    )
    assert.equal(
      validateMessage({ body: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }).length,
      1,
    )
  })

  it('always trims body whitespace before counting length', () => {
    assert.equal(
      validateMessage({ body: `   ${'x'.repeat(MAX_MESSAGE_LENGTH)}   ` }).length,
      0,
    )
  })

  it('rejects more than MAX_ATTACHMENTS attachments', () => {
    const ids = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => `att-${i}`)
    const issues = validateMessage({ body: 'a', attachmentIds: ids })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'attachments')
  })

  it('accepts exactly MAX_ATTACHMENTS attachments', () => {
    const ids = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => `att-${i}`)
    assert.equal(validateMessage({ body: 'a', attachmentIds: ids }).length, 0)
  })

  it('rejects duplicate attachment ids', () => {
    const issues = validateMessage({
      body: 'a',
      attachmentIds: ['att-1', 'att-1'],
    })
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'attachments')
  })

  it('rejects replies deeper than MAX_REPLY_DEPTH', () => {
    const issues = validateMessage(
      { body: 'reply' },
      { replyDepth: MAX_REPLY_DEPTH + 1 },
    )
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.field, 'replyTo')
  })

  it('returns the first issue only from firstMessageIssue', () => {
    // Two issues: missing body and a too-deep reply. firstMessageIssue is a
    // summary helper used by the composer UI; we only need to surface one.
    const issue = firstMessageIssue(
      { body: '' },
      { replyDepth: MAX_REPLY_DEPTH + 1 },
    ) as MessageIssue | null
    assert.ok(issue)
    assert.ok(issue.field === 'body' || issue.field === 'replyTo')
  })

  it('returns null from firstMessageIssue when there are no issues', () => {
    assert.equal(firstMessageIssue({ body: 'ok' }), null)
  })
})

describe('channel name validation', () => {
  it('rejects an empty name', () => {
    const issue = validateChannelName('   ') as ChannelNameIssue | null
    assert.ok(issue)
    assert.equal(issue.field, 'name')
  })
  it('accepts a normal name', () => {
    assert.equal(validateChannelName('Market Talk'), null)
  })
  it('rejects a name over 80 characters', () => {
    const issue = validateChannelName('x'.repeat(81)) as ChannelNameIssue | null
    assert.ok(issue)
    assert.equal(issue.field, 'name')
  })
})

describe('channel slug validation', () => {
  it('accepts a null slug (means: derive from name)', () => {
    assert.equal(validateChannelSlug(null), null)
  })
  it('accepts a lowercase letters/digits/hyphens slug', () => {
    assert.equal(validateChannelSlug('market-talk-1'), null)
  })
  it('rejects an empty slug', () => {
    const issue = validateChannelSlug('') as ChannelNameIssue | null
    assert.ok(issue)
    assert.equal(issue.field, 'slug')
  })
  it('rejects an upper-case slug', () => {
    const issue = validateChannelSlug('Market-Talk') as ChannelNameIssue | null
    assert.ok(issue)
    assert.equal(issue.field, 'slug')
  })
  it('rejects a slug starting or ending with a hyphen', () => {
    assert.ok(validateChannelSlug('-market'))
    assert.ok(validateChannelSlug('market-'))
  })
  it('rejects a slug with spaces', () => {
    assert.ok(validateChannelSlug('market talk'))
  })
  it('rejects a slug over 40 characters', () => {
    assert.ok(validateChannelSlug('a'.repeat(41)))
  })
})

describe('channel description validation', () => {
  it('accepts a null description', () => {
    assert.equal(validateChannelDescription(null), null)
  })
  it('accepts an empty description', () => {
    assert.equal(validateChannelDescription(''), null)
  })
  it('rejects a description over 280 characters', () => {
    assert.ok(validateChannelDescription('x'.repeat(281)))
  })
})

describe('deriveSlug', () => {
  it('sluggifies a user-supplied slug when present', () => {
    assert.equal(deriveSlug('Market Talk!', 'Market Talk'), 'market-talk')
  })
  it('derives from the name when slug is null', () => {
    assert.equal(deriveSlug(null, 'Market Talk'), 'market-talk')
  })
  it('derives from the name when slug is empty whitespace', () => {
    assert.equal(deriveSlug('   ', 'Market Talk'), 'market-talk')
  })
  it('strips non-alphanumeric characters', () => {
    assert.equal(deriveSlug('Trade Reviews $1', 'Trade Reviews'), 'trade-reviews-1')
  })
})
