import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { t } from '@/lib/labels'
import { requireUser } from '@/server/auth/rbac'
import { isFeatureEnabled } from '@/server/org/settings'
import { loadChannelViewer } from '@/server/chat/membership'
import { listChannelsForViewer, unreadCounts } from '@/server/chat/channels'
import type { ChannelType } from '@/generated/prisma/enums'

export const metadata: Metadata = { title: 'Community' }

const TYPE_LABEL: Record<ChannelType, string> = {
  GLOBAL: 'All members',
  COURSE: 'Course',
  BATCH: 'Batch',
  ANNOUNCEMENT: 'Announcement',
  DIRECT: 'Direct',
  TOPIC: 'Topic',
}

export default async function CommunityPage() {
  const user = await requireUser('/app/community')

  // Feature flags gate the route, not only the nav entry.
  if (!(await isFeatureEnabled('chat'))) notFound()

  const viewer = await loadChannelViewer(user.id)
  if (!viewer) notFound()

  const channels = await listChannelsForViewer(viewer)
  const unread = await unreadCounts(viewer, channels)

  const browseable = channels.filter((channel) => !channel.archivedAt)
  const archived = channels.filter((channel) => channel.archivedAt)

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-content">{t('nav.community')}</h1>
          <p className="mt-1 text-sm text-content-muted">
            Channels you can read and post in. Some rooms are tied to your batches and enrollments;
            others you join from here.
          </p>
        </div>
      </header>

      {browseable.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          No channels yet. Ask a staff member to set up your community rooms.
        </p>
      ) : (
        <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
          {browseable.map((channel) => {
            const count = unread.get(channel.id) ?? 0
            return (
              <li key={channel.id}>
                <Link
                  href={`/app/community/${channel.slug}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted"
                >
                  <span className="text-lg" aria-hidden>
                    {channel.readOnly ? '📢' : channel.type === 'DIRECT' ? '✉' : '#'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-content">
                        {channel.name}
                      </span>
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-content-muted">
                        {TYPE_LABEL[channel.type]}
                      </span>
                      {channel.readOnly && (
                        <span className="text-[10px] uppercase tracking-wide text-content-muted">
                          read-only
                        </span>
                      )}
                    </span>
                    {channel.description && (
                      <span className="block truncate text-xs text-content-muted">
                        {channel.description}
                      </span>
                    )}
                    {!channel.isMember && (channel.type === 'TOPIC' || channel.type === 'DIRECT') && (
                      <span className="mt-1 inline-block text-[11px] font-medium text-primary">
                        Join →
                      </span>
                    )}
                  </span>
                  {count > 0 && (
                    <span
                      aria-label={`${count} unread`}
                      className="ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground"
                    >
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {archived.length > 0 && (
        <section aria-labelledby="archived-heading" className="space-y-3">
          <h2
            id="archived-heading"
            className="text-sm font-medium uppercase tracking-wide text-content-muted"
          >
            Archived
          </h2>
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {archived.map((channel) => (
              <li key={channel.id}>
                <Link
                  href={`/app/community/${channel.slug}`}
                  className="flex items-center gap-3 px-4 py-3 text-content-muted hover:bg-surface-muted"
                >
                  <span className="text-lg" aria-hidden>
                    📦
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="truncate text-sm font-medium">{channel.name}</span>
                    <span className="block text-xs">Read-only — archived.</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
