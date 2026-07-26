/**
 * Order settlement.
 *
 * The single point where a payment becomes access. Three paths reach it — the
 * Razorpay webhook, the browser's checkout callback, and an operator marking an
 * order paid by hand — and all three can arrive for the same money, in any order,
 * more than once.
 *
 * ── HOW DOUBLE-CREDITING IS PREVENTED ────────────────────────────────────────
 * Idempotency is layered, because any single layer has a failure mode:
 *
 *   1. `WebhookEvent(gateway, eventId)` unique — stops the same delivery being
 *      *worked on* twice. Insufficient on its own: a webhook and a checkout
 *      callback describe the same payment with different keys, and a retry after
 *      a crashed handler must be allowed through (see ./webhook.ts).
 *   2. `Payment.gatewayPaymentId` unique — one row per payment however many
 *      messages describe it. An upsert, so a retry updates rather than collides.
 *   3. A compare-and-set on `Order.status` — the transition to PAID happens at
 *      most once, and every effect that is *not* naturally idempotent (counting a
 *      coupon redemption) is gated on winning it.
 *
 * Everything else downstream is idempotent by construction: `enrollUser` dedupes
 * on (user, course, batch), `issueInvoice` on order id, and installment
 * settlement is a conditional update. So even a double delivery that beats every
 * guard produces the same rows.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { recordAudit } from '@/server/audit'
import { db } from '@/server/db'
import { enrollUser } from '@/server/enrollments/enroll'
import { redeemCoupon } from './coupons'
import { issueInvoice } from './invoices'
import { applyRefund } from './reconcile'
import type { OrderStatus, PaymentGateway } from '@/generated/prisma/enums'

/** What an order is for. Stored on `Order.notes`, read back through here. */
export type OrderPurpose =
  | { kind: 'COURSE' }
  | { kind: 'INSTALLMENT'; installmentId: string }

export function orderPurposeNotes(purpose: OrderPurpose): Record<string, string> {
  return purpose.kind === 'INSTALLMENT'
    ? { purpose: 'INSTALLMENT', installmentId: purpose.installmentId }
    : { purpose: 'COURSE' }
}

/** Untyped JSON in, typed purpose out. Unknown shapes read as a course purchase. */
export function readOrderPurpose(notes: unknown): OrderPurpose {
  if (typeof notes !== 'object' || notes === null) return { kind: 'COURSE' }

  const record = notes as Record<string, unknown>
  if (record.purpose === 'INSTALLMENT' && typeof record.installmentId === 'string') {
    return { kind: 'INSTALLMENT', installmentId: record.installmentId }
  }
  return { kind: 'COURSE' }
}

export interface SettleInput {
  /** Razorpay's order id. Null for a manual settlement. */
  gatewayOrderId?: string | null
  /** Our own Order.id, when the caller already knows it. */
  orderId?: string | null
  gatewayPaymentId: string
  gateway: PaymentGateway
  amountMinor: number
  currency: string
  method: string | null
  capturedAt: Date
  /** Full gateway response, kept verbatim for reconciliation. */
  raw?: unknown
  /** Set for a manual settlement so the audit trail names the operator. */
  actorId?: string | null
}

export type SettleOutcome =
  | {
      ok: true
      orderId: string
      /** False when this call is the one that transitioned the order to PAID. */
      alreadySettled: boolean
      invoiceNumber: string | null
      enrollmentIds: string[]
    }
  | { ok: false; reason: 'ORDER_NOT_FOUND' | 'AMOUNT_MISMATCH'; orderId?: string }

async function findOrderForSettlement(input: SettleInput) {
  const where = input.orderId
    ? { id: input.orderId }
    : input.gatewayOrderId
      ? { gatewayOrderId: input.gatewayOrderId }
      : null
  if (!where) return null

  // findFirst rather than findUnique: gatewayOrderId is indexed but not unique in
  // the schema, so it cannot be a unique lookup argument.
  return db.order.findFirst({
    where,
    select: {
      id: true,
      userId: true,
      status: true,
      totalMinor: true,
      currency: true,
      couponId: true,
      notes: true,
      items: { select: { courseId: true, batchId: true } },
    },
  })
}

export async function settleOrderPayment(input: SettleInput): Promise<SettleOutcome> {
  const order = await findOrderForSettlement(input)
  if (!order) return { ok: false, reason: 'ORDER_NOT_FOUND' }

  const capturedAt = input.capturedAt

  // Layer 2. The upsert means a retry refreshes the row instead of colliding, and
  // an out-of-order `payment.failed` cannot downgrade a captured payment because
  // this path only ever writes CAPTURED.
  await db.payment.upsert({
    where: { gatewayPaymentId: input.gatewayPaymentId },
    create: {
      orderId: order.id,
      gateway: input.gateway,
      gatewayPaymentId: input.gatewayPaymentId,
      status: 'CAPTURED',
      amountMinor: input.amountMinor,
      currency: input.currency,
      method: input.method,
      capturedAt,
      raw: (input.raw ?? {}) as never,
    },
    update: {
      status: 'CAPTURED',
      capturedAt,
      method: input.method,
      raw: (input.raw ?? {}) as never,
    },
  })

  /**
   * A captured amount that is not the amount we priced means something is wrong
   * upstream — a tampered client, a gateway partial payment we did not ask for,
   * or a currency exponent mismatch. The payment row is kept (the money is real
   * and reconciliation needs to see it) but the order is deliberately NOT
   * credited, so it surfaces in /admin/payments/reconciliation instead of
   * silently granting access for the wrong price.
   */
  if (input.amountMinor !== order.totalMinor || input.currency !== order.currency) {
    await recordAudit({
      actorId: input.actorId ?? order.userId,
      action: 'payment.amount_mismatch',
      entityType: 'Order',
      entityId: order.id,
      meta: {
        expectedMinor: order.totalMinor,
        receivedMinor: input.amountMinor,
        expectedCurrency: order.currency,
        receivedCurrency: input.currency,
        gatewayPaymentId: input.gatewayPaymentId,
      },
    })
    return { ok: false, reason: 'AMOUNT_MISMATCH', orderId: order.id }
  }

  // Layer 3. The compare-and-set: exactly one caller sees count === 1.
  const transition = await db.order.updateMany({
    where: { id: order.id, status: { not: 'PAID' } },
    data: {
      status: 'PAID',
      paidAt: capturedAt,
      gatewayPaymentId: input.gatewayPaymentId,
      ...(input.gatewayOrderId ? { gatewayOrderId: input.gatewayOrderId } : {}),
    },
  })
  const firstSettlement = transition.count === 1

  // Gated on the transition because incrementing a counter twice is the one
  // downstream effect that a replay would visibly corrupt.
  if (firstSettlement && order.couponId) {
    await redeemCoupon(order.couponId, order.id)
  }

  const purpose = readOrderPurpose(order.notes)
  const enrollmentIds: string[] = []

  if (purpose.kind === 'INSTALLMENT') {
    // Access already exists — the schedule hangs off an enrollment. Conditional
    // so a replay cannot overwrite the original paidAt.
    await db.feeInstallment.updateMany({
      where: { id: purpose.installmentId, status: { in: ['PENDING', 'OVERDUE'] } },
      data: { status: 'PAID', paidAt: capturedAt, orderId: order.id },
    })
  } else {
    for (const item of order.items) {
      if (!item.courseId) continue
      const result = await enrollUser({
        userId: order.userId,
        courseId: item.courseId,
        batchId: item.batchId,
        source: 'PURCHASE',
        actorId: input.actorId ?? order.userId,
      })
      enrollmentIds.push(result.enrollmentId)
    }
  }

  /**
   * Non-fatal by design. The money has moved and access is granted by this point;
   * failing the whole settlement over a document would trade a missing invoice for
   * a missing enrollment. An order without an invoice is visible in admin and can
   * be reissued.
   */
  let invoiceNumber: string | null = null
  try {
    invoiceNumber = (await issueInvoice(order.id)).number
  } catch (error) {
    console.error('[payments] invoice issuance failed for order', order.id, error)
  }

  if (firstSettlement) {
    await recordAudit({
      actorId: input.actorId ?? order.userId,
      action: 'order.paid',
      entityType: 'Order',
      entityId: order.id,
      meta: {
        gatewayPaymentId: input.gatewayPaymentId,
        amountMinor: input.amountMinor,
        purpose: purpose.kind,
        invoiceNumber,
      },
    })
  }

  return {
    ok: true,
    orderId: order.id,
    alreadySettled: !firstSettlement,
    invoiceNumber,
    enrollmentIds,
  }
}

/**
 * Records a failed attempt. The order is left FAILED rather than deleted: a
 * student who tried three times and succeeded on the fourth should be visible as
 * exactly that when they call support about a card being declined.
 */
export async function recordFailedPayment(input: {
  gatewayOrderId: string | null
  gatewayPaymentId: string
  gateway: PaymentGateway
  amountMinor: number
  currency: string
  method: string | null
  reason: string | null
  raw?: unknown
}): Promise<{ ok: boolean }> {
  if (!input.gatewayOrderId) return { ok: false }

  const order = await db.order.findFirst({
    where: { gatewayOrderId: input.gatewayOrderId },
    select: { id: true, status: true },
  })
  if (!order) return { ok: false }

  await db.payment.upsert({
    where: { gatewayPaymentId: input.gatewayPaymentId },
    create: {
      orderId: order.id,
      gateway: input.gateway,
      gatewayPaymentId: input.gatewayPaymentId,
      status: 'FAILED',
      amountMinor: input.amountMinor,
      currency: input.currency,
      method: input.method,
      raw: (input.raw ?? {}) as never,
    },
    // Never downgrade a captured payment: Razorpay can deliver a failed attempt
    // after a successful retry on the same order, and losing the capture would
    // strip a paying student of access.
    update: {},
  })

  await db.order.updateMany({
    where: { id: order.id, status: { in: ['CREATED', 'PENDING'] } },
    data: { status: 'FAILED' },
  })

  await recordAudit({
    action: 'payment.failed',
    entityType: 'Order',
    entityId: order.id,
    meta: { gatewayPaymentId: input.gatewayPaymentId, reason: input.reason },
  })

  return { ok: true }
}

export interface RecordRefundInput {
  paymentId: string
  amountMinor: number
  reason?: string | null
  /** Gateway refund id, when the refund was initiated there. */
  gatewayRefundId?: string | null
  actorId: string
  /**
   * Whether to cancel the enrollments this order paid for.
   *
   * An explicit choice rather than a rule. Auto-revoking on any refund would cut
   * off a student over a partial goodwill credit; never revoking leaves a fully
   * refunded student with permanent access. Neither default is right for both
   * cases, so the operator making the refund decides.
   */
  cancelEnrollments: boolean
}

export type RefundResult =
  | { ok: true; orderStatus: OrderStatus; refundedMinor: number; cancelledEnrollments: number }
  | { ok: false; error: string }

export async function recordRefund(input: RecordRefundInput): Promise<RefundResult> {
  const payment = await db.payment.findUnique({
    where: { id: input.paymentId },
    select: {
      id: true,
      orderId: true,
      status: true,
      amountMinor: true,
      refundedMinor: true,
      order: {
        select: {
          id: true,
          userId: true,
          payments: { select: { id: true, status: true, amountMinor: true, refundedMinor: true } },
          items: { select: { courseId: true, batchId: true } },
        },
      },
    },
  })

  if (!payment) return { ok: false, error: 'Payment not found.' }
  if (payment.status !== 'CAPTURED' && payment.refundedMinor === 0) {
    return { ok: false, error: 'Only a captured payment can be refunded.' }
  }

  const siblings = payment.order.payments.filter((row) => row.id !== payment.id)
  const outcome = applyRefund({
    capturedMinor: payment.amountMinor,
    alreadyRefundedMinor: payment.refundedMinor,
    requestedMinor: input.amountMinor,
    orderCapturedMinor: payment.order.payments
      .filter((row) => row.status === 'CAPTURED')
      .reduce((sum, row) => sum + row.amountMinor, 0),
    otherRefundedMinor: siblings.reduce((sum, row) => sum + row.refundedMinor, 0),
  })

  if (!outcome.ok) return { ok: false, error: outcome.error ?? 'Refund rejected.' }

  await db.payment.update({
    where: { id: payment.id },
    data: {
      refundedMinor: outcome.refundedMinor,
      status: outcome.refundedMinor >= payment.amountMinor ? 'REFUNDED' : payment.status,
    },
  })

  await db.order.update({
    where: { id: payment.orderId },
    data: { status: outcome.orderStatus },
  })

  let cancelledEnrollments = 0
  if (input.cancelEnrollments) {
    const courseIds = payment.order.items
      .map((item) => item.courseId)
      .filter((courseId): courseId is string => courseId !== null)

    if (courseIds.length > 0) {
      const cancelled = await db.enrollment.updateMany({
        where: {
          userId: payment.order.userId,
          courseId: { in: courseIds },
          status: { in: ['ACTIVE', 'PENDING', 'PAUSED'] },
        },
        data: { status: 'CANCELLED' },
      })
      cancelledEnrollments = cancelled.count
    }
  }

  await recordAudit({
    actorId: input.actorId,
    action: 'payment.refunded',
    entityType: 'Order',
    entityId: payment.orderId,
    meta: {
      paymentId: payment.id,
      amountMinor: input.amountMinor,
      totalRefundedMinor: outcome.refundedMinor,
      gatewayRefundId: input.gatewayRefundId ?? null,
      reason: input.reason ?? null,
      cancelledEnrollments,
    },
  })

  return {
    ok: true,
    orderStatus: outcome.orderStatus,
    refundedMinor: outcome.refundedMinor,
    cancelledEnrollments,
  }
}

/**
 * Applies a refund the gateway reports, which may already include earlier partial
 * refunds. `refundedMinor` is therefore the cumulative total, not a delta, and the
 * write is a set rather than an increment — that is what makes a redelivered
 * `refund.processed` a no-op.
 */
export async function syncGatewayRefund(input: {
  gatewayPaymentId: string
  refundedMinor: number
  gatewayRefundId: string
}): Promise<{ ok: boolean }> {
  const payment = await db.payment.findUnique({
    where: { gatewayPaymentId: input.gatewayPaymentId },
    select: { id: true, orderId: true, amountMinor: true, refundedMinor: true },
  })
  if (!payment) return { ok: false }

  // Never walk a refund backwards: events can arrive out of order and the higher
  // cumulative figure is the later truth.
  const refundedMinor = Math.max(payment.refundedMinor, Math.min(input.refundedMinor, payment.amountMinor))

  await db.payment.update({
    where: { id: payment.id },
    data: {
      refundedMinor,
      status: refundedMinor >= payment.amountMinor ? 'REFUNDED' : undefined,
    },
  })

  await db.order.update({
    where: { id: payment.orderId },
    data: { status: refundedMinor >= payment.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
  })

  await recordAudit({
    action: 'payment.refund_synced',
    entityType: 'Order',
    entityId: payment.orderId,
    meta: { gatewayRefundId: input.gatewayRefundId, refundedMinor },
  })

  return { ok: true }
}
