import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it } from 'node:test'

import { PaymentConfigError, verifyCheckoutSignature, verifyWebhookSignature } from './signature'

const SECRET = 'whsec_test_5f4dcc3b5aa765d61d8327deb882cf99'
const KEY_SECRET = 'rzp_secret_2b7c1e9a4d6f8031'

/**
 * Computed independently of the implementation rather than by calling it, so this
 * pins the algorithm — HMAC-SHA256 over the raw body, hex encoded — instead of
 * asserting the code agrees with itself.
 */
function sign(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex')
}

const BODY = JSON.stringify({
  entity: 'event',
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_test_1', amount: 500_000, currency: 'INR' } } },
})

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed body', () => {
    assert.equal(verifyWebhookSignature(BODY, sign(BODY, SECRET), SECRET), true)
  })

  /** The attack this endpoint exists to stop: an unsigned POST crediting a payment. */
  it('rejects a forged signature', () => {
    const forged = 'f'.repeat(64)
    assert.equal(verifyWebhookSignature(BODY, forged, SECRET), false)
  })

  it('rejects a signature made with a different secret', () => {
    assert.equal(verifyWebhookSignature(BODY, sign(BODY, 'not-the-secret'), SECRET), false)
  })

  /**
   * The realistic version of tampering: a genuine event replayed with an edited
   * amount or order id. One byte changed anywhere must invalidate the whole body.
   */
  it('rejects a body edited after signing', () => {
    const signature = sign(BODY, SECRET)
    const tampered = BODY.replace('500000', '100')
    assert.notEqual(tampered, BODY)
    assert.equal(verifyWebhookSignature(tampered, signature, SECRET), false)
  })

  it('rejects a re-serialised body, which is why the raw bytes are kept', () => {
    const signature = sign(BODY, SECRET)
    // Same object, different key order — what `JSON.stringify(await req.json())`
    // would produce.
    const reserialised = JSON.stringify({
      event: 'payment.captured',
      entity: 'event',
      payload: { payment: { entity: { id: 'pay_test_1', amount: 500_000, currency: 'INR' } } },
    })
    assert.equal(verifyWebhookSignature(reserialised, signature, SECRET), false)
  })

  it('rejects a truncated signature rather than throwing on the length mismatch', () => {
    const signature = sign(BODY, SECRET)
    assert.equal(verifyWebhookSignature(BODY, signature.slice(0, 32), SECRET), false)
    assert.equal(verifyWebhookSignature(BODY, `${signature}00`, SECRET), false)
  })

  it('rejects a missing header', () => {
    assert.equal(verifyWebhookSignature(BODY, null, SECRET), false)
    assert.equal(verifyWebhookSignature(BODY, '', SECRET), false)
  })

  it('rejects an uppercased digest, since the gateway sends lowercase hex', () => {
    assert.equal(verifyWebhookSignature(BODY, sign(BODY, SECRET).toUpperCase(), SECRET), false)
  })

  it('accepts an empty body signed correctly, rather than special-casing it', () => {
    assert.equal(verifyWebhookSignature('', sign('', SECRET), SECRET), true)
  })

  /** A deployment with no secret must be loud, not permissive and not silently dead. */
  it('throws when the secret is not configured', () => {
    assert.throws(() => verifyWebhookSignature(BODY, sign(BODY, SECRET), undefined), PaymentConfigError)
    assert.throws(() => verifyWebhookSignature(BODY, sign(BODY, SECRET), ''), PaymentConfigError)
  })
})

describe('verifyCheckoutSignature', () => {
  const callback = { gatewayOrderId: 'order_QaBcDeFgH', gatewayPaymentId: 'pay_QaBcDeFgH' }
  const message = `${callback.gatewayOrderId}|${callback.gatewayPaymentId}`

  it('accepts the signature the widget returns', () => {
    assert.equal(verifyCheckoutSignature(callback, sign(message, KEY_SECRET), KEY_SECRET), true)
  })

  it('rejects a signature for a different order', () => {
    const other = sign(`order_other|${callback.gatewayPaymentId}`, KEY_SECRET)
    assert.equal(verifyCheckoutSignature(callback, other, KEY_SECRET), false)
  })

  it('rejects a signature for a different payment', () => {
    const other = sign(`${callback.gatewayOrderId}|pay_other`, KEY_SECRET)
    assert.equal(verifyCheckoutSignature(callback, other, KEY_SECRET), false)
  })

  /**
   * Without the separator, ("ab","c") and ("a","bc") hash identically — a forger
   * with one valid pair could move the boundary and claim another.
   */
  it('is not fooled by moving the boundary between the two ids', () => {
    const shifted = sign(`${callback.gatewayOrderId}|${callback.gatewayPaymentId}`, KEY_SECRET)
    const confusable = {
      gatewayOrderId: `${callback.gatewayOrderId}|${callback.gatewayPaymentId}`,
      gatewayPaymentId: '',
    }
    assert.equal(verifyCheckoutSignature(confusable, shifted, KEY_SECRET), false)
  })

  it('rejects an empty id pair outright', () => {
    assert.equal(
      verifyCheckoutSignature({ gatewayOrderId: '', gatewayPaymentId: '' }, sign('|', KEY_SECRET), KEY_SECRET),
      false,
    )
  })

  it('rejects a webhook-secret signature, so the two secrets cannot be crossed', () => {
    assert.equal(verifyCheckoutSignature(callback, sign(message, SECRET), KEY_SECRET), false)
  })

  it('throws when the key secret is not configured', () => {
    assert.throws(
      () => verifyCheckoutSignature(callback, sign(message, KEY_SECRET), undefined),
      PaymentConfigError,
    )
  })
})
