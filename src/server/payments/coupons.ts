/**
 * Coupon lookup and redemption.
 *
 * The decision itself is pure and lives in ./pricing.ts. This module is only the
 * database around it: normalising the code a student typed, and counting a
 * redemption at the moment it actually becomes one.
 */

import { recordAudit } from '@/server/audit'
import { db } from '@/server/db'
import type { CouponTerms } from './pricing'

/**
 * Codes are stored and compared uppercase. Students type them off a WhatsApp
 * message with whatever capitalisation the message had, and a code that works for
 * the person who typed it in caps and not for the person who did not is a support
 * ticket that looks like a bug in the discount.
 */
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase()
}

export interface CouponRow extends CouponTerms {
  id: string
}

export async function findCouponByCode(code: string): Promise<CouponRow | null> {
  const normalized = normalizeCouponCode(code)
  if (!normalized) return null

  return db.coupon.findUnique({
    where: { code: normalized },
    select: {
      id: true,
      code: true,
      type: true,
      value: true,
      maxRedemptions: true,
      usedCount: true,
      minOrderMinor: true,
      validFrom: true,
      validTo: true,
      courseIds: true,
      active: true,
    },
  })
}

export interface RedemptionResult {
  /** False when the cap was already reached — the payment still stands. */
  withinCap: boolean
}

/**
 * Counts a redemption. Called when an order is *paid*, never when it is created:
 * counting at checkout would let abandoned carts burn a limited-run code, and a
 * "first 50 students" offer that ran out because 50 people opened a payment
 * window is not the offer that was advertised.
 *
 * The cap is enforced by the conditional update rather than by a read-then-write,
 * so two payments settling at once cannot both pass a check that only one should.
 * When the cap has genuinely been passed the increment still happens and the
 * discrepancy is audited: the student has already been charged the discounted
 * amount, and clawing that back at settlement time is worse than an over-redeemed
 * coupon an operator can look at.
 */
export async function redeemCoupon(couponId: string, orderId: string): Promise<RedemptionResult> {
  const coupon = await db.coupon.findUnique({
    where: { id: couponId },
    select: { code: true, maxRedemptions: true },
  })
  if (!coupon) return { withinCap: true }

  if (coupon.maxRedemptions === null) {
    await db.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } })
    return { withinCap: true }
  }

  const claimed = await db.coupon.updateMany({
    where: { id: couponId, usedCount: { lt: coupon.maxRedemptions } },
    data: { usedCount: { increment: 1 } },
  })

  if (claimed.count === 1) return { withinCap: true }

  await db.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } })
  await recordAudit({
    action: 'coupon.over_redeemed',
    entityType: 'Coupon',
    entityId: couponId,
    meta: { code: coupon.code, orderId, maxRedemptions: coupon.maxRedemptions },
  })

  return { withinCap: false }
}
