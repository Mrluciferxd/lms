/**
 * Checkout callback verification.
 *
 * The gateway's browser widget hands back a signed triple on success. Verifying
 * it here lets the student see a confirmed receipt immediately instead of
 * polling for the webhook.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
 * It is not the authority on whether the money arrived. A student whose browser
 * closes, whose network drops or who hits back before the callback fires must
 * still end up enrolled, and that is the webhook's job. Both call the same
 * idempotent `settleOrderPayment`, so whichever arrives first does the work and
 * the other is a no-op.
 *
 * A forged callback cannot enroll anybody: the signature is checked against the
 * API key secret, and the order is additionally confirmed to belong to the signed-
 * in user so a valid signature for someone else's order is useless.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getCurrentUser } from '@/server/auth/rbac'
import { recordAudit } from '@/server/audit'
import { db } from '@/server/db'
import { PaymentConfigError, resolveGateway } from '@/server/payments'
import { settleOrderPayment } from '@/server/payments/orders'

export const dynamic = 'force-dynamic'

const verifySchema = z.object({
  orderId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
})

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  const parsed = verifySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Incomplete payment confirmation.' }, { status: 400 })
  }

  const order = await db.order.findFirst({
    // Scoped to the caller: someone else's order id is reported as missing.
    where: { id: parsed.data.orderId, userId: user.id },
    select: {
      id: true,
      status: true,
      totalMinor: true,
      currency: true,
      gateway: true,
      gatewayOrderId: true,
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })

  // The signature covers the gateway's order id, so it proves nothing unless that
  // id is the one we recorded when we created the order.
  if (order.gatewayOrderId !== parsed.data.razorpayOrderId) {
    return NextResponse.json({ error: 'This confirmation is for another order.' }, { status: 400 })
  }

  let verified: boolean
  try {
    verified = resolveGateway().verifyCheckoutCallback({
      gatewayOrderId: parsed.data.razorpayOrderId,
      gatewayPaymentId: parsed.data.razorpayPaymentId,
      signature: parsed.data.razorpaySignature,
    })
  } catch (error) {
    if (error instanceof PaymentConfigError) {
      console.error('[checkout:verify]', error.message)
      return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 })
    }
    throw error
  }

  if (!verified) {
    await recordAudit({
      actorId: user.id,
      action: 'payment.callback_rejected',
      entityType: 'Order',
      entityId: order.id,
      meta: { gatewayPaymentId: parsed.data.razorpayPaymentId },
    })
    return NextResponse.json({ error: 'Payment confirmation failed verification.' }, { status: 400 })
  }

  const outcome = await settleOrderPayment({
    orderId: order.id,
    gatewayOrderId: parsed.data.razorpayOrderId,
    gatewayPaymentId: parsed.data.razorpayPaymentId,
    gateway: order.gateway,
    // Our own recorded total, not a number from the request. The webhook carries
    // the gateway's figure and will flag a disagreement; this path must not be
    // the one that introduces it.
    amountMinor: order.totalMinor,
    currency: order.currency,
    method: null,
    capturedAt: new Date(),
    raw: { source: 'checkout-callback' },
    actorId: user.id,
  })

  if (!outcome.ok) {
    return NextResponse.json(
      { error: 'We could not confirm this payment. Support has been notified.' },
      { status: 409, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json(
    { ok: true, orderId: outcome.orderId, invoiceNumber: outcome.invoiceNumber },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
