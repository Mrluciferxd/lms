import type { Metadata } from 'next'
import Link from 'next/link'

import { formatDateTime, formatMoney } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { FLAG_DESCRIPTIONS, classifyOrder, type ReconciliationFlag } from '@/server/payments/reconcile'

export const metadata: Metadata = { title: 'Reconciliation' }

/**
 * The month-end question, answered from our own tables rather than from the
 * gateway: did anything get paid without being credited, and is anything credited
 * that nobody paid for?
 *
 * Deliberately local. It keeps working when the gateway is down, when credentials
 * are missing, and for the manual orders that never had a gateway at all —
 * exactly the situations in which somebody actually opens this page.
 */
export default async function ReconciliationPage() {
  await requirePermission('payment:read', '/admin/payments/reconciliation')
  const settings = await getOrgSettings()
  const now = new Date()

  /**
   * Bounded scan rather than a full-table one. Anything anomalous surfaces within
   * days — the webhook either lands or it does not — so the last 500 orders is
   * the window that matters, and an unbounded query here would be the page that
   * gets slower every month until nobody opens it.
   */
  const orders = await db.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      number: true,
      status: true,
      totalMinor: true,
      currency: true,
      createdAt: true,
      gatewayOrderId: true,
      user: { select: { name: true, email: true } },
      payments: { select: { status: true, amountMinor: true, refundedMinor: true } },
    },
  })

  const flagged = orders
    .map((order) => ({ order, result: classifyOrder(order, now) }))
    .filter((row) => row.result.flags.length > 0)

  const unprocessedEvents = await db.webhookEvent.findMany({
    where: { processedAt: null },
    orderBy: { receivedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      gateway: true,
      eventId: true,
      type: true,
      receivedAt: true,
      attempts: true,
      error: true,
    },
  })

  const counts = flagged.reduce<Record<string, number>>((totals, row) => {
    for (const flag of row.result.flags) {
      totals[flag] = (totals[flag] ?? 0) + 1
    }
    return totals
  }, {})

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/admin/payments" className="text-content-muted hover:text-content">
          ← Payments
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold text-content">Reconciliation</h1>
        <p className="mt-1 text-sm text-content-muted">
          Orders whose own payment records disagree with their state, from the last{' '}
          {orders.length} orders.
        </p>
      </div>

      {flagged.length === 0 && unprocessedEvents.length === 0 ? (
        <p className="rounded-brand border border-success/30 bg-success/10 px-4 py-6 text-sm text-success">
          Nothing to reconcile. Every recent order agrees with its payments.
        </p>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(counts) as ReconciliationFlag[]).map((flag) => (
            <div key={flag} className="rounded-brand border border-surface-border p-4">
              <dt className="text-xs uppercase tracking-wide text-content-muted">
                {flag.replace(/_/g, ' ').toLowerCase()}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-content">
                {counts[flag]}
              </dd>
              <p className="mt-1 text-xs text-content-muted">{FLAG_DESCRIPTIONS[flag]}</p>
            </div>
          ))}
        </dl>
      )}

      {flagged.length > 0 && (
        <section aria-labelledby="flagged-heading" className="space-y-3">
          <h2
            id="flagged-heading"
            className="text-sm font-medium uppercase tracking-wide text-content-muted"
          >
            Flagged orders
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">Order</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Student</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Total</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Captured</th>
                  <th scope="col" className="py-2 font-medium">Problem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {flagged.map(({ order, result }) => (
                  <tr key={order.id}>
                    <td className="py-3 pr-4">
                      <Link
                        href={`/admin/payments/${order.id}`}
                        className="font-mono text-xs font-medium text-content hover:text-primary"
                      >
                        {order.number}
                      </Link>
                      <time
                        dateTime={order.createdAt.toISOString()}
                        className="mt-0.5 block text-xs text-content-muted"
                      >
                        {formatDateTime(order.createdAt, settings.timezone, settings.locale)}
                      </time>
                    </td>
                    <td className="py-3 pr-4 text-content-muted">{order.user.email}</td>
                    <td className="py-3 pr-4 text-content-muted">{order.status}</td>
                    <td className="py-3 pr-4 tabular-nums text-content">
                      {formatMoney(order.totalMinor, order.currency, settings.locale)}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-content-muted">
                      {formatMoney(result.capturedMinor, order.currency, settings.locale)}
                    </td>
                    <td className="py-3 text-content">
                      <ul className="space-y-1">
                        {result.flags.map((flag) => (
                          <li key={flag} className="text-xs">
                            {FLAG_DESCRIPTIONS[flag]}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="events-heading" className="space-y-3">
        <h2
          id="events-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Unprocessed webhook events
        </h2>

        {unprocessedEvents.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            Every received event has been handled.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">Event</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Type</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Attempts</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Received</th>
                  <th scope="col" className="py-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {unprocessedEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="break-all py-3 pr-4 font-mono text-xs text-content">
                      {event.eventId}
                    </td>
                    <td className="py-3 pr-4 text-content-muted">{event.type}</td>
                    <td className="py-3 pr-4 tabular-nums text-content-muted">{event.attempts}</td>
                    <td className="py-3 pr-4 text-xs text-content-muted">
                      {formatDateTime(event.receivedAt, settings.timezone, settings.locale)}
                    </td>
                    <td className="py-3 text-xs text-danger">{event.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
