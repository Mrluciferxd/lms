/**
 * Database-backed tests for the payment paths whose guarantees ARE query
 * semantics, and which a mocked client would therefore only test against itself:
 *
 *  - Invoice numbering under real concurrency. The no-gap claim rests on a
 *    Postgres advisory lock and on allocation sharing a transaction with the
 *    insert. Neither exists in a fake.
 *  - Webhook replay. The idempotency chain is a unique index, a conditional
 *    update and a compare-and-set, in that order.
 *
 * Run with `npm run test:db`. Requires DATABASE_URL pointed at a throwaway
 * database.
 *
 * ── ON ISOLATION ─────────────────────────────────────────────────────────────
 * Node's test runner executes test FILES in parallel, and `src/server/media/
 * playback.dbtest.ts` truncates shared tables (User, Course, OrgSettings, ...)
 * in its `before`. This file therefore creates only prefixed rows and cleans up
 * only its own, so it never damages a neighbouring suite. It cannot protect
 * itself from the reverse, which is a pre-existing hazard rather than one this
 * file introduces — the fix is `--test-concurrency=1` on the `test:db` script,
 * which is not this module's to edit.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { db, disconnectDb } from '@/server/db'
import { ORG_SETTINGS_ID } from '@/server/org/settings'
import { issueInvoice } from './invoices'
import { parseDocumentNumber, seriesYear } from './numbering'
import { settleOrderPayment } from './orders'
import { receiveRazorpayWebhook } from './webhook'

const RUN = randomUUID().slice(0, 8)
const WEBHOOK_SECRET = 'whsec_dbtest_secret'

let studentId: string
let courseId: string
let couponId: string
let year: number

function tag(value: string): string {
  return `paytest-${RUN}-${value}`
}

/** Signs a body exactly as Razorpay would. */
function sign(rawBody: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex')
}

function captureEvent(input: {
  gatewayOrderId: string
  gatewayPaymentId: string
  amountMinor: number
}): string {
  return JSON.stringify({
    entity: 'event',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: input.gatewayPaymentId,
          entity: 'payment',
          amount: input.amountMinor,
          currency: 'INR',
          status: 'captured',
          order_id: input.gatewayOrderId,
          method: 'upi',
          created_at: 1_774_526_400,
        },
      },
    },
  })
}

/** An order in PENDING, as `createCheckout` would have left it. */
async function makeOrder(options: { totalMinor?: number; withCoupon?: boolean } = {}) {
  const totalMinor = options.totalMinor ?? 500_000
  const suffix = randomUUID().slice(0, 12)

  return db.order.create({
    data: {
      number: tag(`ORD-${suffix}`),
      userId: studentId,
      status: 'PENDING',
      gateway: 'RAZORPAY',
      subtotalMinor: totalMinor,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor,
      currency: 'INR',
      couponId: options.withCoupon ? couponId : null,
      gatewayOrderId: `order_${suffix}`,
      notes: { purpose: 'COURSE' },
      items: {
        create: [{ courseId, titleSnapshot: 'Test Course', priceMinor: totalMinor, quantity: 1 }],
      },
    },
    select: { id: true, gatewayOrderId: true, totalMinor: true },
  })
}

async function cleanup(): Promise<void> {
  // Cascades from Order remove OrderItem, Payment and Invoice.
  await db.order.deleteMany({ where: { user: { email: { startsWith: `paytest-${RUN}` } } } })
  await db.webhookEvent.deleteMany({ where: { eventId: { startsWith: `paytest-${RUN}` } } })
  await db.enrollment.deleteMany({ where: { user: { email: { startsWith: `paytest-${RUN}` } } } })
  await db.coupon.deleteMany({ where: { code: { startsWith: `PAYTEST${RUN.toUpperCase()}` } } })
  await db.course.deleteMany({ where: { slug: { startsWith: `paytest-${RUN}` } } })
  await db.user.deleteMany({ where: { email: { startsWith: `paytest-${RUN}` } } })
}

before(async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET

  // Upserted, not created: the singleton is shared with every other suite.
  const settings = await db.orgSettings.upsert({
    where: { id: ORG_SETTINGS_ID },
    update: {},
    create: {
      id: ORG_SETTINGS_ID,
      name: 'Test Academy',
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
      currency: 'INR',
    },
    select: { timezone: true },
  })
  year = seriesYear(new Date(), settings.timezone)

  const student = await db.user.create({
    data: { email: `paytest-${RUN}@test.local`, name: 'Priya Nair', role: 'STUDENT', status: 'ACTIVE' },
  })
  studentId = student.id

  const course = await db.course.create({
    data: {
      slug: tag('course'),
      title: 'Test Course',
      status: 'PUBLISHED',
      priceMinor: 500_000,
      currency: 'INR',
    },
  })
  courseId = course.id

  const coupon = await db.coupon.create({
    data: { code: `PAYTEST${RUN.toUpperCase()}`, type: 'PERCENT', value: 10, maxRedemptions: 100 },
  })
  couponId = coupon.id
})

after(async () => {
  await cleanup()
  await disconnectDb()
})

describe('invoice numbering', () => {
  /**
   * The headline guarantee. Twenty settlements racing for the same year's series
   * must produce twenty consecutive numbers — no duplicates (which the unique
   * index would catch as an error) and no gaps (which nothing would catch, and
   * which an auditor would).
   */
  it('issues gapless consecutive numbers under concurrency', async () => {
    const orders = await Promise.all(Array.from({ length: 20 }, () => makeOrder()))

    const before = await db.invoice.count({ where: { number: { startsWith: `INV-${year}-` } } })

    const issued = await Promise.all(orders.map((order) => issueInvoice(order.id)))

    const sequences = issued
      .map((invoice) => parseDocumentNumber(invoice.number))
      .map((parsed) => {
        assert.ok(parsed, 'every issued number must parse')
        assert.equal(parsed.year, year)
        return parsed.sequence
      })
      .sort((a, b) => a - b)

    assert.equal(new Set(sequences).size, 20, 'no two invoices may share a number')

    const expected = Array.from({ length: 20 }, (_, index) => before + index + 1)
    assert.deepEqual(sequences, expected, 'the series must be consecutive with no gaps')
  })

  it('returns the existing invoice rather than issuing a second for one order', async () => {
    const order = await makeOrder()
    const first = await issueInvoice(order.id)
    const second = await issueInvoice(order.id)

    assert.equal(second.id, first.id)
    assert.equal(second.number, first.number)
    assert.equal(await db.invoice.count({ where: { orderId: order.id } }), 1)
  })

  it('is idempotent under a concurrent double issuance for one order', async () => {
    const order = await makeOrder()
    const [a, b] = await Promise.all([issueInvoice(order.id), issueInvoice(order.id)])

    assert.equal(a.number, b.number)
    assert.equal(await db.invoice.count({ where: { orderId: order.id } }), 1)
  })

  /**
   * The property a Postgres sequence cannot offer. A failed issuance must not
   * consume a number — `nextval` would have burned one and left the gap this
   * whole mechanism exists to avoid.
   */
  it('does not consume a number when the transaction rolls back', async () => {
    const order = await makeOrder()
    const before = await issueInvoice(order.id)
    const beforeSequence = parseDocumentNumber(before.number)!.sequence

    // A foreign-key violation aborts the transaction after the number was read.
    await assert.rejects(() => issueInvoice(`does-not-exist-${RUN}`))

    const next = await issueInvoice((await makeOrder()).id)
    assert.equal(
      parseDocumentNumber(next.number)!.sequence,
      beforeSequence + 1,
      'the rolled-back allocation must be reused, not skipped',
    )
  })
})

describe('webhook signature', () => {
  it('refuses a forged signature and records nothing', async () => {
    const order = await makeOrder()
    const rawBody = captureEvent({
      gatewayOrderId: order.gatewayOrderId!,
      gatewayPaymentId: `pay_forged_${RUN}`,
      amountMinor: order.totalMinor,
    })

    const result = await receiveRazorpayWebhook({
      rawBody,
      signature: 'f'.repeat(64),
      eventId: tag('evt-forged'),
    })

    assert.equal(result.status, 400)

    // An unverified body must not reach the inbox: recording it would let anyone
    // pre-claim an event id and get the genuine delivery discarded as a duplicate.
    const recorded = await db.webhookEvent.count({ where: { eventId: tag('evt-forged') } })
    assert.equal(recorded, 0)

    const untouched = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    assert.equal(untouched.status, 'PENDING')
  })

  it('refuses a body edited after signing', async () => {
    const order = await makeOrder()
    const rawBody = captureEvent({
      gatewayOrderId: order.gatewayOrderId!,
      gatewayPaymentId: `pay_tampered_${RUN}`,
      amountMinor: order.totalMinor,
    })
    const signature = sign(rawBody)

    const result = await receiveRazorpayWebhook({
      rawBody: rawBody.replace(String(order.totalMinor), '1'),
      signature,
      eventId: tag('evt-tampered'),
    })

    assert.equal(result.status, 400)
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'PENDING')
  })

  it('reports a misconfigured secret as retryable rather than rejecting the event', async () => {
    const previous = process.env.RAZORPAY_WEBHOOK_SECRET
    delete process.env.RAZORPAY_WEBHOOK_SECRET

    try {
      const result = await receiveRazorpayWebhook({ rawBody: '{}', signature: 'x', eventId: null })
      // 503 so Razorpay redelivers once the secret is set, instead of 400 which
      // would discard the enrollments in flight.
      assert.equal(result.status, 503)
    } finally {
      process.env.RAZORPAY_WEBHOOK_SECRET = previous
    }
  })
})

describe('webhook settlement', () => {
  it('records the payment, credits the order and enrolls the student', async () => {
    const order = await makeOrder({ withCoupon: true })
    const paymentId = `pay_ok_${RUN}`
    const rawBody = captureEvent({
      gatewayOrderId: order.gatewayOrderId!,
      gatewayPaymentId: paymentId,
      amountMinor: order.totalMinor,
    })

    const result = await receiveRazorpayWebhook({
      rawBody,
      signature: sign(rawBody),
      eventId: tag('evt-ok'),
    })
    assert.equal(result.status, 200)

    const settled = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, paidAt: true, gatewayPaymentId: true, invoice: true },
    })
    assert.equal(settled.status, 'PAID')
    assert.ok(settled.paidAt)
    assert.equal(settled.gatewayPaymentId, paymentId)
    assert.ok(settled.invoice, 'a paid order gets an invoice')

    const payment = await db.payment.findUniqueOrThrow({ where: { gatewayPaymentId: paymentId } })
    assert.equal(payment.status, 'CAPTURED')
    assert.equal(payment.amountMinor, order.totalMinor)

    const enrollments = await db.enrollment.count({ where: { userId: studentId, courseId } })
    assert.equal(enrollments, 1)

    const event = await db.webhookEvent.findFirstOrThrow({ where: { eventId: tag('evt-ok') } })
    assert.ok(event.processedAt, 'a handled event is marked processed')
  })

  /**
   * Razorpay retries. This is the failure the whole idempotency chain exists to
   * prevent: a second delivery must not create a second payment, a second
   * enrollment, or a second coupon redemption.
   */
  it('no-ops on a replayed event', async () => {
    const order = await makeOrder({ withCoupon: true })
    const paymentId = `pay_replay_${RUN}`
    const rawBody = captureEvent({
      gatewayOrderId: order.gatewayOrderId!,
      gatewayPaymentId: paymentId,
      amountMinor: order.totalMinor,
    })
    const signature = sign(rawBody)
    const eventId = tag('evt-replay')

    const first = await receiveRazorpayWebhook({ rawBody, signature, eventId })
    const usedAfterFirst = (
      await db.coupon.findUniqueOrThrow({ where: { id: couponId }, select: { usedCount: true } })
    ).usedCount

    const second = await receiveRazorpayWebhook({ rawBody, signature, eventId })
    const third = await receiveRazorpayWebhook({ rawBody, signature, eventId })

    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(second.body.duplicate, true)
    assert.equal(third.body.duplicate, true)

    assert.equal(await db.payment.count({ where: { orderId: order.id } }), 1)
    assert.equal(await db.enrollment.count({ where: { userId: studentId, courseId } }), 1)
    assert.equal(await db.invoice.count({ where: { orderId: order.id } }), 1)

    const usedAfterReplays = (
      await db.coupon.findUniqueOrThrow({ where: { id: couponId }, select: { usedCount: true } })
    ).usedCount
    assert.equal(usedAfterReplays, usedAfterFirst, 'a replay must not burn a redemption')
  })

  /**
   * The same money described by two different events — `payment.captured` and
   * `order.paid` — arrives with two different event ids, so the WebhookEvent
   * index does not stop it. The compare-and-set on Order.status does.
   */
  it('credits once when the same payment arrives under two event ids', async () => {
    const order = await makeOrder({ withCoupon: true })
    const paymentId = `pay_double_${RUN}`
    const captured = captureEvent({
      gatewayOrderId: order.gatewayOrderId!,
      gatewayPaymentId: paymentId,
      amountMinor: order.totalMinor,
    })
    const orderPaid = captured.replace('"payment.captured"', '"order.paid"')

    const usedBefore = (
      await db.coupon.findUniqueOrThrow({ where: { id: couponId }, select: { usedCount: true } })
    ).usedCount

    await receiveRazorpayWebhook({
      rawBody: captured,
      signature: sign(captured),
      eventId: tag('evt-double-a'),
    })
    await receiveRazorpayWebhook({
      rawBody: orderPaid,
      signature: sign(orderPaid),
      eventId: tag('evt-double-b'),
    })

    assert.equal(await db.payment.count({ where: { orderId: order.id } }), 1)
    assert.equal(await db.invoice.count({ where: { orderId: order.id } }), 1)

    const usedAfter = (
      await db.coupon.findUniqueOrThrow({ where: { id: couponId }, select: { usedCount: true } })
    ).usedCount
    assert.equal(usedAfter, usedBefore + 1, 'the coupon is redeemed exactly once')
  })

  it('takes over an event whose previous attempt never finished', async () => {
    const order = await makeOrder()
    const paymentId = `pay_retake_${RUN}`
    const rawBody = captureEvent({
      gatewayOrderId: order.gatewayOrderId!,
      gatewayPaymentId: paymentId,
      amountMinor: order.totalMinor,
    })
    const eventId = tag('evt-retake')

    // Stand in for a handler that crashed after recording the event: the row
    // exists with processedAt null.
    await db.webhookEvent.create({
      data: { gateway: 'RAZORPAY', eventId, type: 'payment.captured', payload: {}, attempts: 1 },
    })

    const result = await receiveRazorpayWebhook({ rawBody, signature: sign(rawBody), eventId })

    assert.equal(result.status, 200)
    assert.notEqual(result.body.duplicate, true, 'an unfinished event must be reprocessed')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'PAID')

    const event = await db.webhookEvent.findFirstOrThrow({ where: { eventId } })
    assert.equal(event.attempts, 2)
    assert.ok(event.processedAt)
  })

  /**
   * A captured amount that is not the amount we priced must not grant access.
   * The payment is still recorded, because the money is real and reconciliation
   * has to be able to see it.
   */
  it('refuses to credit an order whose captured amount does not match', async () => {
    const order = await makeOrder({ totalMinor: 500_000 })
    const paymentId = `pay_mismatch_${RUN}`
    const rawBody = captureEvent({
      gatewayOrderId: order.gatewayOrderId!,
      gatewayPaymentId: paymentId,
      amountMinor: 100,
    })

    const result = await receiveRazorpayWebhook({
      rawBody,
      signature: sign(rawBody),
      eventId: tag('evt-mismatch'),
    })

    assert.equal(result.status, 200)
    assert.equal(result.body.unresolved, 'AMOUNT_MISMATCH')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'PENDING')
    assert.ok(await db.payment.findUnique({ where: { gatewayPaymentId: paymentId } }))
  })

  it('records an event for an order it cannot find, without failing the delivery', async () => {
    const rawBody = captureEvent({
      gatewayOrderId: `order_unknown_${RUN}`,
      gatewayPaymentId: `pay_unknown_${RUN}`,
      amountMinor: 500_000,
    })

    const result = await receiveRazorpayWebhook({
      rawBody,
      signature: sign(rawBody),
      eventId: tag('evt-unknown'),
    })

    assert.equal(result.status, 200)
    assert.equal(result.body.unresolved, 'ORDER_NOT_FOUND')
  })

  it('marks a failed payment without touching a later successful one', async () => {
    const order = await makeOrder()
    const paymentId = `pay_failed_${RUN}`
    const failed = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            amount: order.totalMinor,
            currency: 'INR',
            order_id: order.gatewayOrderId,
            method: 'card',
            error_description: 'Declined',
          },
        },
      },
    })

    await receiveRazorpayWebhook({
      rawBody: failed,
      signature: sign(failed),
      eventId: tag('evt-failed'),
    })

    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'FAILED')

    // The student retries on a new payment id and succeeds.
    const retry = captureEvent({
      gatewayOrderId: order.gatewayOrderId!,
      gatewayPaymentId: `pay_retry_${RUN}`,
      amountMinor: order.totalMinor,
    })
    await receiveRazorpayWebhook({
      rawBody: retry,
      signature: sign(retry),
      eventId: tag('evt-retry'),
    })

    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'PAID')
    assert.equal(
      (await db.payment.findUniqueOrThrow({ where: { gatewayPaymentId: paymentId } })).status,
      'FAILED',
      'the earlier failure stays visible in the trail',
    )
  })
})

describe('manual settlement', () => {
  it('goes through the same path as a webhook, invoice and all', async () => {
    const order = await makeOrder()
    const outcome = await settleOrderPayment({
      orderId: order.id,
      gatewayPaymentId: `manual:UTR-${RUN}`,
      gateway: 'MANUAL',
      amountMinor: order.totalMinor,
      currency: 'INR',
      method: 'bank_transfer',
      capturedAt: new Date(),
      actorId: studentId,
    })

    assert.equal(outcome.ok, true)
    assert.ok(outcome.ok && outcome.invoiceNumber)
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'PAID')
  })

  it('is idempotent when the same reference is entered twice', async () => {
    const order = await makeOrder()
    const reference = `manual:UTR-DUP-${RUN}`

    const first = await settleOrderPayment({
      orderId: order.id,
      gatewayPaymentId: reference,
      gateway: 'MANUAL',
      amountMinor: order.totalMinor,
      currency: 'INR',
      method: 'cash',
      capturedAt: new Date(),
    })
    const second = await settleOrderPayment({
      orderId: order.id,
      gatewayPaymentId: reference,
      gateway: 'MANUAL',
      amountMinor: order.totalMinor,
      currency: 'INR',
      method: 'cash',
      capturedAt: new Date(),
    })

    assert.equal(first.ok && first.alreadySettled, false)
    assert.equal(second.ok && second.alreadySettled, true)
    assert.equal(await db.payment.count({ where: { orderId: order.id } }), 1)
  })
})
