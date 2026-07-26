import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_LOOKBACK_MINUTES,
  MAX_LOOKBACK_MINUTES,
  SCHEDULED_TRIGGERS,
  type ScheduleAnchor,
  type ScheduleRule,
  type SchedulingClock,
  anchorScanRange,
  anchorScanRanges,
  isDue,
  isScheduledTrigger,
  precisionFor,
  resolveFireAt,
  schedulingWindow,
  selectDue,
} from './schedule'

const IST = 'Asia/Kolkata'
const NOW = new Date('2026-07-26T12:00:00Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE

function clock(overrides: Partial<SchedulingClock> = {}): SchedulingClock {
  return {
    timezone: IST,
    dailySendHour: 9,
    after: new Date(NOW.getTime() - HOUR),
    until: NOW,
    ...overrides,
  }
}

function rule(overrides: Partial<ScheduleRule> = {}): ScheduleRule {
  return {
    id: 'rule-1',
    key: 'core.class-reminder',
    trigger: 'CLASS_REMINDER',
    offsetMinutes: -30,
    ...overrides,
  }
}

function anchor(overrides: Partial<ScheduleAnchor> = {}): ScheduleAnchor {
  return {
    trigger: 'CLASS_REMINDER',
    kind: 'session',
    id: 'sess-1',
    at: new Date('2026-07-26T12:30:00Z'),
    ...overrides,
  }
}

describe('trigger classification', () => {
  it('covers every scheduled trigger the engine claims to evaluate', () => {
    assert.deepEqual([...SCHEDULED_TRIGGERS].sort(), [
      'ASSIGNMENT_DUE',
      'CALENDAR_EVENT',
      'CLASS_REMINDER',
      'DRIP_UNLOCKED',
      'ENROLLMENT_EXPIRING',
      'FEE_DUE',
      'FEE_OVERDUE',
      'SESSION_STARTING',
    ])
  })

  /** These two are event-driven; a clock has no business firing them. */
  it('excludes ENROLLMENT_CREATED and CUSTOM', () => {
    assert.equal(isScheduledTrigger('ENROLLMENT_CREATED'), false)
    assert.equal(isScheduledTrigger('CUSTOM'), false)
  })

  it('pins date-shaped triggers to a daily send hour and time-shaped ones to the instant', () => {
    assert.equal(precisionFor('CLASS_REMINDER'), 'INSTANT')
    assert.equal(precisionFor('ASSIGNMENT_DUE'), 'INSTANT')
    assert.equal(precisionFor('FEE_DUE'), 'DAILY')
    assert.equal(precisionFor('DRIP_UNLOCKED'), 'DAILY')
  })
})

describe('schedulingWindow', () => {
  it('looks back an hour by default', () => {
    const window = schedulingWindow(NOW)
    assert.equal(window.until.toISOString(), NOW.toISOString())
    assert.equal(
      window.after.toISOString(),
      new Date(NOW.getTime() - DEFAULT_LOOKBACK_MINUTES * MINUTE).toISOString(),
    )
  })

  /** A cron down for a week must not dump seven days of stale reminders at once. */
  it('clamps an absurd lookback', () => {
    const window = schedulingWindow(NOW, 60 * 24 * 7)
    assert.equal(
      window.after.toISOString(),
      new Date(NOW.getTime() - MAX_LOOKBACK_MINUTES * MINUTE).toISOString(),
    )
  })

  it('clamps a zero or negative lookback to a minute rather than an empty window', () => {
    assert.equal(schedulingWindow(NOW, 0).after.toISOString(), '2026-07-26T11:59:00.000Z')
    assert.equal(schedulingWindow(NOW, -5).after.toISOString(), '2026-07-26T11:59:00.000Z')
  })
})

describe('resolveFireAt — INSTANT', () => {
  it('fires the offset before the anchor', () => {
    const fireAt = resolveFireAt(rule({ offsetMinutes: -30 }), anchor(), clock())
    assert.equal(fireAt.toISOString(), '2026-07-26T12:00:00.000Z')
  })

  it('supports a positive offset, for follow-ups after the event', () => {
    const fireAt = resolveFireAt(rule({ offsetMinutes: 60 }), anchor(), clock())
    assert.equal(fireAt.toISOString(), '2026-07-26T13:30:00.000Z')
  })

  it('ignores the org timezone, because an exact moment has no timezone', () => {
    const ist = resolveFireAt(rule(), anchor(), clock())
    const utc = resolveFireAt(rule(), anchor(), clock({ timezone: 'UTC' }))
    assert.equal(ist.toISOString(), utc.toISOString())
  })
})

describe('resolveFireAt — DAILY', () => {
  const feeRule = rule({ trigger: 'FEE_DUE', offsetMinutes: -3 * 24 * 60 })
  const feeAnchor = anchor({
    trigger: 'FEE_DUE',
    kind: 'installment',
    id: 'inst-1',
    // 2026-08-01 05:30 IST.
    at: new Date('2026-08-01T00:00:00Z'),
  })

  /**
   * The whole point of the DAILY precision: a fee due date carries a time of day
   * that is an artefact of how the row was written, and a reminder must not
   * inherit it.
   */
  it('fires at the org send hour, not at the anchor time of day', () => {
    const fireAt = resolveFireAt(feeRule, feeAnchor, clock())
    // 09:00 IST on 29 July = 03:30 UTC.
    assert.equal(fireAt.toISOString(), '2026-07-29T03:30:00.000Z')
  })

  /**
   * The bug this guards: computing the send hour in UTC puts an Indian client's
   * 9am reminder out at 14:30 local, every single time, with no DST to blame.
   */
  it('differs from the same computation in UTC by exactly the zone offset', () => {
    const inIst = resolveFireAt(feeRule, feeAnchor, clock())
    const inUtc = resolveFireAt(feeRule, feeAnchor, clock({ timezone: 'UTC' }))
    assert.equal(inUtc.toISOString(), '2026-07-29T09:00:00.000Z')
    assert.equal(inUtc.getTime() - inIst.getTime(), 5.5 * HOUR)
  })

  /**
   * Straddling midnight is the case docs/01-architecture.md calls out: 19:00 UTC
   * on the 1st is already the 2nd in Kolkata, so "three days before" is the 30th.
   */
  it('takes the local calendar day, so a late-UTC due date shifts the reminder', () => {
    const lateAnchor = { ...feeAnchor, at: new Date('2026-08-01T19:00:00Z') }
    const fireAt = resolveFireAt(feeRule, lateAnchor, clock())
    assert.equal(fireAt.toISOString(), '2026-07-30T03:30:00.000Z')
  })

  it('honours a different send hour', () => {
    const fireAt = resolveFireAt(feeRule, feeAnchor, clock({ dailySendHour: 18 }))
    assert.equal(fireAt.toISOString(), '2026-07-29T12:30:00.000Z')
  })

  it('handles a zero offset as "on the day itself"', () => {
    const fireAt = resolveFireAt({ offsetMinutes: 0 }, feeAnchor, clock())
    assert.equal(fireAt.toISOString(), '2026-08-01T03:30:00.000Z')
  })

  it('handles a positive offset as "after it lapsed"', () => {
    const overdue = { ...feeAnchor, trigger: 'FEE_OVERDUE' as const }
    const fireAt = resolveFireAt({ offsetMinutes: 2 * 24 * 60 }, overdue, clock())
    assert.equal(fireAt.toISOString(), '2026-08-03T03:30:00.000Z')
  })

  /** A zone with DST must still land on its own 9am, not on IST's. */
  it('resolves the send hour in whichever zone the org is in', () => {
    const fireAt = resolveFireAt(feeRule, feeAnchor, clock({ timezone: 'America/New_York' }))
    // Shifted back three days the instant is 29 Jul 00:00 UTC, which is still
    // 28 Jul in New York — so 09:00 EDT on the 28th.
    assert.equal(fireAt.toISOString(), '2026-07-28T13:00:00.000Z')
  })
})

describe('resolveFireAt — anchor offset override', () => {
  /**
   * A CalendarEvent that declares reminderOffsets is stating exactly when it
   * wants announcing; the rule's generic offset would stack on top of it.
   */
  it('lets the anchor dictate its own lead time', () => {
    const fireAt = resolveFireAt(
      rule({ trigger: 'CALENDAR_EVENT', offsetMinutes: -30 }),
      anchor({
        trigger: 'CALENDAR_EVENT',
        kind: 'event',
        id: 'evt-1:60',
        at: new Date('2026-07-26T18:00:00Z'),
        overrideOffsetMinutes: -60,
      }),
      clock(),
    )
    assert.equal(fireAt.toISOString(), '2026-07-26T17:00:00.000Z')
  })
})

describe('isDue', () => {
  const window = clock()

  it('includes the upper bound', () => {
    assert.equal(isDue(NOW, window), true)
  })

  /** Half-open: an anchor on a boundary belongs to exactly one of two runs. */
  it('excludes the lower bound, so consecutive windows do not overlap', () => {
    assert.equal(isDue(window.after, window), false)
    assert.equal(isDue(new Date(window.after.getTime() + 1), window), true)
  })

  it('excludes the future', () => {
    assert.equal(isDue(new Date(NOW.getTime() + 1), window), false)
  })
})

describe('selectDue', () => {
  it('matches a rule to anchors of its own trigger only', () => {
    const rules = [rule({ id: 'class', trigger: 'CLASS_REMINDER', offsetMinutes: -30 })]
    const anchors = [
      anchor({ id: 'class-session' }),
      anchor({ id: 'broadcast', trigger: 'SESSION_STARTING' }),
    ]

    const due = selectDue(rules, anchors, clock())
    assert.equal(due.length, 1)
    assert.equal(due[0]?.anchor.id, 'class-session')
  })

  it('fires several rules off one anchor, which is how two lead times coexist', () => {
    const rules = [
      rule({ id: 'day-before', offsetMinutes: -30 }),
      rule({ id: 'ten-minutes', offsetMinutes: -10 }),
    ]
    // 12:30 start: -30 lands at 12:00 (in window), -10 at 12:20 (future).
    const due = selectDue(rules, [anchor()], clock())
    assert.deepEqual(
      due.map((fire) => fire.rule.id),
      ['day-before'],
    )
  })

  it('returns nothing when no anchor lands in the window', () => {
    const rules = [rule({ offsetMinutes: -30 })]
    const anchors = [anchor({ at: new Date('2026-07-27T12:30:00Z') })]
    assert.deepEqual(selectDue(rules, anchors, clock()), [])
  })

  /**
   * The idempotency contract at the pure level: two runs whose windows overlap
   * select the same (rule, anchor) pair, so the dedupe key they produce is
   * identical and the second insert is a no-op.
   */
  it('selects the same pair from two overlapping windows', () => {
    const rules = [rule({ offsetMinutes: -30 })]
    const anchors = [anchor()]

    const firstRun = selectDue(rules, anchors, clock())
    const secondRun = selectDue(
      rules,
      anchors,
      clock({ after: new Date(NOW.getTime() - 30 * MINUTE), until: new Date(NOW.getTime() + MINUTE) }),
    )

    assert.equal(firstRun.length, 1)
    assert.equal(secondRun.length, 1)
    assert.equal(firstRun[0]?.anchor.id, secondRun[0]?.anchor.id)
    assert.equal(firstRun[0]?.fireAt.getTime(), secondRun[0]?.fireAt.getTime())
  })

  it('carries the anchor type through, so callers keep their recipients', () => {
    interface Rich extends ScheduleAnchor {
      recipients: string[]
    }
    const rich: Rich = { ...anchor(), recipients: ['user-1'] }
    const due = selectDue<Rich>([rule()], [rich], clock())
    assert.deepEqual(due[0]?.anchor.recipients, ['user-1'])
  })
})

describe('anchorScanRange', () => {
  /** A -30 minute rule needs anchors up to 30 minutes past the window end. */
  it('widens the query by the rule offsets', () => {
    const range = anchorScanRange([rule({ offsetMinutes: -30 })], clock())
    assert.equal(range.from.toISOString(), '2026-07-26T11:30:00.000Z')
    assert.equal(range.to.toISOString(), '2026-07-26T12:30:00.000Z')
  })

  it('spans the widest and narrowest offset across all rules', () => {
    const range = anchorScanRange(
      [rule({ id: 'a', offsetMinutes: -1440 }), rule({ id: 'b', offsetMinutes: 120 })],
      clock(),
    )
    assert.equal(range.from.toISOString(), '2026-07-26T09:00:00.000Z')
    assert.equal(range.to.toISOString(), '2026-07-27T12:00:00.000Z')
  })

  /** DAILY rules move the fire time to a send hour up to a day either side. */
  it('pads for daily rules, because over-fetching costs a row and under-fetching costs a reminder', () => {
    const range = anchorScanRange([rule({ trigger: 'FEE_DUE', offsetMinutes: 0 })], clock())
    assert.equal(range.from.toISOString(), '2026-07-24T23:00:00.000Z')
    assert.equal(range.to.toISOString(), '2026-07-28T00:00:00.000Z')
  })

  it('degenerates to the window itself when there are no rules', () => {
    const range = anchorScanRange([], clock())
    assert.equal(range.from.toISOString(), '2026-07-26T11:00:00.000Z')
    assert.equal(range.to.toISOString(), NOW.toISOString())
  })
})

describe('anchorScanRanges', () => {
  /**
   * The waste this prevents: one "30 days before access expires" rule would
   * otherwise widen the timetable query to thirty days too.
   */
  it('keeps a wide rule from widening an unrelated trigger', () => {
    const ranges = anchorScanRanges(
      [
        rule({ id: 'class', trigger: 'CLASS_REMINDER', offsetMinutes: -30 }),
        rule({ id: 'expiry', trigger: 'ENROLLMENT_EXPIRING', offsetMinutes: -30 * 24 * 60 }),
      ],
      clock(),
    )

    const classRange = ranges.get('CLASS_REMINDER')
    assert.equal(classRange?.from.toISOString(), '2026-07-26T11:30:00.000Z')
    assert.equal(classRange?.to.toISOString(), '2026-07-26T12:30:00.000Z')

    const expiryRange = ranges.get('ENROLLMENT_EXPIRING')
    assert.ok(expiryRange && expiryRange.to.getTime() > classRange!.to.getTime())
  })

  /** Membership is the enabled set: a trigger with no rule gets no collector run. */
  it('omits triggers no rule asks for', () => {
    const ranges = anchorScanRanges([rule({ trigger: 'CLASS_REMINDER' })], clock())
    assert.equal(ranges.has('CLASS_REMINDER'), true)
    assert.equal(ranges.has('FEE_DUE'), false)
    assert.equal(ranges.size, 1)
  })

  it('merges several rules on one trigger into one range', () => {
    const ranges = anchorScanRanges(
      [
        rule({ id: 'a', offsetMinutes: -30 }),
        rule({ id: 'b', offsetMinutes: -1440 }),
      ],
      clock(),
    )
    assert.equal(ranges.size, 1)
    assert.equal(ranges.get('CLASS_REMINDER')?.to.toISOString(), '2026-07-27T12:00:00.000Z')
  })
})
