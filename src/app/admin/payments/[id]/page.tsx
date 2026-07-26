import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { formatDateTime, formatMoney } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { roleHasPermission } from '@/server/auth/roles'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { readOrderPurpose } from '@/server/payments/orders'
import { FLAG_DESCRIPTIONS, classifyOrder } from '@/server/payments/reconcile'
import { ManualSettlementForm } from './manual-settlement-form'
import { OrderActions } from './order-actions'
import { RefundForm } from './refund-form'

export const metadata: Metadata = { title: 'Order' }

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const viewer = await requirePermission('payment:read', `/admin/payments/${id}`)
  const settings = await getOrgSettings()

  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      gateway: true,
      gatewayOrderId: true,
      gatewayPaymentId: true,
      subtotalMinor: true,
      discountMinor: true,
      taxMinor: true,
      totalMinor: true,
      currency: true,
      notes: true,
      createdAt: true,
      paidAt: true,
      user: { select: { id: true, name: true, email: true } },
      coupon: { select: { id: true, code: true, type: true, value: true } },
      invoice: { select: { number: true, issuedAt: true } },
      items: { select: { id: true, titleSnapshot: true, priceMinor: true, quantity: true } },
      payments: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          gateway: true,
          gatewayPaymentId: true,
          status: true,
          amountMinor: true,
          refundedMinor: true,
          method: true,
          capturedAt: true,
          createdAt: true,
        },
      },
      installments: {
        select: { id: true, seq: true, label: true, amountMinor: true, status: true },
      },
    },
  })

  if (!order) notFound()

  const canManage = roleHasPermission(viewer.role, 'payment:manage')
  const purpose = readOrderPurpose(order.notes)
  const reconciliation = classifyOrder(
    {
      status: order.status,
      totalMinor: order.totalMinor,
      createdAt: order.createdAt,
      gatewayOrderId: order.gatewayOrderId,
      payments: order.payments,
    },
    new Date(),
  )

  const refundable = order.payments.filter(
    (payment) => payment.status === 'CAPTURED' && payment.refundedMinor < payment.amountMinor,
  )

  const money = (amountMinor: number) =>
    formatMoney(amountMinor, order.currency, settings.locale)

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/admin/payments" className="text-content-muted hover:text-content">
          ← Payments
        </Link>
      </nav>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-mono text-2xl font-semibold text-content">{order.number}</h1>
        <span className="text-sm text-content-muted">
          {order.status} · {order.gateway}
        </span>
      </div>

      {reconciliation.flags.length > 0 && (
        <section
          aria-labelledby="anomalies-heading"
          className="space-y-2 rounded-brand border border-warning/40 bg-warning/10 p-4"
        >
          <h2 id="anomalies-heading" className="text-sm font-semibold text-warning">
            Needs attention
          </h2>
          <ul className="space-y-1 text-sm text-content">
            {reconciliation.flags.map((flag) => (
              <li key={flag}>{FLAG_DESCRIPTIONS[flag]}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="summary-heading" className="space-y-3">
          <h2
            id="summary-heading"
            className="text-sm font-medium uppercase tracking-wide text-content-muted"
          >
            Summary
          </h2>
          <dl className="space-y-2 rounded-brand border border-surface-border p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-content-muted">Student</dt>
              <dd className="text-right text-content">
                {order.user.name}
                <span className="block text-xs text-content-muted">{order.user.email}</span>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-content-muted">Placed</dt>
              <dd className="text-content">
                {formatDateTime(order.createdAt, settings.timezone, settings.locale)}
              </dd>
            </div>
            {order.paidAt && (
              <div className="flex justify-between gap-4">
                <dt className="text-content-muted">Paid</dt>
                <dd className="text-content">
                  {formatDateTime(order.paidAt, settings.timezone, settings.locale)}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-content-muted">Purpose</dt>
              <dd className="text-content">
                {purpose.kind === 'INSTALLMENT' ? 'Fee installment' : 'Course purchase'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-content-muted">Gateway order</dt>
              <dd className="break-all text-right font-mono text-xs text-content-muted">
                {order.gatewayOrderId ?? '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-content-muted">Invoice</dt>
              <dd className="text-right font-mono text-xs text-content">
                {order.invoice ? (
                  <>
                    {order.invoice.number}
                    <span className="block text-content-muted">
                      {formatDateTime(order.invoice.issuedAt, settings.timezone, settings.locale)}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="totals-heading" className="space-y-3">
          <h2
            id="totals-heading"
            className="text-sm font-medium uppercase tracking-wide text-content-muted"
          >
            Amounts
          </h2>
          <dl className="space-y-2 rounded-brand border border-surface-border p-4 text-sm">
            {order.items.map((item) => (
              <div key={item.id} className="flex justify-between gap-4">
                <dt className="text-content-muted">
                  {item.titleSnapshot}
                  {item.quantity > 1 && ` × ${item.quantity}`}
                </dt>
                <dd className="tabular-nums text-content">
                  {money(item.priceMinor * item.quantity)}
                </dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-surface-border pt-2">
              <dt className="text-content-muted">Subtotal</dt>
              <dd className="tabular-nums text-content">{money(order.subtotalMinor)}</dd>
            </div>
            {order.discountMinor > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-content-muted">
                  Discount{order.coupon ? ` (${order.coupon.code})` : ''}
                </dt>
                <dd className="tabular-nums text-success">−{money(order.discountMinor)}</dd>
              </div>
            )}
            {order.taxMinor > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-content-muted">Tax</dt>
                <dd className="tabular-nums text-content">{money(order.taxMinor)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4 border-t border-surface-border pt-2 font-semibold">
              <dt className="text-content">Total</dt>
              <dd className="tabular-nums text-content">{money(order.totalMinor)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-content-muted">Captured</dt>
              <dd className="tabular-nums text-content">{money(reconciliation.capturedMinor)}</dd>
            </div>
            {reconciliation.refundedMinor > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-content-muted">Refunded</dt>
                <dd className="tabular-nums text-danger">−{money(reconciliation.refundedMinor)}</dd>
              </div>
            )}
          </dl>
        </section>
      </div>

      <section aria-labelledby="payments-heading" className="space-y-3">
        <h2
          id="payments-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Payments
        </h2>

        {order.payments.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            No payment attempts recorded against this order.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">Gateway reference</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Method</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Amount</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Refunded</th>
                  <th scope="col" className="py-2 font-medium">Captured</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {order.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="break-all py-3 pr-4 font-mono text-xs text-content">
                      {payment.gatewayPaymentId}
                    </td>
                    <td className="py-3 pr-4 text-content-muted">{payment.status}</td>
                    <td className="py-3 pr-4 text-content-muted">{payment.method ?? '—'}</td>
                    <td className="py-3 pr-4 tabular-nums text-content">
                      {money(payment.amountMinor)}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-content-muted">
                      {payment.refundedMinor > 0 ? money(payment.refundedMinor) : '—'}
                    </td>
                    <td className="py-3 text-xs text-content-muted">
                      {payment.capturedAt
                        ? formatDateTime(payment.capturedAt, settings.timezone, settings.locale)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {order.installments.length > 0 && (
        <section aria-labelledby="installments-heading" className="space-y-3">
          <h2
            id="installments-heading"
            className="text-sm font-medium uppercase tracking-wide text-content-muted"
          >
            Settles
          </h2>
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {order.installments.map((installment) => (
              <li key={installment.id} className="flex justify-between gap-4 px-4 py-3 text-sm">
                <span className="text-content">
                  {installment.label ?? `Installment ${installment.seq}`}
                </span>
                <span className="tabular-nums text-content-muted">
                  {money(installment.amountMinor)} · {installment.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage && (
        <section aria-labelledby="actions-heading" className="space-y-4">
          <h2
            id="actions-heading"
            className="text-sm font-medium uppercase tracking-wide text-content-muted"
          >
            Actions
          </h2>

          {order.status !== 'PAID' &&
            order.status !== 'REFUNDED' &&
            order.status !== 'PARTIALLY_REFUNDED' && (
              <ManualSettlementForm orderId={order.id} amountLabel={money(order.totalMinor)} />
            )}

          {refundable.length > 0 && (
            <RefundForm
              orderId={order.id}
              payments={refundable.map((payment) => ({
                id: payment.id,
                reference: payment.gatewayPaymentId,
                refundableMinor: payment.amountMinor - payment.refundedMinor,
                refundableLabel: money(payment.amountMinor - payment.refundedMinor),
              }))}
            />
          )}

          <OrderActions
            orderId={order.id}
            cancellable={
              order.status === 'CREATED' || order.status === 'PENDING' || order.status === 'FAILED'
            }
          />
        </section>
      )}
    </div>
  )
}
