/**
 * Payment reconciliation.
 *
 * Pure classification of one order against its own payment rows. Deliberately a
 * *local* consistency check rather than a gateway fetch: the questions an
 * operator actually asks at month end — "did anything get paid without being
 * credited", "is anything marked paid that nobody paid for" — are answerable from
 * our own tables, and they stay answerable when the gateway is down, when
 * credentials are missing, and for the manual orders that never had a gateway.
 *
 * Every flag here is a state that should be impossible. They exist because
 * "impossible" states in payment systems are the ones that cost money, and
 * finding out from a student is the expensive way to find out.
 */

import type { OrderStatus, PaymentStatus } from '@/generated/prisma/enums'

export interface ReconcilablePayment {
  status: PaymentStatus
  amountMinor: number
  refundedMinor: number
}

export interface ReconcilableOrder {
  status: OrderStatus
  totalMinor: number
  createdAt: Date
  /** Set once a gateway order was successfully created for this order. */
  gatewayOrderId: string | null
  payments: readonly ReconcilablePayment[]
}

export type ReconciliationFlag =
  /** Money captured, order not marked paid — a student has paid and has no access. */
  | 'CAPTURED_NOT_CREDITED'
  /** Order marked paid with nothing captured against it. */
  | 'CREDITED_WITHOUT_CAPTURE'
  /** Captured total does not equal the order total. */
  | 'AMOUNT_MISMATCH'
  /** Refunds exceed what was captured. */
  | 'OVER_REFUNDED'
  /** Refund recorded but the order still reads as fully paid. */
  | 'REFUND_NOT_REFLECTED'
  /** Handed to the gateway long ago and never resolved either way. */
  | 'STALE_PENDING'

export interface ReconciliationResult {
  flags: ReconciliationFlag[]
  capturedMinor: number
  refundedMinor: number
}

/** An order that reached the gateway and then went quiet for this long is stuck. */
export const STALE_PENDING_MS = 24 * 60 * 60 * 1000

const SETTLED: readonly OrderStatus[] = ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED']

export function classifyOrder(order: ReconcilableOrder, now: Date): ReconciliationResult {
  const captured = order.payments.filter((payment) => payment.status === 'CAPTURED')
  const capturedMinor = captured.reduce((sum, payment) => sum + payment.amountMinor, 0)
  // Refunds are counted across every payment, not only captured ones: a payment
  // reversed to REFUNDED still has money that left our account.
  const refundedMinor = order.payments.reduce((sum, payment) => sum + payment.refundedMinor, 0)

  const flags: ReconciliationFlag[] = []
  const settled = SETTLED.includes(order.status)

  if (capturedMinor > 0 && !settled) {
    flags.push('CAPTURED_NOT_CREDITED')
  }

  if (settled && capturedMinor === 0) {
    flags.push('CREDITED_WITHOUT_CAPTURE')
  }

  // Only meaningful once something was captured; a half-paid order is already
  // covered by CAPTURED_NOT_CREDITED and does not need a second flag.
  if (capturedMinor > 0 && capturedMinor !== order.totalMinor) {
    flags.push('AMOUNT_MISMATCH')
  }

  if (refundedMinor > capturedMinor) {
    flags.push('OVER_REFUNDED')
  }

  if (refundedMinor > 0 && order.status === 'PAID') {
    flags.push('REFUND_NOT_REFLECTED')
  }

  if (
    !settled &&
    order.status !== 'CANCELLED' &&
    order.status !== 'FAILED' &&
    order.gatewayOrderId !== null &&
    capturedMinor === 0 &&
    now.getTime() - order.createdAt.getTime() > STALE_PENDING_MS
  ) {
    flags.push('STALE_PENDING')
  }

  return { flags, capturedMinor, refundedMinor }
}

export const FLAG_DESCRIPTIONS: Record<ReconciliationFlag, string> = {
  CAPTURED_NOT_CREDITED: 'Payment captured but the order is not marked paid — access may be missing.',
  CREDITED_WITHOUT_CAPTURE: 'Order is marked paid with no captured payment recorded.',
  AMOUNT_MISMATCH: 'Captured amount does not match the order total.',
  OVER_REFUNDED: 'Recorded refunds exceed the captured amount.',
  REFUND_NOT_REFLECTED: 'A refund is recorded but the order still reads as fully paid.',
  STALE_PENDING: 'Sent to the gateway over a day ago and never resolved.',
}

/**
 * Refund arithmetic, kept next to the classifier so the two agree on what
 * "fully refunded" means.
 *
 * Refunds are recorded against a single payment because that is how a gateway
 * reverses them; the order status is then derived from the whole order.
 */
export interface RefundOutcome {
  ok: boolean
  /** New cumulative refunded amount for the payment. */
  refundedMinor: number
  /** Status the order should carry afterwards. */
  orderStatus: OrderStatus
  error?: string
}

export function applyRefund(input: {
  capturedMinor: number
  alreadyRefundedMinor: number
  requestedMinor: number
  /** Captured total across the whole order, for the status decision. */
  orderCapturedMinor: number
  /** Refunded total across the whole order, excluding this payment. */
  otherRefundedMinor: number
}): RefundOutcome {
  if (!Number.isSafeInteger(input.requestedMinor) || input.requestedMinor <= 0) {
    return {
      ok: false,
      refundedMinor: input.alreadyRefundedMinor,
      orderStatus: 'PAID',
      error: 'Refund amount must be a positive whole number.',
    }
  }

  const refundedMinor = input.alreadyRefundedMinor + input.requestedMinor
  if (refundedMinor > input.capturedMinor) {
    return {
      ok: false,
      refundedMinor: input.alreadyRefundedMinor,
      orderStatus: 'PAID',
      error: 'Refund would exceed the amount captured on this payment.',
    }
  }

  const orderRefunded = input.otherRefundedMinor + refundedMinor
  return {
    ok: true,
    refundedMinor,
    orderStatus: orderRefunded >= input.orderCapturedMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
  }
}
