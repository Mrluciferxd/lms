import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { adHocDedupeKey, dedupeKey, type DedupeInput } from './dedupe'

function input(overrides: Partial<DedupeInput> = {}): DedupeInput {
  return {
    ruleId: 'rule-1',
    anchorKind: 'session',
    anchorId: 'sess-1',
    userId: 'user-1',
    channel: 'WHATSAPP',
    ...overrides,
  }
}

describe('dedupeKey', () => {
  it('is stable for the same inputs, which is the whole mechanism', () => {
    assert.equal(dedupeKey(input()), dedupeKey(input()))
  })

  it('reads the way the data model documents it', () => {
    assert.equal(dedupeKey(input()), 'rule:rule-1:session:sess-1:user:user-1:WHATSAPP')
  })

  /**
   * Without the channel, a rule that sends on email and WhatsApp would have its
   * second row collide with its first and the student would silently lose one.
   */
  it('separates the channels of one rule', () => {
    assert.notEqual(dedupeKey(input({ channel: 'EMAIL' })), dedupeKey(input({ channel: 'PUSH' })))
  })

  it('separates recipients', () => {
    assert.notEqual(dedupeKey(input({ userId: 'a' })), dedupeKey(input({ userId: 'b' })))
  })

  it('separates anchors', () => {
    assert.notEqual(dedupeKey(input({ anchorId: 'a' })), dedupeKey(input({ anchorId: 'b' })))
  })

  it('separates rules, so two lead times off one session both send', () => {
    assert.notEqual(dedupeKey(input({ ruleId: 'a' })), dedupeKey(input({ ruleId: 'b' })))
  })

  /** Two entity types could otherwise share an id and suppress each other. */
  it('separates anchor kinds', () => {
    assert.notEqual(
      dedupeKey(input({ anchorKind: 'session', anchorId: 'x' })),
      dedupeKey(input({ anchorKind: 'lesson', anchorId: 'x' })),
    )
  })
})

describe('adHocDedupeKey', () => {
  it('is namespaced away from rule-driven keys', () => {
    assert.equal(
      adHocDedupeKey('welcome', 'enr-1', 'user-1', 'EMAIL'),
      'adhoc:welcome:enr-1:user:user-1:EMAIL',
    )
  })

  it('separates scopes, so two features cannot collide', () => {
    assert.notEqual(
      adHocDedupeKey('welcome', 'x', 'user-1', 'EMAIL'),
      adHocDedupeKey('receipt', 'x', 'user-1', 'EMAIL'),
    )
  })
})
