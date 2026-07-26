import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { t } from '@/lib/labels'
import { formatDate, formatDateTime, formatMoney } from '@/lib/utils'
import { requireUser } from '@/server/auth/rbac'
import { db } from '@/server/db'
import { getOrgSettings, isFeatureEnabled } from '@/server/org/settings'
import { listStudentDues } from '@/server/payments/fees'
import { PayInstallmentButton } from './pay-installment-button'

export const metadata: Metadata = { title: 'Billing' }

export default async function BillingPage() {
  const user = await requireUser('/app/billing')

  /**
   * Structural gating, not a hidden link: with both features off there is nothing
   * here to bill for and the route does not exist. The sidebar entry follows
   * `feeInstallments` alone (see src/lib/nav.ts), so a deployment selling one-off
   * courses without installments still reaches this page directly for receipts.
   */
  const [installmentsEnabled, checkoutEnabled] = await Promise.all([
    isFeatureEnabled('feeInstallments'),
    isFeatureEnabled('selfServeCheckout'),
  ])
  if (!installmentsEnabled && !checkoutEnabled) notFound()

  const settings = await getOrgSettings()
  const now = new Date()

  const [dues, orders] = await Promise.all([
    installmentsEnabled ? listStudentDues(user.id) : Promise.resolve([]),
    db.order.findMany({
      where: { userId: user.id, status: { in: ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        number: true,
        status: true,
        totalMinor: true,
        currency: true,
        paidAt: true,
        createdAt: true,
        invoice: { select: { number: true } },
        items: { select: { id: true, titleSnapshot: true } },
      },
    }),
  ])

  const outstandingMinor = dues.reduce((sum, due) => sum + due.amountMinor, 0)

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-content">{t('nav.billing')}</h1>

      {installmentsEnabled && (
        <section aria-labelledby="dues-heading" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2
              id="dues-heading"
              className="text-sm font-medium uppercase tracking-wide text-content-muted"
            >
              {t('fee.due')}
            </h2>
            {outstandingMinor > 0 && (
              <p className="text-sm tabular-nums text-content">
                {formatMoney(outstandingMinor, settings.currency, settings.locale)} outstanding
              </p>
            )}
          </div>

          {dues.length === 0 ? (
            <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
              Nothing due. You are all paid up.
            </p>
          ) : (
            <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
              {dues.map((due) => {
                // Compared here rather than trusting the stored status, which is
                // only refreshed when the overdue job runs.
                const overdue = due.dueDate.getTime() < now.getTime()

                return (
                  <li
                    key={due.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm text-content">
                        {due.label ?? `${t('fee.installment')} ${due.seq}`}
                      </p>
                      <p className="text-xs text-content-muted">{due.courseTitle}</p>
                      <p className={`text-xs ${overdue ? 'text-danger' : 'text-content-muted'}`}>
                        {overdue ? t('fee.overdue') : t('fee.due')}{' '}
                        <time dateTime={due.dueDate.toISOString()}>
                          {formatDate(due.dueDate, settings.timezone, settings.locale)}
                        </time>
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="tabular-nums text-content">
                        {formatMoney(due.amountMinor, due.currency, settings.locale)}
                      </span>
                      {checkoutEnabled && (
                        <PayInstallmentButton
                          installmentId={due.id}
                          label={t('fee.payNow')}
                          studentName={user.name}
                          studentEmail={user.email}
                        />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2
          id="history-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Payment history
        </h2>

        {orders.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            No payments yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">Date</th>
                  <th scope="col" className="py-2 pr-4 font-medium">For</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Invoice</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Amount</th>
                  <th scope="col" className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="py-3 pr-4 text-content-muted">
                      <time dateTime={(order.paidAt ?? order.createdAt).toISOString()}>
                        {formatDateTime(
                          order.paidAt ?? order.createdAt,
                          settings.timezone,
                          settings.locale,
                        )}
                      </time>
                    </td>
                    <td className="py-3 pr-4 text-content">
                      {order.items.map((item) => item.titleSnapshot).join(', ') || order.number}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-content-muted">
                      {order.invoice?.number ?? '—'}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-content">
                      {formatMoney(order.totalMinor, order.currency, settings.locale)}
                    </td>
                    <td className="py-3 text-content-muted">
                      {order.status === 'PAID' ? t('fee.paid') : order.status}
                    </td>
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
