/**
 * Checkout endpoint.
 *
 * POST creates an order and returns what the browser needs to pay for it. The
 * request says *what* is being bought, never what it costs — pricing, coupon
 * validation and eligibility are all re-decided server-side in `createCheckout`.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getCurrentUser } from '@/server/auth/rbac'
import { createCheckout, previewCoupon } from '@/server/payments/checkout'

export const dynamic = 'force-dynamic'

const checkoutSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('COURSE'),
    courseId: z.string().min(1),
    batchId: z.string().min(1).nullish(),
    couponCode: z.string().trim().max(40).nullish(),
  }),
  z.object({
    kind: z.literal('INSTALLMENT'),
    installmentId: z.string().min(1),
  }),
])

const previewSchema = z.object({
  courseId: z.string().min(1),
  couponCode: z.string().trim().min(1).max(40),
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

  const parsed = checkoutSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Unrecognised checkout request.' }, { status: 400 })
  }

  const result = await createCheckout(user.id, parsed.data)

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code, couponReason: result.couponReason },
      { status: result.status, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Coupon preview. Separate from order creation so a student can see the discount
 * before committing, and so a mistyped code does not leave an abandoned order
 * behind. Authenticated, because an open endpoint here is a coupon-code oracle.
 */
export async function PUT(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  const parsed = previewSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'courseId and couponCode are required.' }, { status: 400 })
  }

  const result = await previewCoupon(parsed.data.courseId, parsed.data.couponCode)

  return NextResponse.json(result, {
    status: result.ok ? 200 : 400,
    headers: { 'Cache-Control': 'no-store' },
  })
}
