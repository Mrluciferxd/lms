/**
 * The student's in-app inbox.
 *
 * Every query is scoped by `userId` in its `where`, not filtered after the fact.
 * A notification body can name an amount owed or a batch a student is not in, so
 * a missing scope here leaks between accounts — the same discipline the rest of
 * the product applies to enrollment checks.
 *
 * Only IN_APP rows are inbox items. An EMAIL row is a record of an email, and
 * showing it here would double every message a student receives. And only rows
 * that have actually been delivered are visible: a QUEUED in-app notification is
 * scheduled for later, and rendering it early would let a student read the
 * reminder for a class before the reminder was due to exist.
 */

import { db } from '@/server/db'
import type { NotificationStatus } from '@/generated/prisma/enums'

/** Delivered states. SENT becomes READ once opened; both stay in the list. */
const VISIBLE: NotificationStatus[] = ['SENT', 'READ']

export interface InboxItem {
  id: string
  subject: string | null
  body: string
  actionUrl: string | null
  sentAt: Date | null
  readAt: Date | null
  createdAt: Date
}

export async function listInbox(
  userId: string,
  options: { limit?: number; unreadOnly?: boolean } = {},
): Promise<InboxItem[]> {
  return db.notification.findMany({
    where: {
      userId,
      channel: 'IN_APP',
      status: { in: VISIBLE },
      ...(options.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
    take: Math.min(Math.max(options.limit ?? 50, 1), 200),
    select: {
      id: true,
      subject: true,
      body: true,
      actionUrl: true,
      sentAt: true,
      readAt: true,
      createdAt: true,
    },
  })
}

/** Backs the navigation badge. Uses the `(userId, readAt)` index. */
export async function unreadCount(userId: string): Promise<number> {
  return db.notification.count({
    where: { userId, channel: 'IN_APP', status: { in: VISIBLE }, readAt: null },
  })
}

/**
 * Scoped by user so a guessed id is a no-op rather than a way to mark someone
 * else's notification read.
 */
export async function markRead(userId: string, notificationId: string): Promise<void> {
  await db.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { status: 'READ', readAt: new Date() },
  })
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, channel: 'IN_APP', status: { in: VISIBLE }, readAt: null },
    data: { status: 'READ', readAt: new Date() },
  })
  return result.count
}
