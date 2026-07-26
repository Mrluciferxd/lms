import type { Metadata } from 'next'
import Link from 'next/link'

import { t } from '@/lib/labels'
import { formatDateTime, formatMoney } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { roleHasPermission } from '@/server/auth/roles'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { outstandingDuesMinor } from '@/server/payments/fees'
import { OrderFilters } from './order-filters'
import { RefreshOverdueButton } from './refresh-overdue-button'
import type { OrderStatus } from '@/generated/prisma/enums'

export const metadata: Metadata = { title: 'Payments' }

/** Statuses the filter offers, in the order an operator scans for them. */
const STATUSES: readonly OrderStatus[] = [
  'PAID',
  'PENDING',
  'CREATED',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'CANCELLED',
]

const STATUS_STYLES: Record<OrderStatus, string> = {
  PAID: 'bg-success/15 text-success',
  PENDING: 'bg-warning/15 text-warning',
  CREATED: 'bg-surface-muted text-content-muted',
  FAILED: 'bg-danger/15 text-danger',
  REFUNDED: 'bg-surface-muted text-content-muted',
  PARTIALLY_REFUNDED: 'bg-warning/15 text-warning',
  CANCELLED: 'bg-surface-muted text-content-muted',
}

const PAGE_SIZE = 50

function parseStatus(value: string | undefined): OrderStatus | null {
  return value && (STATUSES as readonly string[]).includes(value) ? (value as OrderStatus) : null
}

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requirePermission('payment:read', '/admin/payments')
  const settings = await getOrgSettings()
  const params = await searchParams

  const status = parseStatus(typeof params.status === 'string' ? params.status : undefined)
  const query = typeof params.q === 'string' ? params.q.trim() : ''
  const page = Math.max(1, Number(typeof params.page === 'string' ? params.page : 1) || 1)

  /**
   * Search covers the two things an operator has in front of them when a student
   * calls: an order number off an invoice, or the student's own email.
   */
  const where = {
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { number: { contains: query, mode: 'insensitive' as const } },
            { gatewayOrderId: { contains: query, mode: 'insensitive' as const } },
            { user: { email: { contains: query, mode: 'insensitive' as const } } },
            { user: { name: { contains: query, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }

  const [orders, total, capturedAggregate, refundedAggregate, duesMinor] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        number: true,
        status: true,
        totalMinor: true,
        currency: true,
        createdAt: true,
        paidAt: true,
        user: { select: { name: true, email: true } },
        coupon: { select: { code: true } },
        invoice: { select: { number: true } },
        items: { select: { titleSnapshot: true } },
      },
    }),
    db.order.count({ where }),
    db.payment.aggregate({ where: { status: 'CAPTURED' }, _sum: { amountMinor: true } }),
    db.payment.aggregate({ _sum: { refundedMinor: true } }),
    outstandingDuesMinor(),
  ])

  const capturedMinor = capturedAggregate._sum.amountMinor ?? 0
  const refundedMinor = refundedAggregate._sum.refundedMinor ?? 0
  const canManage = roleHasPermission(user.role, 'payment:manage')
  const canManageFees = roleHasPermission(user.role, 'fee:manage')
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const tiles = [
    { label: 'Captured', value: formatMoney(capturedMinor, settings.currency, settings.locale) },
    { label: 'Refunded', value: formatMoney(refundedMinor, settings.currency, settings.locale) },
    {
      label: 'Net',
      value: formatMoney(capturedMinor - refundedMinor, settings.currency, settings.locale),
    },
    {
      label: 'Outstanding dues',
      value: formatMoney(duesMinor, settings.currency, settings.locale),
    },
  ]

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-content">{t('nav.payments')}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin/payments/reconciliation" className="text-sm text-primary underline">
            Reconciliation
          </Link>
          {canManage && (
            <Link href="/admin/coupons" className="text-sm text-primary underline">
              Coupons
            </Link>
          )}
          {canManageFees && <RefreshOverdueButton />}
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-brand border border-surface-border p-4">
            <dt className="text-xs uppercase tracking-wide text-content-muted">{tile.label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-content">{tile.value}</dd>
          </div>
        ))}
      </dl>

      <OrderFilters statuses={[...STATUSES]} status={status} query={query} />

      {orders.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          No orders match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                <th scope="col" className="py-2 pr-4 font-medium">Order</th>
                <th scope="col" className="py-2 pr-4 font-medium">Student</th>
                <th scope="col" className="py-2 pr-4 font-medium">Items</th>
                <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                <th scope="col" className="py-2 pr-4 font-medium">Total</th>
                <th scope="col" className="py-2 pr-4 font-medium">Invoice</th>
                <th scope="col" className="py-2 font-medium">Placed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="py-3 pr-4">
                    <Link
                      href={`/admin/payments/${order.id}`}
                      className="font-mono text-xs font-medium text-content hover:text-primary"
                    >
                      {order.number}
                    </Link>
                    {order.coupon && (
                      <span className="mt-0.5 block text-xs text-content-muted">
                        {order.coupon.code}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="block text-content">{order.user.name}</span>
                    <span className="block text-xs text-content-muted">{order.user.email}</span>
                  </td>
                  <td className="py-3 pr-4 text-content-muted">
                    {order.items.map((item) => item.titleSnapshot).join(', ') || '—'}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[order.status]}`}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-content">
                    {formatMoney(order.totalMinor, order.currency, settings.locale)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-content-muted">
                    {order.invoice?.number ?? '—'}
                  </td>
                  <td className="py-3 text-xs text-content-muted">
                    <time dateTime={order.createdAt.toISOString()}>
                      {formatDateTime(order.createdAt, settings.timezone, settings.locale)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-4 text-sm">
          {page > 1 && (
            <Link
              href={{ pathname: '/admin/payments', query: { ...params, page: page - 1 } }}
              className="text-primary underline"
            >
              ← Previous
            </Link>
          )}
          <span className="text-content-muted">
            Page {page} of {pages} · {total} orders
          </span>
          {page < pages && (
            <Link
              href={{ pathname: '/admin/payments', query: { ...params, page: page + 1 } }}
              className="text-primary underline"
            >
              Next →
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}
