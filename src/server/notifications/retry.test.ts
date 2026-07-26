import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MAX_ATTEMPTS, backoffMs, planRetry } from './retry'

const NOW = new Date('2026-07-26T12:00:00Z')
const MINUTE = 60_000

describe('backoffMs', () => {
  it('doubles each attempt', () => {
    assert.equal(backoffMs(1), 1 * MINUTE)
    assert.equal(backoffMs(2), 2 * MINUTE)
    assert.equal(backoffMs(3), 4 * MINUTE)
    assert.equal(backoffMs(4), 8 * MINUTE)
  })

  it('caps, so a long-lived queue does not schedule a retry days out', () => {
    assert.equal(backoffMs(20), 60 * MINUTE)
  })

  it('treats a zero attempt count as the base delay rather than a negative one', () => {
    assert.equal(backoffMs(0), 1 * MINUTE)
  })
})

describe('planRetry', () => {
  it('schedules the next attempt with the backoff applied', () => {
    const decision = planRetry({ attempts: 2, retryable: true, now: NOW })
    assert.equal(decision.retry, true)
    assert.equal(decision.retry && decision.retryAt.toISOString(), '2026-07-26T12:02:00.000Z')
  })

  /**
   * A student with no phone number is not a transient fault. Burning five
   * attempts on it only delays the moment an operator sees the real problem.
   */
  it('does not retry a permanent failure', () => {
    const decision = planRetry({ attempts: 1, retryable: false, now: NOW })
    assert.equal(decision.retry, false)
    assert.equal(decision.retry === false && decision.reason, 'PERMANENT')
  })

  it('gives up at the attempt cap', () => {
    const decision = planRetry({ attempts: MAX_ATTEMPTS, retryable: true, now: NOW })
    assert.equal(decision.retry, false)
    assert.equal(decision.retry === false && decision.reason, 'ATTEMPTS_EXHAUSTED')
  })

  it('still retries on the attempt before the cap', () => {
    assert.equal(planRetry({ attempts: MAX_ATTEMPTS - 1, retryable: true, now: NOW }).retry, true)
  })

  /** Deterministic by design — jitter would buy nothing here and cost testability. */
  it('produces the same plan for the same inputs', () => {
    const first = planRetry({ attempts: 3, retryable: true, now: NOW })
    const second = planRetry({ attempts: 3, retryable: true, now: NOW })
    assert.equal(
      first.retry && first.retryAt.getTime(),
      second.retry && second.retryAt.getTime(),
    )
  })
})
