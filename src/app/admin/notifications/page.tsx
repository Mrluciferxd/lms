import type { Metadata } from 'next'
import Link from 'next/link'

import { requirePermission } from '@/server/auth/rbac'
import { channelStatuses } from '@/server/notifications/channels'
import { db } from '@/server/db'
import { SCHEDULED_TRIGGERS, isScheduledTrigger } from '@/server/notifications/schedule'
import { RuleControls } from './rule-controls'

export const metadata: Metadata = { title: 'Notifications' }

/** Rendered as prose so an admin reads timing rather than arithmetic. */
function describeOffset(minutes: number): string {
  if (minutes === 0) return 'at the moment it happens'

  const magnitude = Math.abs(minutes)
  const direction = minutes < 0 ? 'before' : 'after'

  if (magnitude % 1440 === 0) {
    const days = magnitude / 1440
    return `${days} day${days === 1 ? '' : 's'} ${direction}`
  }
  if (magnitude % 60 === 0) {
    const hours = magnitude / 60
    return `${hours} hour${hours === 1 ? '' : 's'} ${direction}`
  }
  return `${magnitude} minutes ${direction}`
}

export default async function AdminNotificationsPage() {
  await requirePermission('notification:manage', '/admin/notifications')

  const [rules, templates] = await Promise.all([
    db.notificationRule.findMany({
      orderBy: [{ trigger: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        trigger: true,
        channels: true,
        offsetMinutes: true,
        enabled: true,
        packKey: true,
        template: { select: { id: true, name: true } },
        _count: { select: { notifications: true } },
      },
    }),
    db.notificationTemplate.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        key: true,
        name: true,
        subject: true,
        channels: true,
        packKey: true,
        _count: { select: { rules: true } },
      },
    }),
  ])

  const channels = channelStatuses()

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-content">Notifications</h1>
        <Link href="/admin/notifications/log" className="text-sm text-primary underline">
          Delivery log →
        </Link>
      </div>

      <section aria-labelledby="channels-heading" className="space-y-3">
        <h2
          id="channels-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Channels
        </h2>
        <p className="text-sm text-content-muted">
          Which channels this deployment can send on, from the brand configuration. A channel
          with no provider is not queued at all, so its messages never appear as failures.
        </p>

        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => (
            <li
              key={channel.channel}
              className="rounded-brand border border-surface-border px-3 py-2 text-sm"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium text-content">{channel.channel}</span>
                {channel.available ? (
                  channel.live ? (
                    <span className="rounded bg-success/15 px-2 py-0.5 text-xs text-success">
                      live
                    </span>
                  ) : (
                    <span className="rounded bg-warning/15 px-2 py-0.5 text-xs text-warning">
                      logged only
                    </span>
                  )
                ) : (
                  <span className="rounded bg-surface-muted px-2 py-0.5 text-xs text-content-muted">
                    not configured
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-content-muted">
                {channel.provider ?? 'No provider in brand config'}
                {channel.missingEnv.length > 0 && ` · missing ${channel.missingEnv.join(', ')}`}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-xs text-content-muted">
          &ldquo;Logged only&rdquo; means no provider SDK is wired yet: the message is rendered and
          recorded exactly as it would be sent, and written to the server log instead of to a
          gateway. Nothing reaches a student on those channels.
        </p>
      </section>

      <section aria-labelledby="rules-heading" className="space-y-3">
        <h2
          id="rules-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Rules
        </h2>

        {rules.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            No rules yet. Rules arrive with a vertical pack — run{' '}
            <code className="font-mono">npm run packs:install</code> — or are created here.
          </p>
        ) : (
          <ul className="space-y-3">
            {rules.map((rule) => (
              <li key={rule.id} className="rounded-brand border border-surface-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-content">{rule.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-content-muted">
                      <span className="font-mono">{rule.trigger}</span>
                      <span aria-hidden>·</span>
                      <span>{describeOffset(rule.offsetMinutes)}</span>
                      <span aria-hidden>·</span>
                      <span>{rule.channels.join(', ') || 'no channels'}</span>
                      {rule.packKey && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="rounded bg-surface-muted px-1.5 py-0.5">
                            {rule.packKey} pack
                          </span>
                        </>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-content-muted">
                      Template:{' '}
                      <Link
                        href={`/admin/notifications/templates/${rule.template.id}`}
                        className="text-primary underline"
                      >
                        {rule.template.name}
                      </Link>{' '}
                      · {rule._count.notifications} sent to date
                    </p>
                    {!isScheduledTrigger(rule.trigger) && (
                      <p className="mt-1 text-xs text-warning">
                        This trigger is not evaluated by the scheduler — it fires from the action
                        that causes it, or from the pack that defined it.
                      </p>
                    )}
                  </div>

                  <RuleControls
                    ruleId={rule.id}
                    enabled={rule.enabled}
                    offsetMinutes={rule.offsetMinutes}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-content-muted">
          Scheduler triggers: {SCHEDULED_TRIGGERS.join(', ')}. Each is additionally gated by its
          feature flag, so switching off fee installments stops fee reminders as well as hiding
          the billing page.
        </p>
      </section>

      <section aria-labelledby="templates-heading" className="space-y-3">
        <h2
          id="templates-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Templates
        </h2>

        {templates.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            No templates yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">Template</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Subject</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Channels</th>
                  <th scope="col" className="py-2 font-medium">Rules</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td className="py-3 pr-4">
                      <Link
                        href={`/admin/notifications/templates/${template.id}`}
                        className="font-medium text-content hover:text-primary"
                      >
                        {template.name}
                      </Link>
                      <span className="block font-mono text-xs text-content-muted">
                        {template.key}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-content-muted">{template.subject ?? '—'}</td>
                    <td className="py-3 pr-4 text-content-muted">
                      {template.channels.join(', ') || '—'}
                    </td>
                    <td className="py-3 tabular-nums text-content-muted">
                      {template._count.rules}
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
