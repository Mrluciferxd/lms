import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  checkRateLimit,
  clientKey,
  consume,
  resetRateLimits,
  type RateLimitWindow,
} from './rate-limit'

const CONFIG = { limit: 3, windowMs: 60_000 }
const T0 = 1_700_000_000_000

describe('consume', () => {
  it('opens a window on the first request', () => {
    const decision = consume(undefined, T0, CONFIG)
    assert.equal(decision.allowed, true)
    assert.equal(decision.remaining, 2)
    assert.deepEqual(decision.window, { count: 1, startedAt: T0 })
  })

  it('allows exactly the configured limit within one window', () => {
    let window: RateLimitWindow | undefined
    const outcomes: boolean[] = []

    for (let index = 0; index < 4; index += 1) {
      const decision = consume(window, T0 + index * 1000, CONFIG)
      outcomes.push(decision.allowed)
      window = decision.window
    }

    assert.deepEqual(outcomes, [true, true, true, false])
  })

  it('reports how long until the window resets', () => {
    let window = consume(undefined, T0, CONFIG).window
    for (let index = 1; index <= 3; index += 1) {
      window = consume(window, T0 + 10_000, CONFIG).window
    }

    const blocked = consume(window, T0 + 10_000, CONFIG)
    assert.equal(blocked.allowed, false)
    assert.equal(blocked.retryAfterSec, 50)
  })

  it('starts a fresh window once the old one has elapsed', () => {
    const exhausted: RateLimitWindow = { count: 99, startedAt: T0 }
    const decision = consume(exhausted, T0 + CONFIG.windowMs, CONFIG)

    assert.equal(decision.allowed, true)
    assert.deepEqual(decision.window, { count: 1, startedAt: T0 + CONFIG.windowMs })
  })

  it('does not extend the window when a blocked client keeps trying', () => {
    // Fixed window, not sliding: hammering must not turn a one-minute block into
    // a permanent one for a user behind a shared NAT.
    let window: RateLimitWindow | undefined
    for (let index = 0; index < 20; index += 1) {
      window = consume(window, T0 + index * 100, CONFIG).window
    }

    assert.equal(window?.startedAt, T0)
    // Counter is capped rather than growing without bound under sustained abuse.
    assert.equal(window?.count, CONFIG.limit + 1)
  })

  it('handles a limit of one', () => {
    const first = consume(undefined, T0, { limit: 1, windowMs: 1000 })
    assert.equal(first.allowed, true)
    assert.equal(first.remaining, 0)
    assert.equal(consume(first.window, T0 + 1, { limit: 1, windowMs: 1000 }).allowed, false)
  })
})

describe('checkRateLimit', () => {
  it('tracks callers independently', () => {
    resetRateLimits()
    const now = new Date(T0)

    for (let index = 0; index < CONFIG.limit; index += 1) {
      assert.equal(checkRateLimit('a', CONFIG, now).allowed, true)
    }

    assert.equal(checkRateLimit('a', CONFIG, now).allowed, false)
    assert.equal(checkRateLimit('b', CONFIG, now).allowed, true)
  })

  it('lets a blocked caller back in after the window', () => {
    resetRateLimits()
    for (let index = 0; index <= CONFIG.limit; index += 1) {
      checkRateLimit('c', CONFIG, new Date(T0))
    }

    assert.equal(checkRateLimit('c', CONFIG, new Date(T0)).allowed, false)
    assert.equal(checkRateLimit('c', CONFIG, new Date(T0 + CONFIG.windowMs)).allowed, true)
  })
})

describe('clientKey', () => {
  it('is stable for the same client and scope within a process', () => {
    assert.equal(clientKey('lead', '203.0.113.9'), clientKey('lead', '203.0.113.9'))
  })

  it('separates scopes so one form cannot exhaust another form s budget', () => {
    assert.notEqual(clientKey('lead', '203.0.113.9'), clientKey('signup', '203.0.113.9'))
  })

  it('does not contain the address it is derived from', () => {
    // The map holds these for minutes; a raw IP would make it a PII store.
    assert.ok(!clientKey('lead', '203.0.113.9').includes('203.0.113.9'))
  })

  it('buckets requests with no resolvable address together rather than exempting them', () => {
    assert.equal(clientKey('lead', null), clientKey('lead', null))
  })
})
