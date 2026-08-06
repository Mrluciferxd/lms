import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  decideExpiryStatus,
  normalizeTrackerUpdate,
  parseRecordValue,
  parseTrackerConfig,
  trackerProgress,
} from './validation'

const EMPTY_CONFIG = parseTrackerConfig({})
const GAUGE_CONFIG = parseTrackerConfig({
  target: 100,
  segments: [
    { key: 'trading', label: 'Trading', weight: 0.6 },
    { key: 'rules', label: 'Rules', weight: 0.4 },
  ],
})
const CHECKLIST_CONFIG = parseTrackerConfig({
  items: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
})

describe('parseTrackerConfig', () => {
  it('rejects non-objects', () => {
    assert.deepEqual(parseTrackerConfig(null), { target: null, items: [], segments: [] })
    assert.deepEqual(parseTrackerConfig('nope'), { target: null, items: [], segments: [] })
  })

  it('only keeps a positive finite target', () => {
    assert.equal(parseTrackerConfig({ target: 50 }).target, 50)
    assert.equal(parseTrackerConfig({ target: 0 }).target, null)
    assert.equal(parseTrackerConfig({ target: -3 }).target, null)
    assert.equal(parseTrackerConfig({ target: '50' }).target, null)
  })

  it('drops malformed and duplicate checklist items', () => {
    const config = parseTrackerConfig({
      items: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'A again' },
        { id: '', label: 'No id' },
        { id: 'b', label: 5 },
        null,
        { id: 'c', label: 'C' },
      ],
    })
    assert.deepEqual(config.items, [
      { id: 'a', label: 'A' },
      { id: 'c', label: 'C' },
    ])
  })

  it('coerces invalid weight to 0 instead of dropping the segment', () => {
    const config = parseTrackerConfig({
      segments: [
        { key: 'a', label: 'A', weight: 0.5 },
        { key: 'a', label: 'dup', weight: 0.9 },
        { key: 'b', label: 'B', weight: '0.2' },
        { key: 'c', label: 'C', weight: -1 },
        { key: 'd', label: 'D', weight: 0.25 },
      ],
    })
    assert.deepEqual(config.segments, [
      { key: 'a', label: 'A', weight: 0.5 },
      { key: 'b', label: 'B', weight: 0 },
      { key: 'c', label: 'C', weight: 0 },
      { key: 'd', label: 'D', weight: 0.25 },
    ])
  })
})

describe('normalizeTrackerUpdate', () => {
  it('normalizes COUNTER to a non-negative integer', () => {
    assert.deepEqual(normalizeTrackerUpdate('COUNTER', EMPTY_CONFIG, { type: 'COUNTER', count: 7 }), {
      ok: true,
      value: { count: 7 },
      expiresAt: null,
    })
    assert.equal(
      normalizeTrackerUpdate('COUNTER', EMPTY_CONFIG, { type: 'COUNTER', count: 2.5 }).ok,
      false,
    )
    assert.equal(
      normalizeTrackerUpdate('COUNTER', EMPTY_CONFIG, { type: 'COUNTER', count: -1 }).ok,
      false,
    )
  })

  it('normalizes BOOLEAN', () => {
    assert.deepEqual(normalizeTrackerUpdate('BOOLEAN', EMPTY_CONFIG, { type: 'BOOLEAN', on: true }), {
      ok: true,
      value: { on: true },
      expiresAt: null,
    })
    assert.deepEqual(
      normalizeTrackerUpdate('BOOLEAN', EMPTY_CONFIG, { type: 'BOOLEAN', on: 'yes' as unknown as boolean }),
      { ok: true, value: { on: false }, expiresAt: null },
    )
  })

  it('filters checklist ids against the configured items and dedupes', () => {
    const result = normalizeTrackerUpdate('CHECKLIST', CHECKLIST_CONFIG, {
      type: 'CHECKLIST',
      checked: ['a', 'b', 'a', 'bogus', 7 as unknown as string],
    })
    assert.deepEqual(result, { ok: true, value: { checked: ['a', 'b'] }, expiresAt: null })
  })

  it('rejects a checklist with no configured items', () => {
    assert.equal(
      normalizeTrackerUpdate('CHECKLIST', EMPTY_CONFIG, { type: 'CHECKLIST', checked: ['a'] }).ok,
      false,
    )
  })

  it('normalizes a simple GAUGE value and clamps to 0..100', () => {
    assert.deepEqual(normalizeTrackerUpdate('GAUGE', EMPTY_CONFIG, { type: 'GAUGE', value: 42 }), {
      ok: true,
      value: { value: 42 },
      expiresAt: null,
    })
    assert.deepEqual(normalizeTrackerUpdate('GAUGE', EMPTY_CONFIG, { type: 'GAUGE', value: 200 }), {
      ok: true,
      value: { value: 100 },
      expiresAt: null,
    })
  })

  it('requires segment values for a weighted GAUGE, clamping and defaulting to 0', () => {
    assert.equal(
      normalizeTrackerUpdate('GAUGE', GAUGE_CONFIG, { type: 'GAUGE', value: 30 }).ok,
      false,
    )
    const result = normalizeTrackerUpdate('GAUGE', GAUGE_CONFIG, {
      type: 'GAUGE',
      segments: { trading: 80, bogus: 99, rules: -5 },
    })
    assert.deepEqual(result, {
      ok: true,
      value: { segments: { trading: 80, rules: 0 } },
      expiresAt: null,
    })
  })

  it('normalizes EXPIRY with a parsed expiry date and clears it when inactive', () => {
    const active = normalizeTrackerUpdate('EXPIRY', EMPTY_CONFIG, {
      type: 'EXPIRY',
      active: true,
      expiresAt: '2026-01-01T00:00:00Z',
    })
    assert.equal(active.ok, true)
    if (active.ok) assert.equal(active.expiresAt?.toISOString(), '2026-01-01T00:00:00.000Z')

    const inactive = normalizeTrackerUpdate('EXPIRY', EMPTY_CONFIG, {
      type: 'EXPIRY',
      active: false,
      expiresAt: '2026-01-01T00:00:00Z',
    })
    assert.deepEqual(inactive, { ok: true, value: { active: false }, expiresAt: null })
  })

  it('rejects a bogus EXPIRY date', () => {
    assert.equal(
      normalizeTrackerUpdate('EXPIRY', EMPTY_CONFIG, {
        type: 'EXPIRY',
        active: true,
        expiresAt: 'not-a-date',
      }).ok,
      false,
    )
  })
})

describe('parseRecordValue', () => {
  it('recovers safe defaults from garbage stored Json', () => {
    assert.deepEqual(parseRecordValue('COUNTER', { count: '9' }), {
      count: 0,
      on: false,
      checked: [],
      active: false,
      value: 0,
      segments: {},
    })
    assert.deepEqual(parseRecordValue('COUNTER', { count: -4 }), {
      count: 0,
      on: false,
      checked: [],
      active: false,
      value: 0,
      segments: {},
    })
    assert.deepEqual(parseRecordValue('COUNTER', null), {
      count: 0,
      on: false,
      checked: [],
      active: false,
      value: 0,
      segments: {},
    })
  })

  it('parses each type shape', () => {
    assert.equal(parseRecordValue('BOOLEAN', { on: true }).on, true)
    assert.deepEqual(parseRecordValue('CHECKLIST', { checked: ['a', 'b', 7] }).checked, ['a', 'b'])
    assert.equal(parseRecordValue('EXPIRY', { active: true }).active, true)
    assert.equal(parseRecordValue('GAUGE', { value: 55 }).value, 55)
    assert.deepEqual(parseRecordValue('GAUGE', { segments: { x: 1 } }).value, 0)
    assert.deepEqual(parseRecordValue('GAUGE', { segments: { a: 10, b: 999 } }).segments, {
      a: 10,
      b: 100,
    })
  })
})

describe('trackerProgress', () => {
  it('is percent of count/target for COUNTER', () => {
    assert.deepEqual(trackerProgress('COUNTER', parseTrackerConfig({ target: 50 }), {
      count: 25,
      on: false,
      checked: [],
      active: false,
      value: 0,
      segments: {},
    }), { kind: 'percent', value: 50 })

    const over = trackerProgress('COUNTER', parseTrackerConfig({ target: 50 }), {
      count: 60,
      on: false,
      checked: [],
      active: false,
      value: 0,
      segments: {},
    })
    assert.deepEqual(over, { kind: 'percent', value: 100 })
  })

  it('returns null for COUNTER with no target', () => {
    assert.equal(
      trackerProgress('COUNTER', EMPTY_CONFIG, {
        count: 3,
        on: false,
        checked: [],
        active: false,
        value: 0,
        segments: {},
      }),
      null,
    )
  })

  it('computes the weighted gauge sum', () => {
    const progress = trackerProgress('GAUGE', GAUGE_CONFIG, {
      count: 0,
      on: false,
      checked: [],
      active: false,
      value: 0,
      segments: { trading: 100, rules: 50 },
    })
    assert.deepEqual(progress, { kind: 'percent', value: 80 })
  })

  it('returns the plain gauge value', () => {
    assert.deepEqual(
      trackerProgress('GAUGE', EMPTY_CONFIG, {
        count: 0,
        on: false,
        checked: [],
        active: false,
        value: 33,
        segments: {},
      }),
      { kind: 'percent', value: 33 },
    )
  })

  it('returns null for non-percent types', () => {
    for (const type of ['BOOLEAN', 'CHECKLIST', 'EXPIRY'] as const) {
      assert.equal(trackerProgress(type, EMPTY_CONFIG, parseRecordValue(type, {})), null)
    }
  })
})

describe('decideExpiryStatus', () => {
  const now = new Date('2026-08-05T00:00:00Z')

  it('treats inactive as INACTIVE even with a future expiry', () => {
    assert.equal(
      decideExpiryStatus(parseRecordValue('EXPIRY', { active: false }), new Date('2026-12-01T00:00:00Z'), now),
      'INACTIVE',
    )
  })

  it('expires at the boundary', () => {
    assert.equal(
      decideExpiryStatus(parseRecordValue('EXPIRY', { active: true }), new Date('2026-08-05T00:00:00Z'), now),
      'EXPIRED',
    )
    assert.equal(
      decideExpiryStatus(parseRecordValue('EXPIRY', { active: true }), new Date('2026-08-05T00:00:01Z'), now),
      'ACTIVE',
    )
  })

  it('active with no expiry stays ACTIVE', () => {
    assert.equal(decideExpiryStatus(parseRecordValue('EXPIRY', { active: true }), null, now), 'ACTIVE')
  })
})
