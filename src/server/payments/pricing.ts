/**
 * Order pricing and coupon evaluation.
 *
 * Pure: no database, no clock, no currency formatting. `now` and the coupon terms
 * are passed in, which is what makes the whole matrix — window, redemptions,
 * scoping, minimum, rounding, clamping — testable without fixtures.
 *
 * Every value here is integer minor units, including the intermediates inside a
 * percentage calculation. That is stricter than "no floats in the schema": a
 * discount computed as `subtotal * 0.1` and rounded afterwards is a float that
 * held a currency value, and at scale it produces invoices whose line items do
 * not add up to their total. The percent path below never divides until the
 * numerator is known to be an exact multiple of the divisor.
 */

import type { CouponType } from '@/generated/prisma/enums'

/** A line as it will be snapshotted onto an OrderItem. */
export interface PriceableItem {
  /** Null for lines that are not a course purchase (a fee installment). */
  courseId: string | null
  priceMinor: number
  quantity: number
}

/** The subset of a Coupon row the decision actually depends on. */
export interface CouponTerms {
  code: string
  type: CouponType
  /** Percent (0-100) for PERCENT, minor units for FLAT. */
  value: number
  maxRedemptions: number | null
  usedCount: number
  minOrderMinor: number | null
  validFrom: Date | null
  validTo: Date | null
  /** Empty = applies to every line. */
  courseIds: readonly string[]
  active: boolean
}

export type CouponRejection =
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'EXHAUSTED'
  | 'NOT_APPLICABLE'
  | 'BELOW_MINIMUM'
  | 'NO_EFFECT'

export type CouponVerdict =
  | { ok: true; discountMinor: number }
  | {
      ok: false
      reason: CouponRejection
      message: string
      /** Set for BELOW_MINIMUM so the caller can format it in the org currency. */
      minOrderMinor?: number
    }

export interface CouponContext {
  items: readonly PriceableItem[]
  now: Date
}

export interface OrderTotals {
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  totalMinor: number
}

function assertMinor(amountMinor: number, label: string): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    // Throwing rather than coercing: a fractional or negative amount reaching a
    // money function is an upstream bug, and rounding it here would bury the bug
    // in a ledger instead of surfacing it in a stack trace.
    throw new TypeError(`${label} must be a non-negative integer of minor units, got ${amountMinor}.`)
  }
}

export function sumItems(items: readonly PriceableItem[]): number {
  return items.reduce((total, item) => {
    assertMinor(item.priceMinor, 'Item price')
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new TypeError(`Item quantity must be a positive integer, got ${item.quantity}.`)
    }
    return total + item.priceMinor * item.quantity
  }, 0)
}

/**
 * `percent` of `amountMinor`, rounded half-up, in integer arithmetic only.
 *
 * Ties round in the customer's favour: 10% off ₹9.99 discounts ₹1.00, not ₹0.99.
 * The half-paisa is worth less than the support conversation about it, and a
 * discount that rounds *down* is the kind of thing customers screenshot.
 */
export function percentOfMinor(amountMinor: number, percent: number): number {
  assertMinor(amountMinor, 'Amount')
  // Whole percents only, matching `Coupon.value`'s Int column. Accepting 12.5
  // here would reintroduce a float into the numerator for no product benefit.
  if (!Number.isSafeInteger(percent) || percent < 0) {
    throw new TypeError(`Percent must be a non-negative whole number, got ${percent}.`)
  }

  const scaled = amountMinor * percent
  const remainder = scaled % 100
  // `scaled - remainder` is an exact multiple of 100, so this division is exact
  // in binary floating point and needs no rounding of its own.
  const whole = (scaled - remainder) / 100
  return remainder * 2 >= 100 ? whole + 1 : whole
}

/** Lines the coupon's course scoping admits. Empty `courseIds` means all of them. */
export function eligibleItems(
  items: readonly PriceableItem[],
  courseIds: readonly string[],
): PriceableItem[] {
  if (courseIds.length === 0) return [...items]
  return items.filter((item) => item.courseId !== null && courseIds.includes(item.courseId))
}

/**
 * Discount a coupon yields against a subtotal, clamped so it can never exceed
 * what is being discounted. This clamp is the reason a ₹5,000 flat coupon on a
 * ₹3,000 order produces a ₹0 total rather than a ₹2,000 refund request.
 */
export function discountFor(terms: CouponTerms, eligibleSubtotalMinor: number): number {
  assertMinor(eligibleSubtotalMinor, 'Eligible subtotal')

  const raw =
    terms.type === 'PERCENT'
      ? // A coupon stored above 100% would otherwise discount more than the order.
        percentOfMinor(eligibleSubtotalMinor, Math.min(terms.value, 100))
      : Math.max(0, terms.value)

  return Math.min(raw, eligibleSubtotalMinor)
}

/**
 * Whether a coupon applies, and for how much.
 *
 * Check order is deliberate: state before window before quota before scope before
 * minimum, so the message a student sees names the first thing that is actually
 * wrong rather than an incidental one. "This code has expired" is actionable;
 * "your order is below the minimum" on an expired code is not.
 */
export function evaluateCoupon(terms: CouponTerms, ctx: CouponContext): CouponVerdict {
  if (!terms.active) {
    return { ok: false, reason: 'INACTIVE', message: 'This code is no longer active.' }
  }

  if (terms.validFrom && ctx.now.getTime() < terms.validFrom.getTime()) {
    return { ok: false, reason: 'NOT_STARTED', message: 'This code is not valid yet.' }
  }

  if (terms.validTo && ctx.now.getTime() > terms.validTo.getTime()) {
    return { ok: false, reason: 'EXPIRED', message: 'This code has expired.' }
  }

  if (terms.maxRedemptions !== null && terms.usedCount >= terms.maxRedemptions) {
    return { ok: false, reason: 'EXHAUSTED', message: 'This code has been fully redeemed.' }
  }

  const eligible = eligibleItems(ctx.items, terms.courseIds)
  if (eligible.length === 0) {
    return {
      ok: false,
      reason: 'NOT_APPLICABLE',
      message: 'This code does not apply to the items in your order.',
    }
  }

  // The minimum is tested against the whole order, not the eligible subset: it
  // expresses "spend at least this much with us", not "spend this much on the
  // scoped course".
  const subtotalMinor = sumItems(ctx.items)
  if (terms.minOrderMinor !== null && subtotalMinor < terms.minOrderMinor) {
    return {
      ok: false,
      reason: 'BELOW_MINIMUM',
      message: 'Your order is below the minimum for this code.',
      minOrderMinor: terms.minOrderMinor,
    }
  }

  const discountMinor = discountFor(terms, sumItems(eligible))
  if (discountMinor === 0) {
    // A zero discount silently applied reads as a broken coupon field. Say so.
    return {
      ok: false,
      reason: 'NO_EFFECT',
      message: 'This code does not reduce the price of this order.',
    }
  }

  return { ok: true, discountMinor }
}

/**
 * Order totals from lines plus an already-decided discount.
 *
 * `taxMinor` is a parameter rather than a computation: nothing in this
 * deployment's configuration carries a tax rate (see the note in
 * src/server/payments/checkout.ts), and inventing one would put wrong numbers on
 * an invoice, which is worse than putting none.
 */
export function computeOrderTotals(
  items: readonly PriceableItem[],
  discountMinor: number,
  taxMinor = 0,
): OrderTotals {
  const subtotalMinor = sumItems(items)
  assertMinor(discountMinor, 'Discount')
  assertMinor(taxMinor, 'Tax')

  // Second clamp, independent of discountFor: this function is also reachable
  // with a discount that was decided elsewhere, and a negative total would be
  // charged as a positive amount by every gateway.
  const applied = Math.min(discountMinor, subtotalMinor)

  return {
    subtotalMinor,
    discountMinor: applied,
    taxMinor,
    totalMinor: subtotalMinor - applied + taxMinor,
  }
}
