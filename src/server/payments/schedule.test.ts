import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  addDaysInZone,
  addMonthsInZone,
  buildInstallmentPlan,
  daysInMonth,
  instantFromZonedParts,
  splitAmount,
  zoneOffsetMs,
  zonedParts,
} from './schedule'

const IST = 'Asia/Kolkata'
/** A DST zone, to prove the arithmetic is not accidentally India-specific. */
const NY = 'America/New_York'

describe('splitAmount', () => {
  it('divides evenly when it can', () => {
    assert.deepEqual(splitAmount(900_000, 3), [300_000, 300_000, 300_000])
  })

  /** The invariant that matters: nothing is lost or invented in the division. */
  it('distributes the remainder so the parts sum to the total', () => {
    const parts = splitAmount(1_000_001, 3)
    assert.deepEqual(parts, [333_334, 333_334, 333_333])
    assert.equal(
      parts.reduce((sum, part) => sum + part, 0),
      1_000_001,
    )
  })

  it('holds that invariant across a wide sweep', () => {
    for (let total = 0; total < 400; total += 7) {
      for (let parts = 1; parts <= 12; parts += 1) {
        const split = splitAmount(total, parts)
        assert.equal(split.length, parts)
        assert.equal(
          split.reduce((sum, part) => sum + part, 0),
          total,
          `${total} into ${parts}`,
        )
      }
    }
  })

  it('front-loads the remainder so the last installment is never the largest', () => {
    const parts = splitAmount(100, 3)
    assert.deepEqual(parts, [34, 33, 33])
    assert.ok(parts[parts.length - 1]! <= parts[0]!)
  })

  it('handles a single installment', () => {
    assert.deepEqual(splitAmount(123_456, 1), [123_456])
  })

  it('refuses a fractional total or a zero count', () => {
    assert.throws(() => splitAmount(100.5, 2), TypeError)
    assert.throws(() => splitAmount(-100, 2), TypeError)
    assert.throws(() => splitAmount(100, 0), TypeError)
  })
})

describe('zone decomposition', () => {
  it('reads the wall clock in the org timezone, not the server one', () => {
    // 2026-01-30T18:30:00Z is 31 January in IST.
    const parts = zonedParts(IST, new Date('2026-01-30T18:30:00Z'))
    assert.deepEqual(parts, { year: 2026, month: 1, day: 31, hour: 0, minute: 0, second: 0 })
  })

  it('renders midnight as hour 0, never hour 24', () => {
    assert.equal(zonedParts(IST, new Date('2026-06-14T18:30:00Z')).hour, 0)
    assert.equal(zonedParts('UTC', new Date('2026-06-14T00:00:00Z')).hour, 0)
  })

  it('reports the zone offset', () => {
    assert.equal(zoneOffsetMs(IST, new Date('2026-06-01T00:00:00Z')), 5.5 * 3_600_000)
    // New York is -4 in summer and -5 in winter.
    assert.equal(zoneOffsetMs(NY, new Date('2026-07-01T12:00:00Z')), -4 * 3_600_000)
    assert.equal(zoneOffsetMs(NY, new Date('2026-01-01T12:00:00Z')), -5 * 3_600_000)
  })

  it('round-trips an instant through its zoned parts', () => {
    for (const iso of [
      '2026-01-30T18:30:00Z',
      '2026-07-04T09:15:00Z',
      '2025-11-02T05:30:00Z',
      '2026-03-08T07:00:00Z',
    ]) {
      for (const zone of [IST, NY, 'UTC', 'Pacific/Auckland']) {
        const instant = new Date(iso)
        const round = instantFromZonedParts(zone, zonedParts(zone, instant))
        assert.equal(round.toISOString(), instant.toISOString(), `${iso} in ${zone}`)
      }
    }
  })
})

describe('daysInMonth', () => {
  it('knows February', () => {
    assert.equal(daysInMonth(2026, 2), 28)
    assert.equal(daysInMonth(2028, 2), 29)
    assert.equal(daysInMonth(2100, 2), 28)
  })

  it('knows the 30-day months', () => {
    assert.equal(daysInMonth(2026, 4), 30)
    assert.equal(daysInMonth(2026, 12), 31)
  })
})

describe('addMonthsInZone', () => {
  /**
   * The bug this exists to prevent: a fee due on 31 January IST is stored as
   * 2026-01-30T18:30:00Z. Stepping a month in UTC lands on 2026-02-28T18:30:00Z,
   * which renders as 1 March in IST — the student is told the wrong date and the
   * overdue job agrees with it.
   */
  it('clamps 31 January to the end of February, in the org timezone', () => {
    const first = new Date('2026-01-30T18:30:00Z') // 31 Jan 00:00 IST
    const next = addMonthsInZone(IST, first, 1)
    assert.deepEqual(zonedParts(IST, next), {
      year: 2026,
      month: 2,
      day: 28,
      hour: 0,
      minute: 0,
      second: 0,
    })
  })

  it('clamps to 29 February in a leap year', () => {
    const first = new Date('2028-01-30T18:30:00Z')
    assert.equal(zonedParts(IST, addMonthsInZone(IST, first, 1)).day, 29)
  })

  it('does not compound the clamp across steps', () => {
    // Every step is measured from the original 31st, so March is the 31st again.
    const first = new Date('2026-01-30T18:30:00Z')
    assert.equal(zonedParts(IST, addMonthsInZone(IST, first, 2)).day, 31)
  })

  it('rolls into the next year', () => {
    const december = new Date('2026-12-14T18:30:00Z') // 15 Dec IST
    const parts = zonedParts(IST, addMonthsInZone(IST, december, 2))
    assert.equal(parts.year, 2027)
    assert.equal(parts.month, 2)
  })

  it('keeps the wall-clock time across a DST transition', () => {
    // 15 Feb 09:00 New York (EST) plus one month is 15 Mar 09:00 EDT — a different
    // UTC instant, the same time on the student's clock.
    const february = instantFromZonedParts(NY, {
      year: 2026,
      month: 2,
      day: 15,
      hour: 9,
      minute: 0,
      second: 0,
    })
    const march = addMonthsInZone(NY, february, 1)
    assert.equal(zonedParts(NY, march).hour, 9)
    assert.notEqual(march.getTime() - february.getTime(), 28 * 86_400_000)
  })
})

describe('addDaysInZone', () => {
  it('adds whole days, not fixed milliseconds, across a DST boundary', () => {
    // 7 March 2026 09:00 New York, plus 7 days, crosses the spring-forward.
    const before = instantFromZonedParts(NY, {
      year: 2026,
      month: 3,
      day: 7,
      hour: 9,
      minute: 0,
      second: 0,
    })
    const after = addDaysInZone(NY, before, 7)
    assert.deepEqual(zonedParts(NY, after), {
      year: 2026,
      month: 3,
      day: 14,
      hour: 9,
      minute: 0,
      second: 0,
    })
    // A naive `+ 7 * 86400000` would be an hour out.
    assert.equal(after.getTime() - before.getTime(), 7 * 86_400_000 - 3_600_000)
  })

  it('rolls over a month boundary', () => {
    const parts = zonedParts(IST, addDaysInZone(IST, new Date('2026-01-30T18:30:00Z'), 1))
    assert.deepEqual(parts, { year: 2026, month: 2, day: 1, hour: 0, minute: 0, second: 0 })
  })
})

describe('buildInstallmentPlan', () => {
  const firstDueDate = new Date('2026-01-30T18:30:00Z') // 31 Jan 00:00 IST

  it('numbers installments from one and sums to the total', () => {
    const plan = buildInstallmentPlan({
      totalMinor: 1_000_000,
      count: 3,
      firstDueDate,
      cadence: 'MONTHLY',
      timezone: IST,
    })

    assert.deepEqual(
      plan.map((installment) => installment.seq),
      [1, 2, 3],
    )
    assert.equal(
      plan.reduce((sum, installment) => sum + installment.amountMinor, 0),
      1_000_000,
    )
  })

  it('steps monthly due dates in the org calendar', () => {
    const plan = buildInstallmentPlan({
      totalMinor: 900_000,
      count: 3,
      firstDueDate,
      cadence: 'MONTHLY',
      timezone: IST,
    })

    assert.deepEqual(
      plan.map((installment) => {
        const parts = zonedParts(IST, installment.dueDate)
        return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
      }),
      ['2026-01-31', '2026-02-28', '2026-03-31'],
    )
  })

  it('steps weekly and fortnightly', () => {
    const weekly = buildInstallmentPlan({
      totalMinor: 400,
      count: 4,
      firstDueDate,
      cadence: 'WEEKLY',
      timezone: IST,
    })
    assert.deepEqual(
      weekly.map((installment) => zonedParts(IST, installment.dueDate).day),
      [31, 7, 14, 21],
    )

    const fortnightly = buildInstallmentPlan({
      totalMinor: 400,
      count: 3,
      firstDueDate,
      cadence: 'FORTNIGHTLY',
      timezone: IST,
    })
    assert.deepEqual(
      fortnightly.map((installment) => zonedParts(IST, installment.dueDate).day),
      [31, 14, 28],
    )
  })

  it('puts the first installment on the requested date exactly', () => {
    const plan = buildInstallmentPlan({
      totalMinor: 100,
      count: 2,
      firstDueDate,
      cadence: 'MONTHLY',
      timezone: IST,
    })
    assert.equal(plan[0]!.dueDate.toISOString(), firstDueDate.toISOString())
  })

  it('rejects an invalid first due date', () => {
    assert.throws(
      () =>
        buildInstallmentPlan({
          totalMinor: 100,
          count: 2,
          firstDueDate: new Date('not a date'),
          cadence: 'MONTHLY',
          timezone: IST,
        }),
      TypeError,
    )
  })
})
