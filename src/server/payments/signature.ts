/**
 * Razorpay signature verification.
 *
 * Pure, dependency-free and the only thing standing between an unauthenticated
 * POST and an enrollment being credited. Nothing in a webhook body is trusted
 * until one of these returns true.
 *
 * ── WHY NOT THE SDK'S OWN HELPER ─────────────────────────────────────────────
 * `razorpay` ships `Razorpay.validateWebhookSignature`, and it is the same HMAC.
 * It compares the digests with `===`, which returns as soon as two bytes differ
 * and therefore leaks the position of the first mismatch through timing. That is
 * a narrow attack against a hex digest over a network, but the fix is one line
 * (`timingSafeEqual`), the code is 15 lines either way, and keeping it here means
 * the verification path is a pure function this repo can test — including the
 * forged and truncated cases — rather than a vendor call it has to trust.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two different secrets are in play and mixing them up fails closed but silently
 * confusing, so they are separate functions with named parameters:
 *
 *  - Webhook events are signed with the webhook secret set in the Razorpay
 *    dashboard when the endpoint is created (`RAZORPAY_WEBHOOK_SECRET`).
 *  - The `razorpay_signature` that Checkout hands back to the browser is signed
 *    with the API key secret (`RAZORPAY_KEY_SECRET`).
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Thrown when a secret is absent, so a misconfigured deployment is loud. */
export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentConfigError'
  }
}

function hmacHex(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex')
}

/**
 * Constant-time comparison of two ASCII digests.
 *
 * `timingSafeEqual` throws on a length mismatch, so the length is checked first —
 * which does leak the length of the expected digest, a fixed and public 64
 * characters for SHA-256 hex.
 */
function digestsMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Verifies the `X-Razorpay-Signature` header against the raw request body.
 *
 * `rawBody` must be the exact bytes received. Re-serialising a parsed object
 * changes key order and whitespace, and the signature will never match again —
 * which is why the route handler reads `request.text()` and nothing upstream of
 * this parses the body first.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) {
    throw new PaymentConfigError(
      'RAZORPAY_WEBHOOK_SECRET is not set. Webhook events cannot be verified.',
    )
  }
  if (!signature) return false

  return digestsMatch(hmacHex(rawBody, secret), signature)
}

export interface CheckoutCallback {
  /** Razorpay's order id (`order_...`), not our internal Order.id. */
  gatewayOrderId: string
  gatewayPaymentId: string
}

/**
 * Verifies the signature Checkout returns to the browser on a successful payment.
 *
 * The signed message is `order_id|payment_id` — the separator is Razorpay's, and
 * it is what stops a boundary-confusion forgery where ("ab","c") and ("a","bc")
 * would otherwise produce the same digest.
 *
 * This is a convenience, not the authority: it lets the student's browser get a
 * confirmed receipt immediately instead of polling. The webhook is what the
 * enrollment actually depends on, because a browser that closes before the
 * callback fires must still result in access.
 */
export function verifyCheckoutSignature(
  callback: CheckoutCallback,
  signature: string | null | undefined,
  keySecret: string | undefined,
): boolean {
  if (!keySecret) {
    throw new PaymentConfigError(
      'RAZORPAY_KEY_SECRET is not set. Checkout callbacks cannot be verified.',
    )
  }
  if (!signature) return false
  if (!callback.gatewayOrderId || !callback.gatewayPaymentId) return false

  const message = `${callback.gatewayOrderId}|${callback.gatewayPaymentId}`
  return digestsMatch(hmacHex(message, keySecret), signature)
}
