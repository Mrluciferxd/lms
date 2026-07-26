/**
 * Razorpay adapter.
 *
 * ── AN HONEST CAVEAT ─────────────────────────────────────────────────────────
 * This is written against Razorpay's documented API and the shipped SDK types,
 * but it has NOT been exercised against a live merchant account, because this
 * project has none yet — `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` /
 * `RAZORPAY_WEBHOOK_SECRET` are client-provisioned (see docs/04-white-label.md).
 *
 * What that means in practice, per surface:
 *
 *  - Order creation: unverified. It fails loudly and closed — a rejected request
 *    surfaces as a 503 at checkout, not as a silent free enrollment.
 *  - Signature verification: the algorithm is HMAC-SHA256 over the raw body, hex
 *    encoded, and ../payments/signature.test.ts pins it against digests computed
 *    independently. This one I am confident in.
 *  - Amounts: Razorpay speaks minor units, same as our schema, so nothing is
 *    scaled. This is the single highest-consequence assumption in the file and
 *    is the first thing to confirm in the sandbox.
 *
 * First integration step: run one sandbox order end to end and confirm the
 * amount, the receipt field and one live webhook signature.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Razorpay from 'razorpay'

import {
  PaymentGatewayError,
  registerGateway,
  type GatewayOrder,
  type GatewayOrderInput,
  type PaymentGatewayAdapter,
} from './gateway'
import { verifyCheckoutSignature, verifyWebhookSignature } from './signature'

/**
 * The fields we read off a created order.
 *
 * Declared structurally rather than imported from the SDK because
 * `orders.create` is overloaded with a callback form, and TypeScript resolves
 * `ReturnType` to the `void` overload — so the vendor type is unusable at the
 * call site. Narrowing what we actually depend on is also the honest surface: two
 * fields, both re-validated below.
 */
interface CreatedGatewayOrder {
  id?: unknown
  amount?: unknown
}

/** Razorpay caps `receipt` at 40 characters and rejects anything longer. */
const RECEIPT_MAX = 40

/** And caps notes at 15 pairs of 256 characters. Truncated rather than rejected. */
const NOTE_MAX_KEYS = 15
const NOTE_MAX_LENGTH = 256

function client(): Razorpay {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET

  if (!keyId || !keySecret) {
    throw new PaymentGatewayError(
      'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must both be set to create gateway orders.',
    )
  }

  // Constructed per call rather than cached: the SDK holds no connection pool, and
  // a module-level instance would freeze credentials read at import time, which is
  // the wrong behaviour when a deployment rotates its keys.
  return new Razorpay({ key_id: keyId, key_secret: keySecret })
}

function boundedNotes(notes: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(notes)
      .slice(0, NOTE_MAX_KEYS)
      .map(([key, value]) => [key, value.slice(0, NOTE_MAX_LENGTH)]),
  )
}

export const razorpayGateway: PaymentGatewayAdapter = {
  key: 'RAZORPAY',
  name: 'Razorpay',
  requiredEnv: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
  hasBrowserCheckout: true,

  async createOrder(input: GatewayOrderInput): Promise<GatewayOrder> {
    let order: CreatedGatewayOrder
    try {
      order = await client().orders.create({
        // Already minor units on both sides. Nothing is multiplied here, and if
        // that ever changes it must change in exactly one place.
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.number.slice(0, RECEIPT_MAX),
        notes: boundedNotes(input.notes),
      })
    } catch (error) {
      throw new PaymentGatewayError('Razorpay refused the order.', error)
    }

    if (typeof order.id !== 'string' || order.id.length === 0) {
      throw new PaymentGatewayError('Razorpay returned an order with no id.')
    }

    /**
     * Trust our own amount over the echo. If they ever disagree the order must
     * not proceed: charging a different amount than the one we priced and
     * recorded is the failure that ends up in a chargeback.
     */
    const echoed = Number(order.amount)
    if (Number.isFinite(echoed) && echoed !== input.amountMinor) {
      throw new PaymentGatewayError(
        `Razorpay echoed ${echoed} for an order priced at ${input.amountMinor} minor units.`,
      )
    }

    return {
      gatewayOrderId: order.id,
      amountMinor: input.amountMinor,
      currency: input.currency,
      publicKey: process.env.RAZORPAY_KEY_ID ?? null,
    }
  },

  verifyCheckoutCallback({ gatewayOrderId, gatewayPaymentId, signature }): boolean {
    return verifyCheckoutSignature(
      { gatewayOrderId, gatewayPaymentId },
      signature,
      process.env.RAZORPAY_KEY_SECRET,
    )
  },
}

/**
 * Webhook verification, separate from the adapter because the webhook route is
 * Razorpay-specific by its own path and must not be reachable through a
 * gateway-neutral indirection that a manual deployment could satisfy.
 */
export function verifyRazorpayWebhook(rawBody: string, signature: string | null): boolean {
  return verifyWebhookSignature(rawBody, signature, process.env.RAZORPAY_WEBHOOK_SECRET)
}

registerGateway(razorpayGateway)
