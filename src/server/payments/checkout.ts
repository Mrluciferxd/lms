/**
 * Checkout.
 *
 * Prices an order server-side, records it, and asks the gateway for something the
 * browser can pay. The client sends what it wants to buy and nothing about what it
 * costs — every amount here is read from the catalog or the fee schedule, because
 * an amount that arrives in a request body is an amount an attacker chose.
 *
 * ── ON TAX ───────────────────────────────────────────────────────────────────
 * `Order.taxMinor` exists and is written as 0. Nothing in this deployment carries
 * a tax rate — not OrgSettings, not Course, and `legal.gstin` is still a
 * TODO(client) placeholder. Computing GST from a rate nobody configured would put
 * a confident wrong number on an invoice, which is worse than an obviously absent
 * one. When the client supplies their registration, tax belongs here as a
 * configured rate, not as a constant.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { recordAudit } from '@/server/audit'
import { db } from '@/server/db'
import { getOrgSettings, isFeatureEnabled } from '@/server/org/settings'
import { findCouponByCode } from './coupons'
import { resolveGateway } from './index'
import { allocateDocumentNumber, seriesYear } from './numbering'
import { orderPurposeNotes, type OrderPurpose } from './orders'
import { computeOrderTotals, evaluateCoupon, type PriceableItem } from './pricing'
import type { CouponRejection } from './pricing'

export type CheckoutRequest =
  | { kind: 'COURSE'; courseId: string; batchId?: string | null; couponCode?: string | null }
  | { kind: 'INSTALLMENT'; installmentId: string }

export type CheckoutErrorCode =
  | 'NOT_FOUND'
  | 'NOT_PURCHASABLE'
  | 'ALREADY_ENROLLED'
  | 'BATCH_FULL'
  | 'COUPON_REJECTED'
  | 'GATEWAY_UNAVAILABLE'

export interface CheckoutSession {
  ok: true
  orderId: string
  number: string
  amountMinor: number
  currency: string
  subtotalMinor: number
  discountMinor: number
  gatewayOrderId: string
  /** Null when this deployment settles manually; the UI then shows instructions. */
  publicKey: string | null
  hasBrowserCheckout: boolean
  description: string
}

export type CheckoutResult =
  | CheckoutSession
  | {
      ok: false
      status: 400 | 403 | 404 | 409 | 503
      code: CheckoutErrorCode
      message: string
      couponReason?: CouponRejection
    }

function deny(
  status: 400 | 403 | 404 | 409 | 503,
  code: CheckoutErrorCode,
  message: string,
): CheckoutResult {
  return { ok: false, status, code, message }
}

interface PricedOrder {
  items: Array<PriceableItem & { titleSnapshot: string; batchId: string | null }>
  couponId: string | null
  couponCode: string | null
  discountMinor: number
  purpose: OrderPurpose
  description: string
}

/**
 * A course purchase. Everything that decides price or eligibility is re-read
 * here: a hidden "Buy" button is not authorization, and neither is a price
 * rendered on the page a minute ago.
 */
async function priceCoursePurchase(
  userId: string,
  request: Extract<CheckoutRequest, { kind: 'COURSE' }>,
): Promise<PricedOrder | CheckoutResult> {
  const course = await db.course.findUnique({
    where: { id: request.courseId },
    select: { id: true, title: true, status: true, priceMinor: true, currency: true },
  })

  // 404 rather than 403 for a draft course: a student probing course ids should
  // not learn which unpublished ones exist.
  if (!course || course.status !== 'PUBLISHED') {
    return deny(404, 'NOT_FOUND', 'Course not found.')
  }
  if (course.priceMinor === null) {
    return deny(404, 'NOT_PURCHASABLE', 'This course is not available for purchase.')
  }

  let batchId: string | null = null
  if (request.batchId) {
    const batch = await db.batch.findUnique({
      where: { id: request.batchId },
      select: {
        id: true,
        name: true,
        courseId: true,
        status: true,
        capacity: true,
        _count: { select: { enrollments: true } },
      },
    })

    if (!batch || batch.courseId !== course.id) {
      return deny(404, 'NOT_FOUND', 'That batch is not available for this course.')
    }
    if (batch.status !== 'ENROLLING' && batch.status !== 'UPCOMING') {
      return deny(409, 'NOT_PURCHASABLE', 'That batch is not open for enrollment.')
    }
    if (batch.capacity !== null && batch._count.enrollments >= batch.capacity) {
      return deny(409, 'BATCH_FULL', 'That batch is full.')
    }
    batchId = batch.id
  }

  const existing = await db.enrollment.findFirst({
    where: {
      userId,
      courseId: course.id,
      batchId,
      status: { in: ['ACTIVE', 'COMPLETED', 'PENDING'] },
    },
    select: { id: true },
  })
  if (existing) {
    return deny(409, 'ALREADY_ENROLLED', 'You already have access to this course.')
  }

  const items = [
    {
      courseId: course.id,
      batchId,
      titleSnapshot: course.title,
      priceMinor: course.priceMinor,
      quantity: 1,
    },
  ]

  if (!request.couponCode) {
    return {
      items,
      couponId: null,
      couponCode: null,
      discountMinor: 0,
      purpose: { kind: 'COURSE' },
      description: course.title,
    }
  }

  const coupon = await findCouponByCode(request.couponCode)
  if (!coupon) {
    return {
      ok: false,
      status: 400,
      code: 'COUPON_REJECTED',
      message: 'That code was not recognised.',
    }
  }

  const verdict = evaluateCoupon(coupon, { items, now: new Date() })
  if (!verdict.ok) {
    return {
      ok: false,
      status: 400,
      code: 'COUPON_REJECTED',
      message: verdict.message,
      couponReason: verdict.reason,
    }
  }

  return {
    items,
    couponId: coupon.id,
    couponCode: coupon.code,
    // Carried forward rather than recomputed at the call site: pricing a coupon
    // twice invites the two answers to drift, and one of them decides what the
    // student is charged while the other decides what the order records.
    discountMinor: verdict.discountMinor,
    purpose: { kind: 'COURSE' },
    description: course.title,
  }
}

/**
 * A fee installment. No coupon path: an installment plan is a schedule against an
 * already-agreed total, and discounting one installment would leave the schedule
 * no longer summing to the fee it was built from.
 */
async function priceInstallment(
  userId: string,
  request: Extract<CheckoutRequest, { kind: 'INSTALLMENT' }>,
): Promise<PricedOrder | CheckoutResult> {
  const installment = await db.feeInstallment.findUnique({
    where: { id: request.installmentId },
    select: {
      id: true,
      seq: true,
      label: true,
      amountMinor: true,
      status: true,
      feeSchedule: {
        select: {
          enrollment: {
            select: {
              userId: true,
              batchId: true,
              course: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
  })

  // Someone else's installment is reported as missing, not forbidden.
  if (!installment || installment.feeSchedule.enrollment.userId !== userId) {
    return deny(404, 'NOT_FOUND', 'Installment not found.')
  }
  if (installment.status !== 'PENDING' && installment.status !== 'OVERDUE') {
    return deny(409, 'NOT_PURCHASABLE', 'That installment is not payable.')
  }

  const enrollment = installment.feeSchedule.enrollment
  const label = installment.label ?? `Installment ${installment.seq}`
  const description = `${enrollment.course.title} — ${label}`

  return {
    items: [
      {
        courseId: enrollment.course.id,
        batchId: enrollment.batchId,
        titleSnapshot: description,
        priceMinor: installment.amountMinor,
        quantity: 1,
      },
    ],
    couponId: null,
    couponCode: null,
    discountMinor: 0,
    purpose: { kind: 'INSTALLMENT', installmentId: installment.id },
    description,
  }
}

export async function createCheckout(
  userId: string,
  request: CheckoutRequest,
): Promise<CheckoutResult> {
  // Feature gating is structural: with self-serve checkout off, this endpoint does
  // not exist rather than rendering without a button.
  if (!(await isFeatureEnabled('selfServeCheckout'))) {
    return deny(404, 'NOT_FOUND', 'Not found.')
  }
  if (request.kind === 'INSTALLMENT' && !(await isFeatureEnabled('feeInstallments'))) {
    return deny(404, 'NOT_FOUND', 'Not found.')
  }

  const priced =
    request.kind === 'COURSE'
      ? await priceCoursePurchase(userId, request)
      : await priceInstallment(userId, request)

  if ('ok' in priced) return priced

  const totals = computeOrderTotals(priced.items, priced.discountMinor)

  const gateway = resolveGateway()
  const settings = await getOrgSettings()
  const year = seriesYear(new Date(), settings.timezone)

  /**
   * The order row is written in its own transaction and the gateway is called
   * after it commits. Holding a transaction open across a network round trip
   * would pin a connection and an advisory lock for the duration of somebody
   * else's API latency; on a slow gateway that serialises every checkout in the
   * deployment behind one request.
   */
  const order = await db.$transaction(async (tx) => {
    const number = await allocateDocumentNumber(tx, 'ORDER', year)

    return tx.order.create({
      data: {
        number,
        userId,
        status: 'CREATED',
        gateway: gateway.key,
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        currency: settings.currency,
        couponId: priced.couponId,
        notes: orderPurposeNotes(priced.purpose) as never,
        items: {
          create: priced.items.map((item) => ({
            courseId: item.courseId,
            batchId: item.batchId,
            titleSnapshot: item.titleSnapshot,
            priceMinor: item.priceMinor,
            quantity: item.quantity,
          })),
        },
      },
      select: { id: true, number: true },
    })
  })

  let gatewayOrderId: string
  let publicKey: string | null
  try {
    const created = await gateway.createOrder({
      orderId: order.id,
      number: order.number,
      amountMinor: totals.totalMinor,
      currency: settings.currency,
      notes: { orderId: order.id, orderNumber: order.number, purpose: priced.purpose.kind },
    })
    gatewayOrderId = created.gatewayOrderId
    publicKey = created.publicKey
  } catch (error) {
    // Mark it FAILED rather than deleting: an order the gateway rejected is
    // exactly the trail worth having when a client asks why checkout was broken
    // on Tuesday.
    await db.order.update({ where: { id: order.id }, data: { status: 'FAILED' } })
    console.error('[payments] gateway order creation failed', error)
    return deny(503, 'GATEWAY_UNAVAILABLE', 'Payments are temporarily unavailable. Please try again.')
  }

  await db.order.update({
    where: { id: order.id },
    data: { status: 'PENDING', gatewayOrderId },
  })

  await recordAudit({
    actorId: userId,
    action: 'order.created',
    entityType: 'Order',
    entityId: order.id,
    meta: {
      number: order.number,
      totalMinor: totals.totalMinor,
      couponCode: priced.couponCode,
      purpose: priced.purpose.kind,
    },
  })

  return {
    ok: true,
    orderId: order.id,
    number: order.number,
    amountMinor: totals.totalMinor,
    currency: settings.currency,
    subtotalMinor: totals.subtotalMinor,
    discountMinor: totals.discountMinor,
    gatewayOrderId,
    publicKey,
    hasBrowserCheckout: gateway.hasBrowserCheckout,
    description: priced.description,
  }
}

/**
 * Prices a coupon against a course without creating anything, so the checkout
 * page can show the discount before the student commits. Re-validated at order
 * creation — this is a preview, not a decision.
 */
export async function previewCoupon(
  courseId: string,
  code: string,
): Promise<
  | { ok: true; discountMinor: number; totalMinor: number; code: string }
  | { ok: false; message: string; reason: CouponRejection | 'UNKNOWN_CODE' | 'UNKNOWN_COURSE' }
> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { id: true, status: true, priceMinor: true },
  })
  if (!course || course.status !== 'PUBLISHED' || course.priceMinor === null) {
    return { ok: false, message: 'Course not found.', reason: 'UNKNOWN_COURSE' }
  }

  const coupon = await findCouponByCode(code)
  if (!coupon) return { ok: false, message: 'That code was not recognised.', reason: 'UNKNOWN_CODE' }

  const items: PriceableItem[] = [{ courseId: course.id, priceMinor: course.priceMinor, quantity: 1 }]
  const verdict = evaluateCoupon(coupon, { items, now: new Date() })
  if (!verdict.ok) return { ok: false, message: verdict.message, reason: verdict.reason }

  const totals = computeOrderTotals(items, verdict.discountMinor)
  return {
    ok: true,
    discountMinor: totals.discountMinor,
    totalMinor: totals.totalMinor,
    code: coupon.code,
  }
}
