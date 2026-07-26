'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/server/notifications/actions'

export interface InboxRow {
  id: string
  subject: string | null
  body: string
  actionUrl: string | null
  read: boolean
  /** Pre-formatted in the org timezone by the server. */
  receivedAt: string
  receivedAtIso: string
}

export function NotificationList({
  items,
  hasUnread,
}: {
  items: InboxRow[]
  hasUnread: boolean
}) {
  const router = useRouter()
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await work()
      setNotice(result.ok ? null : (result.error ?? 'Something went wrong.'))
      if (result.ok) router.refresh()
    })
  }

  if (items.length === 0) {
    return (
      <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
        Nothing yet. Class reminders, fee notices and announcements will appear here.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {notice && (
        <p
          role="alert"
          className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {notice}
        </p>
      )}

      {hasUnread && (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run(() => markAllNotificationsRead())}
        >
          Mark all as read
        </Button>
      )}

      <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
        {items.map((item) => (
          <li
            key={item.id}
            className={`px-4 py-3 ${item.read ? '' : 'bg-primary/5 border-l-2 border-l-primary'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {item.subject && (
                  <p className={`text-sm ${item.read ? 'text-content' : 'font-medium text-content'}`}>
                    {item.subject}
                  </p>
                )}
                <p className="mt-1 whitespace-pre-wrap text-sm text-content-muted">{item.body}</p>
                <time
                  dateTime={item.receivedAtIso}
                  className="mt-1.5 block text-xs text-content-muted"
                >
                  {item.receivedAt}
                </time>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {item.actionUrl && (
                  <Link
                    href={item.actionUrl}
                    className="text-sm text-primary underline"
                    // Opening the target is the moment it stops being unread.
                    onClick={() => run(() => markNotificationRead(item.id))}
                  >
                    Open
                  </Link>
                )}
                {!item.read && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    aria-label={`Mark "${item.subject ?? 'notification'}" as read`}
                    onClick={() => run(() => markNotificationRead(item.id))}
                  >
                    Mark read
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
