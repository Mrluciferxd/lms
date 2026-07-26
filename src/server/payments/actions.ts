'use server'

/**
 * Payment and coupon mutations.
 *
 * Every action re-checks its permission server-side. A server action is a
 * directly invocable endpoint — the button that renders it is not the thing that
 * authorizes it — and these are the actions that move money, waive fees and
 * create discounts, so the check lives here rather than in whatever page drew the
 * form.
 *
 * Permissions map to the existing matrix in src/server/auth/roles.ts:
 * `payment:read` to look, `payment:manage` to refund or settle, `fee:manage` for
 * schedules and installments. Coupons are priced product decisions rather than
 * day-to-day operations, so they sit behind `payment:manage` too.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { recordAudit } from '@/server/audit'
import { authorizeRequest } from '@/server/auth/rbac'
import { db } from '@/server/db'
import { normalizeCouponCode } from './coupons'
import { createFeeSchedule, markOverdueInstallments, settleInstallmentManually } from './fees'
import { recordRefund, settleOrderPayment } from './orders'
import type { ActionResult } from '@/server/catalog/actions'

function fail(error: string, fieldErrors?: Record<string, string>): ActionResult {
  return { ok: false, error, fieldErrors }
}

function firstIssues(error: z.ZodError): Record<string, string> {
  const flattened = error.flatten().fieldErrors
  return Object.fromEntries(
    Object.entries(flattened)
      .filter(([, messages]) => messages && messages.length > 0)
      .map(([field, messages]) => [field, messages![0]!]),
  )
}

// -----------------------------------------------------------------------------
// Coupons
// -----------------------------------------------------------------------------

const couponSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, 'Code must be at least 3 characters')
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, hyphens and underscores only'),
  type: z.enum(['PERCENT', 'FLAT']),
  /** Percent for PERCENT; rupees in the form, stored as paise, for FLAT. */
  value: z.coerce.number().min(0).max(10_000_000),
  maxRedemptions: z.coerce.number().int().min(1).max(1_000_000).optional(),
  minOrder: z.coerce.number().min(0).max(10_000_000).optional(),
  validFrom: z.string().trim().optional(),
  validTo: z.string().trim().optional(),
  courseIds: z.array(z.string()).default([]),
  active: z.boolean(),
})

function readCouponForm(formData: FormData) {
  return couponSchema.safeParse({
    code: formData.get('code'),
    type: formData.get('type') ?? 'PERCENT',
    value: formData.get('value'),
    maxRedemptions: formData.get('maxRedemptions') || undefined,
    minOrder: formData.get('minOrder') || undefined,
    validFrom: formData.get('validFrom') || undefined,
    validTo: formData.get('validTo') || undefined,
    courseIds: formData.getAll('courseIds').map(String).filter(Boolean),
    active: formData.get('active') === 'on',
  })
}

/** Percent stays a percent; a flat amount is entered in rupees and stored in paise. */
function couponValueMinor(type: 'PERCENT' | 'FLAT', value: number): number {
  return type === 'PERCENT' ? Math.round(value) : Math.round(value * 100)
}

function couponFields(data: z.infer<typeof couponSchema>) {
  return {
    code: normalizeCouponCode(data.code),
    type: data.type,
    value: couponValueMinor(data.type, data.value),
    maxRedemptions: data.maxRedemptions ?? null,
    minOrderMinor: data.minOrder !== undefined ? Math.round(data.minOrder * 100) : null,
    validFrom: data.validFrom ? new Date(data.validFrom) : null,
    validTo: data.validTo ? new Date(data.validTo) : null,
    courseIds: data.courseIds,
    active: data.active,
  }
}

/** Rejects a window that can never be open, rather than storing a dead coupon. */
function validateWindow(data: z.infer<typeof couponSchema>): Record<string, string> | null {
  if (data.validFrom && data.validTo && new Date(data.validFrom) > new Date(data.validTo)) {
    return { validTo: 'The end of the window must be after its start.' }
  }
  if (data.type === 'PERCENT' && data.value > 100) {
    return { value: 'A percentage discount cannot exceed 100.' }
  }
  if (data.value <= 0) {
    return { value: 'A coupon that discounts nothing will be rejected at checkout.' }
  }
  return null
}

export async function createCoupon(formData: FormData): Promise<ActionResult> {
  const auth = await authorizeRequest('payment:manage')
  if (!auth.ok) return fail('You do not have permission to manage coupons.')

  const parsed = readCouponForm(formData)
  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const windowError = validateWindow(parsed.data)
  if (windowError) return fail('This coupon could never be redeemed.', windowError)

  const fields = couponFields(parsed.data)

  const clash = await db.coupon.findUnique({ where: { code: fields.code }, select: { id: true } })
  if (clash) return fail('That code already exists.', { code: 'Already in use' })

  const coupon = await db.coupon.create({ data: fields, select: { id: true } })

  await recordAudit({
    actorId: auth.user.id,
    action: 'coupon.created',
    entityType: 'Coupon',
    entityId: coupon.id,
    meta: { code: fields.code, type: fields.type, value: fields.value },
  })

  revalidatePath('/admin/coupons')
  return { ok: true, id: coupon.id }
}

export async function updateCoupon(couponId: string, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeRequest('payment:manage')
  if (!auth.ok) return fail('You do not have permission to manage coupons.')

  const parsed = readCouponForm(formData)
  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const windowError = validateWindow(parsed.data)
  if (windowError) return fail('This coupon could never be redeemed.', windowError)

  const existing = await db.coupon.findUnique({
    where: { id: couponId },
    select: { code: true, usedCount: true },
  })
  if (!existing) return fail('Coupon not found.')

  const fields = couponFields(parsed.data)

  if (fields.code !== existing.code) {
    const clash = await db.coupon.findUnique({ where: { code: fields.code }, select: { id: true } })
    if (clash) return fail('That code already exists.', { code: 'Already in use' })
  }

  await db.coupon.update({ where: { id: couponId }, data: fields })

  await recordAudit({
    actorId: auth.user.id,
    action: 'coupon.updated',
    entityType: 'Coupon',
    entityId: couponId,
    meta: { code: fields.code, usedCount: existing.usedCount },
  })

  revalidatePath('/admin/coupons')
  return { ok: true }
}

/**
 * Deactivating is the normal way to retire a code; deleting is only allowed while
 * a coupon has never been used, because `Order.couponId` is SetNull on delete and
 * removing a redeemed coupon would silently detach the discount from the orders
 * that explain it.
 */
export async function deleteCoupon(couponId: string): Promise<ActionResult> {
  const auth = await authorizeRequest('payment:manage')
  if (!auth.ok) return fail('You do not have permission to manage coupons.')

  const coupon = await db.coupon.findUnique({
    where: { id: couponId },
    select: { code: true, usedCount: true, _count: { select: { orders: true } } },
  })
  if (!coupon) return fail('Coupon not found.')

  if (coupon._count.orders > 0 || coupon.usedCount > 0) {
    return fail(
      `This code is attached to ${coupon._count.orders} order(s). Deactivate it instead — deleting it would detach the discount from orders that recorded it.`,
    )
  }

  await db.coupon.delete({ where: { id: couponId } })

  await recordAudit({
    actorId: auth.user.id,
    action: 'coupon.deleted',
    entityType: 'Coupon',
    entityId: couponId,
    meta: { code: coupon.code },
  })

  revalidatePath('/admin/coupons')
  return { ok: true }
}

export async function setCouponActive(couponId: string, active: boolean): Promise<ActionResult> {
  const auth = await authorizeRequest('payment:manage')
  if (!auth.ok) return fail('You do not have permission to manage coupons.')

  const coupon = await db.coupon.findUnique({ where: { id: couponId }, select: { code: true } })
  if (!coupon) return fail('Coupon not found.')

  await db.coupon.update({ where: { id: couponId }, data: { active } })

  await recordAudit({
    actorId: auth.user.id,
    action: active ? 'coupon.activated' : 'coupon.deactivated',
    entityType: 'Coupon',
    entityId: couponId,
    meta: { code: coupon.code },
  })

  revalidatePath('/admin/coupons')
  return { ok: true }
}

// -----------------------------------------------------------------------------
// Refunds and manual settlement
// -----------------------------------------------------------------------------

const refundSchema = z.object({
  paymentId: z.string().min(1),
  /** Rupees in the form, stored as paise. */
  amount: z.coerce.number().positive('Enter an amount greater than zero').max(10_000_000),
  reason: z.string().trim().max(500).optional(),
  gatewayRefundId: z.string().trim().max(120).optional(),
  cancelEnrollments: z.boolean(),
})

/**
 * Records a refund that has been (or is being) issued at the gateway.
 *
 * This is bookkeeping, not money movement: the reversal itself happens in the
 * Razorpay dashboard or through their API, and this makes our ledger agree with
 * it. Refunds Razorpay reports through `refund.processed` are reconciled
 * automatically — see syncGatewayRefund in ./orders.ts — so this exists for the
 * cases that never produce a webhook: bank transfers, cash, and reversals an
 * operator makes before the integration is live.
 */
export async function recordRefundAction(
  orderId: string,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await authorizeRequest('payment:manage')
  if (!auth.ok) return fail('You do not have permission to record refunds.')

  const parsed = refundSchema.safeParse({
    paymentId: formData.get('paymentId'),
    amount: formData.get('amount'),
    reason: formData.get('reason') || undefined,
    gatewayRefundId: formData.get('gatewayRefundId') || undefined,
    cancelEnrollments: formData.get('cancelEnrollments') === 'on',
  })
  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const result = await recordRefund({
    paymentId: parsed.data.paymentId,
    amountMinor: Math.round(parsed.data.amount * 100),
    reason: parsed.data.reason ?? null,
    gatewayRefundId: parsed.data.gatewayRefundId ?? null,
    actorId: auth.user.id,
    cancelEnrollments: parsed.data.cancelEnrollments,
  })

  if (!result.ok) return fail(result.error)

  revalidatePath('/admin/payments')
  revalidatePath(`/admin/payments/${orderId}`)
  return { ok: true }
}

const manualSettlementSchema = z.object({
  reference: z.string().trim().min(3, 'Enter a reference — a UTR, cheque number or receipt').max(120),
  method: z.string().trim().max(40).optional(),
})

/**
 * Settles an order that was paid outside the gateway.
 *
 * Goes through the same `settleOrderPayment` as the webhook, so enrollment,
 * invoice issuance, coupon counting and installment linkage behave identically —
 * a manually settled order is not a second-class one. The reference the operator
 * types becomes the payment id, which is unique, so entering the same UTR twice
 * updates one payment rather than creating two.
 */
export async function settleOrderManually(
  orderId: string,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await authorizeRequest('payment:manage')
  if (!auth.ok) return fail('You do not have permission to settle orders.')

  const parsed = manualSettlementSchema.safeParse({
    reference: formData.get('reference'),
    method: formData.get('method') || undefined,
  })
  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, totalMinor: true, currency: true },
  })
  if (!order) return fail('Order not found.')
  if (order.status === 'PAID') return fail('This order is already marked paid.')

  const outcome = await settleOrderPayment({
    orderId: order.id,
    gatewayPaymentId: `manual:${parsed.data.reference}`,
    gateway: 'MANUAL',
    amountMinor: order.totalMinor,
    currency: order.currency,
    method: parsed.data.method ?? 'manual',
    capturedAt: new Date(),
    raw: { reference: parsed.data.reference, recordedBy: auth.user.id },
    actorId: auth.user.id,
  })

  if (!outcome.ok) {
    return fail(
      outcome.reason === 'ORDER_NOT_FOUND'
        ? 'Order not found.'
        : 'The recorded amount does not match this order.',
    )
  }

  revalidatePath('/admin/payments')
  revalidatePath(`/admin/payments/${orderId}`)
  return { ok: true }
}

/**
 * Cancels an unpaid order so it stops appearing as outstanding. Deliberately not
 * a delete: an abandoned checkout is a real event and the reconciliation view
 * needs to be able to tell "never attempted" from "never happened".
 */
export async function cancelOrder(orderId: string): Promise<ActionResult> {
  const auth = await authorizeRequest('payment:manage')
  if (!auth.ok) return fail('You do not have permission to manage orders.')

  const cancelled = await db.order.updateMany({
    where: { id: orderId, status: { in: ['CREATED', 'PENDING', 'FAILED'] } },
    data: { status: 'CANCELLED' },
  })
  if (cancelled.count === 0) return fail('Only an unpaid order can be cancelled.')

  await recordAudit({
    actorId: auth.user.id,
    action: 'order.cancelled',
    entityType: 'Order',
    entityId: orderId,
  })

  revalidatePath('/admin/payments')
  revalidatePath(`/admin/payments/${orderId}`)
  return { ok: true }
}

// -----------------------------------------------------------------------------
// Fee schedules
// -----------------------------------------------------------------------------

const feeScheduleSchema = z.object({
  enrollmentId: z.string().min(1),
  /** Rupees in the form. */
  total: z.coerce.number().positive('Enter the total fee').max(10_000_000),
  count: z.coerce.number().int().min(1, 'At least one installment').max(60),
  firstDueDate: z.string().trim().min(1, 'Pick the first due date'),
  cadence: z.enum(['MONTHLY', 'FORTNIGHTLY', 'WEEKLY']),
  notes: z.string().trim().max(500).optional(),
})

export async function createFeeScheduleAction(formData: FormData): Promise<ActionResult> {
  const auth = await authorizeRequest('fee:manage')
  if (!auth.ok) return fail('You do not have permission to manage fees.')

  const parsed = feeScheduleSchema.safeParse({
    enrollmentId: formData.get('enrollmentId'),
    total: formData.get('total'),
    count: formData.get('count'),
    firstDueDate: formData.get('firstDueDate'),
    cadence: formData.get('cadence') ?? 'MONTHLY',
    notes: formData.get('notes') || undefined,
  })
  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const firstDueDate = new Date(parsed.data.firstDueDate)
  if (Number.isNaN(firstDueDate.getTime())) {
    return fail('That is not a valid date.', { firstDueDate: 'Invalid date' })
  }

  const result = await createFeeSchedule({
    enrollmentId: parsed.data.enrollmentId,
    totalMinor: Math.round(parsed.data.total * 100),
    count: parsed.data.count,
    firstDueDate,
    cadence: parsed.data.cadence,
    notes: parsed.data.notes ?? null,
    actorId: auth.user.id,
  })

  if (!result.ok) return fail(result.error)

  revalidatePath('/admin/payments')
  return { ok: true, id: result.feeScheduleId }
}

export async function settleInstallmentAction(
  installmentId: string,
  status: 'PAID' | 'WAIVED' | 'CANCELLED',
): Promise<ActionResult> {
  const auth = await authorizeRequest('fee:manage')
  if (!auth.ok) return fail('You do not have permission to manage fees.')

  const result = await settleInstallmentManually({
    installmentId,
    actorId: auth.user.id,
    status,
  })
  if (!result.ok) return fail(result.error ?? 'Could not update that installment.')

  revalidatePath('/admin/payments')
  revalidatePath('/app/billing')
  return { ok: true }
}

/**
 * Re-derives OVERDUE from due dates. Belongs on a schedule; exposed as a button
 * because the cron entrypoints live outside this module's territory and an
 * unlinked job is worse than a manual one.
 */
export async function refreshOverdueAction(): Promise<ActionResult> {
  const auth = await authorizeRequest('fee:manage')
  if (!auth.ok) return fail('You do not have permission to manage fees.')

  const count = await markOverdueInstallments()

  if (count > 0) {
    await recordAudit({
      actorId: auth.user.id,
      action: 'fee_installment.marked_overdue',
      entityType: 'FeeInstallment',
      meta: { count },
    })
  }

  revalidatePath('/admin/payments')
  return { ok: true }
}
