import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type GateSession,
  type ReleaseContext,
  type ReleaseRule,
  describeRelease,
  resolveRelease,
} from './release'

const NOW = new Date('2026-07-26T12:00:00Z')
const DAY = 86_400_000

function ctx(overrides: Partial<ReleaseContext> = {}): ReleaseContext {
  return {
    enrolledAt: new Date('2026-07-01T00:00:00Z'),
    enrollmentStartsAt: null,
    batchStartDate: null,
    now: NOW,
    ...overrides,
  }
}

function rule(overrides: Partial<ReleaseRule> = {}): ReleaseRule {
  return {
    mode: 'IMMEDIATE',
    offsetDays: null,
    releaseAt: null,
    manuallyReleasedAt: null,
    gateSession: null,
    ...overrides,
  }
}

function session(overrides: Partial<GateSession> = {}): GateSession {
  return {
    id: 'sess-1',
    title: 'Week 3 Live Class',
    scheduledStart: new Date('2026-07-20T10:00:00Z'),
    actualEnd: null,
    status: 'SCHEDULED',
    ...overrides,
  }
}

describe('IMMEDIATE', () => {
  it('is always released', () => {
    assert.equal(resolveRelease(rule({ mode: 'IMMEDIATE' }), ctx()).released, true)
  })
})

describe('DAYS_AFTER_ENROLLMENT', () => {
  const mode = 'DAYS_AFTER_ENROLLMENT' as const

  it('releases once the offset has elapsed', () => {
    // Enrolled 1 Jul, offset 7 days, now 26 Jul.
    assert.equal(resolveRelease(rule({ mode, offsetDays: 7 }), ctx()).released, true)
  })

  it('withholds before the offset and reports the unlock date', () => {
    const decision = resolveRelease(rule({ mode, offsetDays: 40 }), ctx())
    assert.equal(decision.released, false)
    assert.equal(decision.reason, 'NOT_YET')
    assert.equal(decision.releasesAt?.toISOString(), '2026-08-10T00:00:00.000Z')
  })

  it('treats a null offset as zero days', () => {
    assert.equal(resolveRelease(rule({ mode, offsetDays: null }), ctx()).released, true)
  })

  it('prefers an explicit access start over the enrollment timestamp', () => {
    // Enrolled 1 Jul but access starts 25 Jul, so a 7-day offset is not yet due.
    const decision = resolveRelease(
      rule({ mode, offsetDays: 7 }),
      ctx({ enrollmentStartsAt: new Date('2026-07-25T00:00:00Z') }),
    )
    assert.equal(decision.released, false)
    assert.equal(decision.releasesAt?.toISOString(), '2026-08-01T00:00:00.000Z')
  })

  it('releases exactly at the boundary, not a moment after', () => {
    const decision = resolveRelease(
      rule({ mode, offsetDays: 1 }),
      ctx({ enrolledAt: new Date(NOW.getTime() - DAY), now: NOW }),
    )
    assert.equal(decision.released, true)
  })
})

describe('DAYS_AFTER_BATCH_START', () => {
  const mode = 'DAYS_AFTER_BATCH_START' as const

  it('anchors on the batch start date', () => {
    const decision = resolveRelease(
      rule({ mode, offsetDays: 14 }),
      ctx({ batchStartDate: new Date('2026-07-01T00:00:00Z') }),
    )
    assert.equal(decision.released, true)
  })

  it('withholds and reports the date when the batch has not reached the offset', () => {
    const decision = resolveRelease(
      rule({ mode, offsetDays: 14 }),
      ctx({ batchStartDate: new Date('2026-07-20T00:00:00Z') }),
    )
    assert.equal(decision.released, false)
    assert.equal(decision.releasesAt?.toISOString(), '2026-08-03T00:00:00.000Z')
  })

  it('reflects a rescheduled batch immediately, because nothing is materialised', () => {
    const lesson = rule({ mode, offsetDays: 7 })
    const before = resolveRelease(lesson, ctx({ batchStartDate: new Date('2026-07-01T00:00:00Z') }))
    assert.equal(before.released, true)

    // Cohort slips a month: the same lesson re-locks with no backfill anywhere.
    const after = resolveRelease(lesson, ctx({ batchStartDate: new Date('2026-08-01T00:00:00Z') }))
    assert.equal(after.released, false)
    assert.equal(after.releasesAt?.toISOString(), '2026-08-08T00:00:00.000Z')
  })

  /**
   * The self-paced-student case. Locking them out of content they paid for would
   * be worse than pacing from their own enrollment date.
   */
  it('falls back to the enrollment anchor when there is no batch, and warns', () => {
    const decision = resolveRelease(rule({ mode, offsetDays: 7 }), ctx({ batchStartDate: null }))
    assert.equal(decision.released, true)
    assert.match(decision.warning ?? '', /no batch/i)
  })

  it('still paces correctly under that fallback', () => {
    const decision = resolveRelease(
      rule({ mode, offsetDays: 60 }),
      ctx({ batchStartDate: null }),
    )
    assert.equal(decision.released, false)
    assert.equal(decision.reason, 'NOT_YET')
    assert.ok(decision.warning)
  })
})

describe('FIXED_DATE', () => {
  const mode = 'FIXED_DATE' as const

  it('releases on or after the date', () => {
    assert.equal(
      resolveRelease(rule({ mode, releaseAt: new Date('2026-07-01T00:00:00Z') }), ctx()).released,
      true,
    )
  })

  it('withholds before the date', () => {
    const decision = resolveRelease(
      rule({ mode, releaseAt: new Date('2026-09-01T00:00:00Z') }),
      ctx(),
    )
    assert.equal(decision.released, false)
    assert.equal(decision.reason, 'NOT_YET')
  })

  it('stays locked when no date is set, and flags the misconfiguration', () => {
    const decision = resolveRelease(rule({ mode, releaseAt: null }), ctx())
    assert.equal(decision.released, false)
    assert.equal(decision.reason, 'MISCONFIGURED')
    assert.ok(decision.warning)
  })
})

describe('AFTER_SESSION', () => {
  const mode = 'AFTER_SESSION' as const

  it('releases once the session has an end time', () => {
    const decision = resolveRelease(
      rule({ mode, gateSession: session({ actualEnd: new Date('2026-07-20T11:30:00Z') }) }),
      ctx(),
    )
    assert.equal(decision.released, true)
  })

  it('releases when the session is marked ENDED without an explicit end time', () => {
    const decision = resolveRelease(
      rule({ mode, gateSession: session({ status: 'ENDED' }) }),
      ctx(),
    )
    assert.equal(decision.released, true)
  })

  it('withholds while the session is still scheduled, naming the gate', () => {
    const decision = resolveRelease(rule({ mode, gateSession: session() }), ctx())
    assert.equal(decision.released, false)
    assert.equal(decision.reason, 'AWAITING_SESSION')
    assert.equal(decision.gate?.title, 'Week 3 Live Class')
  })

  it('withholds while the session is live but unfinished', () => {
    const decision = resolveRelease(
      rule({ mode, gateSession: session({ status: 'LIVE' }) }),
      ctx(),
    )
    assert.equal(decision.released, false)
    assert.equal(decision.reason, 'AWAITING_SESSION')
  })

  /**
   * A cancelled gate would otherwise lock the lesson permanently with no signal
   * to anyone. Surfacing it as misconfigured gets it fixed.
   */
  it('flags a cancelled gate as unreachable rather than merely pending', () => {
    const decision = resolveRelease(
      rule({ mode, gateSession: session({ status: 'CANCELLED' }) }),
      ctx(),
    )
    assert.equal(decision.released, false)
    assert.equal(decision.reason, 'MISCONFIGURED')
    assert.match(decision.warning ?? '', /cancelled/i)
  })

  it('flags a deleted gate', () => {
    const decision = resolveRelease(rule({ mode, gateSession: null }), ctx())
    assert.equal(decision.released, false)
    assert.equal(decision.reason, 'MISCONFIGURED')
  })
})

describe('MANUAL', () => {
  const mode = 'MANUAL' as const

  it('stays locked until an instructor releases it', () => {
    const decision = resolveRelease(rule({ mode }), ctx())
    assert.equal(decision.released, false)
    assert.equal(decision.reason, 'MANUAL_HOLD')
  })

  it('releases once marked released', () => {
    const decision = resolveRelease(
      rule({ mode, manuallyReleasedAt: new Date('2026-07-25T00:00:00Z') }),
      ctx(),
    )
    assert.equal(decision.released, true)
  })

  it('honours a future manual release timestamp', () => {
    const decision = resolveRelease(
      rule({ mode, manuallyReleasedAt: new Date('2026-08-01T00:00:00Z') }),
      ctx(),
    )
    assert.equal(decision.released, false)
    assert.equal(decision.reason, 'MANUAL_HOLD')
  })
})

describe('describeRelease', () => {
  const format = (date: Date) => date.toISOString().slice(0, 10)

  it('returns null for released lessons', () => {
    assert.equal(describeRelease({ released: true }, format), null)
  })

  it('names the unlock date', () => {
    assert.equal(
      describeRelease(
        { released: false, reason: 'NOT_YET', releasesAt: new Date('2026-08-10T00:00:00Z') },
        format,
      ),
      'Unlocks 2026-08-10',
    )
  })

  it('names the gate session', () => {
    assert.equal(
      describeRelease(
        { released: false, reason: 'AWAITING_SESSION', gate: { ...session() } },
        format,
      ),
      'Unlocks after Week 3 Live Class',
    )
  })

  /** A student should never be shown "this lesson is misconfigured". */
  it('does not leak configuration problems to students', () => {
    const message = describeRelease(
      { released: false, reason: 'MISCONFIGURED', warning: 'gate deleted' },
      format,
    )
    assert.equal(message, 'Not yet available')
    assert.ok(!message.toLowerCase().includes('misconfig'))
  })
})
