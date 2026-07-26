/**
 * Razorpay webhook endpoint.
 *
 * This layer does one thing that cannot be moved elsewhere: it reads the body as
 * raw text. The signature is an HMAC over exactly those bytes, so anything that
 * parses first — `request.json()`, a body-parsing middleware, a framework
 * convenience — permanently invalidates every signature. Everything else lives in
 * `receiveRazorpayWebhook`.
 */

import { NextResponse } from 'next/server'

import { receiveRazorpayWebhook } from '@/server/payments/webhook'

/** A signed, single-use event must never be served from a cache. */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text()

  const result = await receiveRazorpayWebhook({
    rawBody,
    signature: request.headers.get('x-razorpay-signature'),
    eventId: request.headers.get('x-razorpay-event-id'),
  })

  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
