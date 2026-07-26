import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type CouponTerms,
  type PriceableItem,
  computeOrderTotals,
  discountFor,
  eligibleItems,
  evaluateCoupon,
  percentOfMinor,
  sumItems,
} from './pricing'

const NOW = new Date('2026-07-26T12:00:00Z')

function coupon(overrides: Partial<CouponTerms> = {}): CouponTerms {
  return {
    code: 'LAUNCH',
    type: 'PERCENT',
    value: 10,
    maxRedemptions: null,
    usedCount: 0,
    minOrderMinor: null,
    validFrom: null,
    validTo: null,
    courseIds: [],
    active: true,
    ...overrides,
  }
}

function item(overrides: Partial<PriceableItem> = {}): PriceableItem {
  return { courseId: 'course-1', priceMinor: 500_000, quantity: 1, ...overrides }
}

describe('percentOfMinor', () => {
  it('computes a clean percentage', () => {
    // 10% of ₹5,000.00
    assert.equal(percentOfMinor(500_000, 10), 50_000)
  })

  it('rounds a half-paisa up, in the customer\'s favour', () => {
    // 10% of ₹9.99 is 99.9 paise. Rounding down would charge ₹9.00 on a "10% off"
    // that the customer can compute in their head as ₹8.99.
    assert.equal(percentOfMinor(999, 10), 100)
  })

  it('rounds an exact tie up rather than to even', () => {
    // 50% of 1 paisa = 0.5 paise.
    assert.equal(percentOfMinor(1, 50), 1)
    // 5% of 10 paise = 0.5 paise.
    assert.equal(percentOfMinor(10, 5), 1)
  })

  it('rounds below the tie down', () => {
    // 33% of 100 paise = 33 paise exactly; 33% of 1 paisa = 0.33.
    assert.equal(percentOfMinor(1, 33), 0)
    assert.equal(percentOfMinor(100, 33), 33)
  })

  it('is exact at amounts a float would round wrong', () => {
    // 3% of ₹1,00,00,000.01 — the naive float path is 30000000.030000001.
    assert.equal(percentOfMinor(1_000_000_001, 3), 30_000_000)
  })

  it('handles the boundaries', () => {
    assert.equal(percentOfMinor(500_000, 0), 0)
    assert.equal(percentOfMinor(500_000, 100), 500_000)
    assert.equal(percentOfMinor(0, 25), 0)
  })

  it('refuses a fractional percent rather than silently rounding it', () => {
    assert.throws(() => percentOfMinor(1000, 12.5), TypeError)
  })

  it('refuses a fractional amount, which would mean a float reached a money path', () => {
    assert.throws(() => percentOfMinor(10.5, 10), TypeError)
    assert.throws(() => percentOfMinor(-100, 10), TypeError)
  })
})

describe('sumItems', () => {
  it('multiplies by quantity', () => {
    assert.equal(sumItems([item({ priceMinor: 250_000, quantity: 3 })]), 750_000)
  })

  it('rejects a fractional price', () => {
    assert.throws(() => sumItems([item({ priceMinor: 99.5 })]), TypeError)
  })

  it('rejects a zero quantity', () => {
    assert.throws(() => sumItems([item({ quantity: 0 })]), TypeError)
  })
})

describe('discountFor', () => {
  it('clamps a flat coupon that exceeds the order', () => {
    // ₹5,000 off a ₹3,000 order must not produce a ₹2,000 refund request.
    const verdict = discountFor(coupon({ type: 'FLAT', value: 500_000 }), 300_000)
    assert.equal(verdict, 300_000)
  })

  it('clamps a percentage stored above 100', () => {
    assert.equal(discountFor(coupon({ type: 'PERCENT', value: 150 }), 300_000), 300_000)
  })

  it('treats a negative flat value as no discount', () => {
    assert.equal(discountFor(coupon({ type: 'FLAT', value: -100 }), 300_000), 0)
  })
})

describe('eligibleItems', () => {
  it('admits everything when the coupon is unscoped', () => {
    const items = [item({ courseId: 'a' }), item({ courseId: 'b' })]
    assert.equal(eligibleItems(items, []).length, 2)
  })

  it('filters to the scoped courses', () => {
    const items = [item({ courseId: 'a' }), item({ courseId: 'b' })]
    const eligible = eligibleItems(items, ['b'])
    assert.deepEqual(
      eligible.map((line) => line.courseId),
      ['b'],
    )
  })

  it('excludes lines with no course, so a fee installment is never discounted by a course coupon', () => {
    assert.equal(eligibleItems([item({ courseId: null })], ['a']).length, 0)
  })
})

describe('evaluateCoupon', () => {
  const ctx = { items: [item({ priceMinor: 500_000 })], now: NOW }

  it('accepts a live percentage coupon', () => {
    const verdict = evaluateCoupon(coupon(), ctx)
    assert.equal(verdict.ok, true)
    assert.equal(verdict.ok && verdict.discountMinor, 50_000)
  })

  it('rejects a deactivated coupon', () => {
    const verdict = evaluateCoupon(coupon({ active: false }), ctx)
    assert.equal(verdict.ok === false && verdict.reason, 'INACTIVE')
  })

  it('rejects one whose window has not opened', () => {
    const verdict = evaluateCoupon(
      coupon({ validFrom: new Date('2026-08-01T00:00:00Z') }),
      ctx,
    )
    assert.equal(verdict.ok === false && verdict.reason, 'NOT_STARTED')
  })

  it('rejects an expired coupon', () => {
    const verdict = evaluateCoupon(coupon({ validTo: new Date('2026-07-01T00:00:00Z') }), ctx)
    assert.equal(verdict.ok === false && verdict.reason, 'EXPIRED')
  })

  it('accepts one on its last valid instant', () => {
    const verdict = evaluateCoupon(coupon({ validTo: NOW }), ctx)
    assert.equal(verdict.ok, true)
  })

  it('rejects one that has hit its redemption cap', () => {
    const verdict = evaluateCoupon(coupon({ maxRedemptions: 50, usedCount: 50 }), ctx)
    assert.equal(verdict.ok === false && verdict.reason, 'EXHAUSTED')
  })

  it('accepts the last redemption of a capped coupon', () => {
    const verdict = evaluateCoupon(coupon({ maxRedemptions: 50, usedCount: 49 }), ctx)
    assert.equal(verdict.ok, true)
  })

  it('rejects one scoped to a course that is not in the order', () => {
    const verdict = evaluateCoupon(coupon({ courseIds: ['other-course'] }), ctx)
    assert.equal(verdict.ok === false && verdict.reason, 'NOT_APPLICABLE')
  })

  it('discounts only the scoped course when the order has several', () => {
    const verdict = evaluateCoupon(coupon({ type: 'PERCENT', value: 50, courseIds: ['course-2'] }), {
      items: [
        item({ courseId: 'course-1', priceMinor: 400_000 }),
        item({ courseId: 'course-2', priceMinor: 200_000 }),
      ],
      now: NOW,
    })
    // 50% of the ₹2,000 scoped line, not of the ₹6,000 order.
    assert.equal(verdict.ok && verdict.discountMinor, 100_000)
  })

  it('rejects an order below the minimum and reports the threshold', () => {
    const verdict = evaluateCoupon(coupon({ minOrderMinor: 1_000_000 }), ctx)
    assert.equal(verdict.ok === false && verdict.reason, 'BELOW_MINIMUM')
    assert.equal(verdict.ok === false && verdict.minOrderMinor, 1_000_000)
  })

  it('measures the minimum against the whole order, not the scoped subset', () => {
    const verdict = evaluateCoupon(
      coupon({ minOrderMinor: 500_000, courseIds: ['course-2'] }),
      {
        items: [
          item({ courseId: 'course-1', priceMinor: 400_000 }),
          item({ courseId: 'course-2', priceMinor: 200_000 }),
        ],
        now: NOW,
      },
    )
    assert.equal(verdict.ok, true)
  })

  it('reports a coupon that would change nothing rather than applying it silently', () => {
    const verdict = evaluateCoupon(coupon({ type: 'FLAT', value: 0 }), ctx)
    assert.equal(verdict.ok === false && verdict.reason, 'NO_EFFECT')
  })

  /** State before window before quota before scope before minimum. */
  it('reports the first thing that is wrong, not an incidental one', () => {
    const verdict = evaluateCoupon(
      coupon({ active: false, validTo: new Date('2020-01-01T00:00:00Z'), minOrderMinor: 99_999_999 }),
      ctx,
    )
    assert.equal(verdict.ok === false && verdict.reason, 'INACTIVE')
  })
})

describe('computeOrderTotals', () => {
  it('sums, discounts and totals', () => {
    const totals = computeOrderTotals([item({ priceMinor: 500_000 })], 50_000)
    assert.deepEqual(totals, {
      subtotalMinor: 500_000,
      discountMinor: 50_000,
      taxMinor: 0,
      totalMinor: 450_000,
    })
  })

  /**
   * The failure this exists to prevent: a gateway charged a negative amount
   * treats it as a positive one, so a coupon larger than the order would bill the
   * student the discount.
   */
  it('never produces a total below zero', () => {
    const totals = computeOrderTotals([item({ priceMinor: 300_000 })], 500_000)
    assert.equal(totals.totalMinor, 0)
    assert.equal(totals.discountMinor, 300_000, 'the discount is clamped, not the total alone')
  })

  it('discounts exactly to zero without going negative', () => {
    const totals = computeOrderTotals([item({ priceMinor: 300_000 })], 300_000)
    assert.equal(totals.totalMinor, 0)
  })

  it('adds tax after the discount', () => {
    const totals = computeOrderTotals([item({ priceMinor: 500_000 })], 50_000, 81_000)
    assert.equal(totals.totalMinor, 531_000)
  })

  it('refuses a negative discount, which would silently raise the price', () => {
    assert.throws(() => computeOrderTotals([item()], -100), TypeError)
  })

  it('keeps line items summing to the subtotal across many lines', () => {
    const items = Array.from({ length: 7 }, (_, index) =>
      item({ courseId: `course-${index}`, priceMinor: 33_333 }),
    )
    const totals = computeOrderTotals(items, 0)
    assert.equal(totals.subtotalMinor, 233_331)
    assert.equal(totals.totalMinor, 233_331)
  })
})
