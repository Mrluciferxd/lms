/**
 * Razorpay webhook intake.
 *
 * Order of operations is the whole design, and it is deliberate:
 *
 *   1. Refuse if this deployment does not use Razorpay.
 *   2. Verify the HMAC signature over the RAW body. Nothing below this line
 *      trusts a single field from the request.
 *   3. Parse.
 *   4. Claim the event in `WebhookEvent(gateway, eventId)`.
 *   5. Act, then mark it processed.
 *
 * Step 2 comes before step 4 for a reason worth stating: recording an
 * *unverified* event would let anyone who can reach the URL fill the inbox and,
 * worse, pre-claim an event id so the genuine delivery of that id is discarded as
 * a duplicate — a denial of enrollment for a paying student. An unsigned body is
 * not evidence of anything and is not stored.
 *
 * ── THE RETRY THAT MUST NOT BE SWALLOWED ─────────────────────────────────────
 * The obvious implementation of step 4 — insert, and no-op on conflict — has a
 * bug that only shows up when something else has already gone wrong. If handling
 * crashes after the insert, Razorpay retries the same event id, the insert
 * conflicts, and the retry is discarded as a duplicate. The event is now
 * permanently unprocessed and the student is permanently unenrolled.
 *
 * So a conflict is resolved by looking at `processedAt`: an event that was
 * recorded but never finished is *claimed again* (and `attempts` incremented,
 * which is what that column is for). Only a genuinely completed event is a no-op.
 *
 * That widens the window for concurrent processing of one event, which is fine:
 * this table stops duplicated *work*, while the guarantee that nothing is
 * double-credited comes from the compare-and-set in ./orders.ts. Two layers,
 * each with an honest job.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { brand } from '@/lib/brand'
import { recordAudit } from '@/server/audit'
import { db } from '@/server/db'
import { interpretRazorpayEvent, parseRazorpayEvent, razorpayEventKey } from './events'
import { verifyRazorpayWebhook } from './index'
import { recordFailedPayment, settleOrderPayment, syncGatewayRefund } from './orders'
import { PaymentConfigError } from './signature'

export interface WebhookRequestInput {
  /** Exact bytes as received. Re-serialising invalidates the signature. */
  rawBody: string
  signature: string | null
  eventId: string | null
}

export interface WebhookResult {
  status: 200 | 400 | 404 | 500 | 503
  body: Record<string, unknown>
}

type Claim = 'CLAIMED' | 'ALREADY_PROCESSED'

async function claimEvent(eventId: string, type: string, payload: unknown): Promise<Claim> {
  // `createMany` with skipDuplicates rather than a create in a try/catch: the
  // conflict is the expected path on every retry, and routing the normal case
  // through an exception fills the log with unique-violation stack traces that
  // look like the failure they are meant to be preventing.
  const inserted = await db.webhookEvent.createMany({
    data: [{ gateway: 'RAZORPAY', eventId, type, payload: (payload ?? {}) as never, attempts: 1 }],
    skipDuplicates: true,
  })
  if (inserted.count === 1) return 'CLAIMED'

  // Seen before. Take it over only if the previous attempt never finished.
  const retaken = await db.webhookEvent.updateMany({
    where: { gateway: 'RAZORPAY', eventId, processedAt: null },
    data: { attempts: { increment: 1 } },
  })
  return retaken.count > 0 ? 'CLAIMED' : 'ALREADY_PROCESSED'
}

async function markProcessed(eventId: string, error?: string): Promise<void> {
  await db.webhookEvent.updateMany({
    where: { gateway: 'RAZORPAY', eventId },
    data: error ? { error } : { processedAt: new Date(), error: null },
  })
}

export async function receiveRazorpayWebhook(input: WebhookRequestInput): Promise<WebhookResult> {
  /**
   * A deployment that does not take money through Razorpay has no business
   * accepting Razorpay events, whatever they are signed with. 404 rather than
   * 403 — the endpoint does not exist for this brand.
   */
  if (brand.integrations.payments !== 'razorpay') {
    return { status: 404, body: { error: 'Not found.' } }
  }

  let verified: boolean
  try {
    verified = verifyRazorpayWebhook(input.rawBody, input.signature)
  } catch (error) {
    if (error instanceof PaymentConfigError) {
      /**
       * 503 rather than 400, and deliberately retryable: the deployment is
       * misconfigured, not the request. Razorpay's redelivery window is our
       * grace period to set the secret without losing the enrollments in flight.
       */
      console.error('[webhook:razorpay]', error.message)
      return { status: 503, body: { error: 'Webhook verification is not configured.' } }
    }
    throw error
  }

  if (!verified) {
    await recordAudit({
      action: 'payment.webhook_rejected',
      entityType: 'WebhookEvent',
      meta: { gateway: 'RAZORPAY', reason: 'signature', bytes: input.rawBody.length },
    })
    return { status: 400, body: { error: 'Invalid signature.' } }
  }

  const parsed = parseRazorpayEvent(input.rawBody)
  if (!parsed) {
    // Correctly signed but not an event envelope. A retry cannot fix that, so it
    // is reported as a client error rather than left to redeliver forever.
    return { status: 400, body: { error: 'Unrecognised event payload.' } }
  }

  const eventId = razorpayEventKey(input.eventId, parsed)
  // Re-parsed rather than reusing `parsed`: the interpreter only needs
  // `payload`, while the inbox keeps the whole envelope, which is what an
  // investigation a month from now will want. The body already parsed once, so
  // this cannot throw.
  const claim = await claimEvent(eventId, parsed.type, JSON.parse(input.rawBody))
  if (claim === 'ALREADY_PROCESSED') {
    return { status: 200, body: { ok: true, duplicate: true } }
  }

  const intent = interpretRazorpayEvent(parsed)

  try {
    switch (intent.kind) {
      case 'PAYMENT_CAPTURED': {
        const outcome = await settleOrderPayment({
          gatewayOrderId: intent.gatewayOrderId,
          gatewayPaymentId: intent.gatewayPaymentId,
          gateway: 'RAZORPAY',
          amountMinor: intent.amountMinor,
          currency: intent.currency,
          method: intent.method,
          capturedAt: intent.capturedAt,
          raw: parsed.payload,
        })

        if (!outcome.ok) {
          // Recorded, not retried: neither an unknown order nor a mismatched
          // amount is fixed by redelivery, and both need a human. They surface in
          // /admin/payments/reconciliation.
          await markProcessed(eventId, outcome.reason)
          return { status: 200, body: { ok: true, unresolved: outcome.reason } }
        }

        await markProcessed(eventId)
        return {
          status: 200,
          body: { ok: true, orderId: outcome.orderId, duplicate: outcome.alreadySettled },
        }
      }

      case 'PAYMENT_FAILED': {
        await recordFailedPayment({
          gatewayOrderId: intent.gatewayOrderId,
          gatewayPaymentId: intent.gatewayPaymentId,
          gateway: 'RAZORPAY',
          amountMinor: intent.amountMinor,
          currency: intent.currency,
          method: intent.method,
          reason: intent.reason,
          raw: parsed.payload,
        })
        await markProcessed(eventId)
        return { status: 200, body: { ok: true } }
      }

      case 'REFUND_PROCESSED': {
        const synced = await syncGatewayRefund({
          gatewayPaymentId: intent.gatewayPaymentId,
          refundedMinor: intent.refundedMinor,
          gatewayRefundId: intent.gatewayRefundId,
        })
        await markProcessed(eventId, synced.ok ? undefined : 'PAYMENT_NOT_FOUND')
        return { status: 200, body: { ok: true } }
      }

      case 'MALFORMED': {
        await markProcessed(eventId, intent.problem)
        return { status: 200, body: { ok: true, ignored: intent.problem } }
      }

      case 'IGNORED': {
        await markProcessed(eventId)
        return { status: 200, body: { ok: true, ignored: intent.type } }
      }
    }
  } catch (error) {
    /**
     * Left unprocessed on purpose. 500 makes Razorpay redeliver, the claim logic
     * above lets the redelivery take the event over, and a transient database
     * failure therefore costs a delay rather than an enrollment.
     */
    const message = error instanceof Error ? error.message : 'unknown error'
    console.error('[webhook:razorpay] processing failed', eventId, error)
    await markProcessed(eventId, message)
    return { status: 500, body: { error: 'Processing failed.' } }
  }
}
