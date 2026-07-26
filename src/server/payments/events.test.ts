import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { interpretRazorpayEvent, parseRazorpayEvent, razorpayEventKey } from './events'

function captureBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    entity: 'event',
    account_id: 'acc_test',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: 'pay_test_1',
          entity: 'payment',
          amount: 500_000,
          currency: 'INR',
          status: 'captured',
          order_id: 'order_test_1',
          method: 'upi',
          captured: true,
          created_at: 1_774_526_400,
          ...overrides,
        },
      },
    },
    created_at: 1_774_526_400,
  })
}

describe('parseRazorpayEvent', () => {
  it('reads the envelope', () => {
    const parsed = parseRazorpayEvent(captureBody())
    assert.equal(parsed?.type, 'payment.captured')
    assert.ok(parsed?.payload.payment)
  })

  it('returns null for a body that is not JSON', () => {
    assert.equal(parseRazorpayEvent('<html>502 Bad Gateway</html>'), null)
  })

  it('returns null for JSON that is not an event envelope', () => {
    assert.equal(parseRazorpayEvent('[1,2,3]'), null)
    assert.equal(parseRazorpayEvent('{"hello":"world"}'), null)
  })

  it('tolerates a missing payload rather than throwing', () => {
    const parsed = parseRazorpayEvent('{"event":"payment.captured"}')
    assert.deepEqual(parsed, { type: 'payment.captured', payload: {} })
  })
})

describe('razorpayEventKey', () => {
  const parsed = parseRazorpayEvent(captureBody())!

  it('prefers the gateway event id header', () => {
    assert.equal(razorpayEventKey('evt_abc123', parsed), 'evt_abc123')
  })

  /**
   * The fallback has to be deterministic or the replay protection evaporates: a
   * random key would insert cleanly every time and credit the same payment twice.
   */
  it('derives a stable key when the header is absent', () => {
    assert.equal(razorpayEventKey(null, parsed), 'payment.captured:pay_test_1')
    assert.equal(razorpayEventKey(null, parsed), razorpayEventKey(undefined, parsed))
  })

  it('keys a refund on the refund, not the payment it reverses', () => {
    const refund = parseRazorpayEvent(
      JSON.stringify({
        event: 'refund.processed',
        payload: {
          refund: { entity: { id: 'rfnd_1', payment_id: 'pay_test_1', amount: 100 } },
          payment: { entity: { id: 'pay_test_1', amount_refunded: 100 } },
        },
      }),
    )!
    assert.equal(razorpayEventKey(null, refund), 'refund.processed:rfnd_1')
  })
})

describe('interpretRazorpayEvent', () => {
  it('reads a captured payment without rescaling the amount', () => {
    const intent = interpretRazorpayEvent(parseRazorpayEvent(captureBody())!)
    assert.equal(intent.kind, 'PAYMENT_CAPTURED')
    if (intent.kind !== 'PAYMENT_CAPTURED') return

    // 500000 paise is ₹5,000.00 and stays 500000. Multiplying here is the classic
    // hundred-fold overcharge.
    assert.equal(intent.amountMinor, 500_000)
    assert.equal(intent.currency, 'INR')
    assert.equal(intent.gatewayOrderId, 'order_test_1')
    assert.equal(intent.gatewayPaymentId, 'pay_test_1')
    assert.equal(intent.method, 'upi')
    // created_at is unix seconds, so it is multiplied by 1000 and nothing else.
    assert.equal(intent.capturedAt.toISOString(), '2026-03-26T12:00:00.000Z')
  })

  it('falls back to now for a missing timestamp rather than dropping the payment', () => {
    const body = captureBody({ created_at: undefined })
    const intent = interpretRazorpayEvent(parseRazorpayEvent(body)!)
    assert.equal(intent.kind, 'PAYMENT_CAPTURED')
    assert.ok(intent.kind === 'PAYMENT_CAPTURED' && intent.capturedAt.getTime() > 0)
  })

  it('settles order.paid through the same path', () => {
    const body = captureBody().replace('"payment.captured"', '"order.paid"')
    const intent = interpretRazorpayEvent(parseRazorpayEvent(body)!)
    assert.equal(intent.kind, 'PAYMENT_CAPTURED')
  })

  it('ignores order.paid with no payment entity', () => {
    const intent = interpretRazorpayEvent(
      parseRazorpayEvent('{"event":"order.paid","payload":{"order":{"entity":{"id":"order_1"}}}}')!,
    )
    assert.equal(intent.kind, 'IGNORED')
  })

  it('reads a failed payment with its reason', () => {
    const body = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_fail_1',
            amount: 500_000,
            currency: 'INR',
            order_id: 'order_test_1',
            method: 'card',
            error_description: 'Card declined by the issuing bank',
          },
        },
      },
    })
    const intent = interpretRazorpayEvent(parseRazorpayEvent(body)!)
    assert.equal(intent.kind, 'PAYMENT_FAILED')
    assert.equal(
      intent.kind === 'PAYMENT_FAILED' && intent.reason,
      'Card declined by the issuing bank',
    )
  })

  /**
   * Two partial refunds against one payment: each event's own `amount` is the
   * delta, so trusting it would flip the order to REFUNDED after the first.
   */
  it('prefers the payment\'s cumulative amount_refunded over the refund\'s own amount', () => {
    const body = JSON.stringify({
      event: 'refund.processed',
      payload: {
        refund: { entity: { id: 'rfnd_2', payment_id: 'pay_test_1', amount: 200_000, currency: 'INR' } },
        payment: { entity: { id: 'pay_test_1', amount: 500_000, amount_refunded: 400_000 } },
      },
    })
    const intent = interpretRazorpayEvent(parseRazorpayEvent(body)!)
    assert.equal(intent.kind, 'REFUND_PROCESSED')
    assert.equal(intent.kind === 'REFUND_PROCESSED' && intent.refundedMinor, 400_000)
  })

  it('falls back to the refund amount when the payment entity is absent', () => {
    const body = JSON.stringify({
      event: 'refund.processed',
      payload: { refund: { entity: { id: 'rfnd_3', payment_id: 'pay_test_1', amount: 150_000 } } },
    })
    const intent = interpretRazorpayEvent(parseRazorpayEvent(body)!)
    assert.equal(intent.kind === 'REFUND_PROCESSED' && intent.refundedMinor, 150_000)
  })

  it('ignores event types this deployment does not act on', () => {
    const intent = interpretRazorpayEvent({ type: 'subscription.charged', payload: {} })
    assert.equal(intent.kind, 'IGNORED')
    assert.equal(intent.kind === 'IGNORED' && intent.type, 'subscription.charged')
  })

  it('reports a malformed capture instead of crediting it', () => {
    const intent = interpretRazorpayEvent(
      parseRazorpayEvent('{"event":"payment.captured","payload":{"payment":{"entity":{}}}}')!,
    )
    assert.equal(intent.kind, 'MALFORMED')
  })

  it('rejects a fractional or negative amount, which cannot be minor units', () => {
    for (const amount of [500.5, -500, Number.MAX_SAFE_INTEGER + 2]) {
      const intent = interpretRazorpayEvent(parseRazorpayEvent(captureBody({ amount }))!)
      assert.equal(intent.kind, 'MALFORMED', `amount ${amount} should not be accepted`)
    }
  })

  it('rejects a string amount, so "500000" is never coerced', () => {
    const intent = interpretRazorpayEvent(parseRazorpayEvent(captureBody({ amount: '500000' }))!)
    assert.equal(intent.kind, 'MALFORMED')
  })

  it('tolerates a capture with no order id, leaving the caller to fail the lookup', () => {
    const intent = interpretRazorpayEvent(parseRazorpayEvent(captureBody({ order_id: null }))!)
    assert.equal(intent.kind, 'PAYMENT_CAPTURED')
    assert.equal(intent.kind === 'PAYMENT_CAPTURED' && intent.gatewayOrderId, null)
  })
})
