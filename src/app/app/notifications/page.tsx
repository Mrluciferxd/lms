import type { Metadata } from 'next'

import { formatDateTime } from '@/lib/utils'
import { requireUser } from '@/server/auth/rbac'
import { listInbox, unreadCount } from '@/server/notifications/inbox'
import { getOrgSettings } from '@/server/org/settings'
import { NotificationList } from './notification-list'

export const metadata: Metadata = { title: 'Notifications' }

export default async function NotificationsPage() {
  const user = await requireUser('/app/notifications')
  const settings = await getOrgSettings()

  const [items, unread] = await Promise.all([
    // Scoped to the caller inside the query, not filtered afterwards.
    listInbox(user.id, { limit: 50 }),
    unreadCount(user.id),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-content">
          Notifications
          {unread > 0 && (
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 align-middle text-xs font-medium text-primary-foreground">
              {unread} unread
            </span>
          )}
        </h1>
      </div>

      <NotificationList
        items={items.map((item) => ({
          id: item.id,
          subject: item.subject,
          body: item.body,
          actionUrl: item.actionUrl,
          read: item.readAt !== null,
          // Formatted server-side in the org timezone, which is the only
          // authority for what time something happened here.
          receivedAt: formatDateTime(
            item.sentAt ?? item.createdAt,
            settings.timezone,
            settings.locale,
          ),
          receivedAtIso: (item.sentAt ?? item.createdAt).toISOString(),
        }))}
        hasUnread={unread > 0}
      />
    </div>
  )
}
