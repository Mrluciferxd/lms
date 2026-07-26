import type { Metadata } from 'next'
import Link from 'next/link'

import { formatDateTime } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { channelStatuses } from '@/server/notifications/channels'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import type { NotificationStatus } from '@/generated/prisma/enums'

export const metadata: Metadata = { title: 'Delivery log' }

const STATUS_STYLES: Record<NotificationStatus, string> = {
  SENT: 'bg-success/15 text-success',
  READ: 'bg-success/15 text-success',
  QUEUED: 'bg-surface-muted text-content-muted',
  SENDING: 'bg-surface-muted text-content-muted',
  FAILED: 'bg-danger/15 text-danger',
  CANCELLED: 'bg-warning/15 text-warning',
}

const PAGE_SIZE = 100

export default async function DeliveryLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  // Staff who chase fees need to see whether a reminder went out, so this is
  // gated on notification:send rather than on the stricter manage permission.
  await requirePermission('notification:send', '/admin/notifications/log')

  const { status } = await searchParams
  const settings = await getOrgSettings()

  const filter: NotificationStatus | undefined =
    status === 'QUEUED' || status === 'SENT' || status === 'FAILED' ? status : undefined

  const [rows, counts] = await Promise.all([
    db.notification.findMany({
      where: filter ? { status: filter } : {},
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      select: {
        id: true,
        channel: true,
        status: true,
        subject: true,
        body: true,
        scheduledFor: true,
        sentAt: true,
        attempts: true,
        error: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        rule: { select: { name: true, trigger: true } },
      },
    }),
    db.notification.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  const loggedOnly = channelStatuses()
    .filter((channel) => channel.available && !channel.live)
    .map((channel) => channel.channel)

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/admin/notifications" className="text-content-muted hover:text-content">
          ← Notifications
        </Link>
      </nav>

      <h1 className="text-2xl font-semibold text-content">Delivery log</h1>

      {loggedOnly.length > 0 && (
        <p className="rounded-brand border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {loggedOnly.join(', ')} have no provider wired on this deployment. A{' '}
          <strong>sent</strong> row on those channels means the message was rendered and written to
          the server log — it did not reach the student.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href="/admin/notifications/log"
          className={`rounded-brand px-2 py-1 ${filter ? 'text-content-muted hover:text-content' : 'bg-surface-muted text-content'}`}
        >
          All
        </Link>
        {(['QUEUED', 'SENT', 'FAILED'] as const).map((value) => (
          <Link
            key={value}
            href={`/admin/notifications/log?status=${value}`}
            className={`rounded-brand px-2 py-1 ${filter === value ? 'bg-surface-muted text-content' : 'text-content-muted hover:text-content'}`}
          >
            {value}
            <span className="ml-1 tabular-nums text-xs text-content-muted">
              {counts.find((count) => count.status === value)?._count._all ?? 0}
            </span>
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          Nothing here yet. The scheduler runs at{' '}
          <code className="font-mono">/api/cron/notifications</code>.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                <th scope="col" className="py-2 pr-4 font-medium">Recipient</th>
                <th scope="col" className="py-2 pr-4 font-medium">Message</th>
                <th scope="col" className="py-2 pr-4 font-medium">Channel</th>
                <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                <th scope="col" className="py-2 pr-4 font-medium">Scheduled</th>
                <th scope="col" className="py-2 font-medium">Sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-3 pr-4">
                    <span className="block text-content">{row.user.name}</span>
                    <span className="block text-xs text-content-muted">{row.user.email ?? '—'}</span>
                  </td>
                  <td className="max-w-sm py-3 pr-4">
                    <span className="block truncate text-content">
                      {row.subject ?? row.body.slice(0, 80)}
                    </span>
                    <span className="block text-xs text-content-muted">
                      {row.rule ? `${row.rule.name} · ${row.rule.trigger}` : 'One-off'}
                    </span>
                    {row.error && (
                      <span className="mt-0.5 block text-xs text-danger">
                        {row.error} (attempt {row.attempts})
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-content-muted">{row.channel}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-xs text-content-muted">
                    {row.scheduledFor
                      ? formatDateTime(row.scheduledFor, settings.timezone, settings.locale)
                      : '—'}
                  </td>
                  <td className="py-3 text-xs text-content-muted">
                    {row.sentAt
                      ? formatDateTime(row.sentAt, settings.timezone, settings.locale)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-content-muted">
        Showing the {PAGE_SIZE} most recent, in {settings.timezone}.
      </p>
    </div>
  )
}
