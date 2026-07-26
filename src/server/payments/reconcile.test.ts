import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  STALE_PENDING_MS,
  type ReconcilableOrder,
  applyRefund,
  classifyOrder,
} from './reconcile'

const NOW = new Date('2026-07-26T12:00:00Z')

function order(overrides: Partial<ReconcilableOrder> = {}): ReconcilableOrder {
  return {
    status: 'PAID',
    totalMinor: 500_000,
    createdAt: new Date('2026-07-26T11:00:00Z'),
    gatewayOrderId: 'order_test_1',
    payments: [{ status: 'CAPTURED', amountMinor: 500_000, refundedMinor: 0 }],
    ...overrides,
  }
}

describe('classifyOrder', () => {
  it('flags nothing on a healthy paid order', () => {
    assert.deepEqual(classifyOrder(order(), NOW).flags, [])
  })

  /** The expensive one: a student has paid and has no access. */
  it('flags money captured against an order that was never credited', () => {
    const result = classifyOrder(order({ status: 'PENDING' }), NOW)
    assert.ok(result.flags.includes('CAPTURED_NOT_CREDITED'))
    assert.equal(result.capturedMinor, 500_000)
  })

  it('flags an order marked paid with nothing captured', () => {
    const result = classifyOrder(order({ payments: [] }), NOW)
    assert.deepEqual(result.flags, ['CREDITED_WITHOUT_CAPTURE'])
  })

  it('flags a captured amount that is not the order total', () => {
    const result = classifyOrder(
      order({ payments: [{ status: 'CAPTURED', amountMinor: 100, refundedMinor: 0 }] }),
      NOW,
    )
    assert.ok(result.flags.includes('AMOUNT_MISMATCH'))
  })

  it('ignores failed attempts when totalling captures', () => {
    const result = classifyOrder(
      order({
        payments: [
          { status: 'FAILED', amountMinor: 500_000, refundedMinor: 0 },
          { status: 'CAPTURED', amountMinor: 500_000, refundedMinor: 0 },
        ],
      }),
      NOW,
    )
    assert.deepEqual(result.flags, [])
    assert.equal(result.capturedMinor, 500_000)
  })

  it('flags refunds exceeding the capture', () => {
    const result = classifyOrder(
      order({
        status: 'REFUNDED',
        payments: [{ status: 'CAPTURED', amountMinor: 500_000, refundedMinor: 600_000 }],
      }),
      NOW,
    )
    assert.ok(result.flags.includes('OVER_REFUNDED'))
  })

  it('flags a refund the order status has not caught up with', () => {
    const result = classifyOrder(
      order({
        status: 'PAID',
        payments: [{ status: 'CAPTURED', amountMinor: 500_000, refundedMinor: 100_000 }],
      }),
      NOW,
    )
    assert.ok(result.flags.includes('REFUND_NOT_REFLECTED'))
  })

  it('flags an order that reached the gateway a day ago and never resolved', () => {
    const result = classifyOrder(
      order({
        status: 'PENDING',
        payments: [],
        createdAt: new Date(NOW.getTime() - STALE_PENDING_MS - 1000),
      }),
      NOW,
    )
    assert.deepEqual(result.flags, ['STALE_PENDING'])
  })

  it('does not flag a recent pending order', () => {
    const result = classifyOrder(order({ status: 'PENDING', payments: [] }), NOW)
    assert.deepEqual(result.flags, [])
  })

  /** A cancelled or failed order is a resolved outcome, not an anomaly. */
  it('does not flag an old cancelled order', () => {
    const result = classifyOrder(
      order({
        status: 'CANCELLED',
        payments: [],
        createdAt: new Date(NOW.getTime() - 30 * STALE_PENDING_MS),
      }),
      NOW,
    )
    assert.deepEqual(result.flags, [])
  })

  it('does not flag an order that never reached the gateway', () => {
    const result = classifyOrder(
      order({
        status: 'CREATED',
        payments: [],
        gatewayOrderId: null,
        createdAt: new Date(NOW.getTime() - 30 * STALE_PENDING_MS),
      }),
      NOW,
    )
    assert.deepEqual(result.flags, [])
  })
})

describe('applyRefund', () => {
  const base = {
    capturedMinor: 500_000,
    alreadyRefundedMinor: 0,
    orderCapturedMinor: 500_000,
    otherRefundedMinor: 0,
  }

  it('marks a full refund REFUNDED', () => {
    const result = applyRefund({ ...base, requestedMinor: 500_000 })
    assert.equal(result.ok, true)
    assert.equal(result.orderStatus, 'REFUNDED')
    assert.equal(result.refundedMinor, 500_000)
  })

  it('marks a partial refund PARTIALLY_REFUNDED', () => {
    const result = applyRefund({ ...base, requestedMinor: 200_000 })
    assert.equal(result.orderStatus, 'PARTIALLY_REFUNDED')
  })

  it('accumulates across successive partial refunds', () => {
    const first = applyRefund({ ...base, requestedMinor: 200_000 })
    const second = applyRefund({
      ...base,
      alreadyRefundedMinor: first.refundedMinor,
      requestedMinor: 300_000,
    })
    assert.equal(second.refundedMinor, 500_000)
    assert.equal(second.orderStatus, 'REFUNDED')
  })

  it('refuses to refund more than was captured', () => {
    const result = applyRefund({ ...base, requestedMinor: 500_001 })
    assert.equal(result.ok, false)
    assert.equal(result.refundedMinor, 0, 'a rejected refund must not move the total')
  })

  it('refuses a zero, negative or fractional amount', () => {
    for (const requestedMinor of [0, -1, 100.5]) {
      assert.equal(applyRefund({ ...base, requestedMinor }).ok, false, String(requestedMinor))
    }
  })

  it('considers refunds on sibling payments when deciding the order status', () => {
    // Two ₹2,500 payments; ₹2,500 already refunded on the other one.
    const result = applyRefund({
      capturedMinor: 250_000,
      alreadyRefundedMinor: 0,
      requestedMinor: 250_000,
      orderCapturedMinor: 500_000,
      otherRefundedMinor: 250_000,
    })
    assert.equal(result.orderStatus, 'REFUNDED')
  })
})
