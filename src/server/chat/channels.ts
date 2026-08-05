/**
 * Channel read queries.
 *
 * Reads only — every write goes through ./actions.ts. Separation follows the
 * pattern in ../sessions/attendance.ts: every exported async in a `'use server'`
 * module is a callable endpoint, so report queries that take ids from the caller
 * must not live there.
 *
 * ── INDEXES UNDERLYING THESE QUERIES ────────────────────────────────────────
 * `Channel(type, archivedAt)` carries the channel list prefilter. `Channel(batchId)`
 * carries the batch-channel prefilter. `ChannelMember(userId)` carries the
 * membership prefetch. `Message(channelId, createdAt)` carries the cursor
 * pagination. None of these exist by accident — the schema comment for each
 * names the query path it serves.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { db } from '@/server/db'
import { isStaffRole } from '@/server/auth/roles'
import {
  decideChannelVisibility,
  type ChannelViewer,
  type ChannelVisibilityDecision,
} from './membership'
import type { ChannelType } from '@/generated/prisma/enums'

/** Fields safe to hand to a student-facing surface. */
export interface ViewableChannel {
  id: string
  slug: string
  name: string
  description: string | null
  type: ChannelType
  readOnly: boolean
  isModerated: boolean
  archivedAt: Date | null
  courseId: string | null
  batchId: string | null
  batchName: string | null
  courseTitle: string | null
  memberCount: number
  /** Whether the viewer is an explicit member (TOPIC/DIRECT rooms). */
  isMember: boolean
}

const CHANNEL_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  type: true,
  readOnly: true,
  isModerated: true,
  archivedAt: true,
  courseId: true,
  batchId: true,
  course: { select: { title: true } },
  batch: { select: { name: true } },
  _count: { select: { members: true } },
} as const

interface ChannelRow {
  id: string
  slug: string
  name: string
  description: string | null
  type: ChannelType
  readOnly: boolean
  isModerated: boolean
  archivedAt: Date | null
  courseId: string | null
  batchId: string | null
  course: { title: string } | null
  batch: { name: string } | null
  _count: { members: number }
}

function toViewable(row: ChannelRow, viewer: ChannelViewer): ViewableChannel {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    type: row.type,
    readOnly: row.readOnly,
    isModerated: row.isModerated,
    archivedAt: row.archivedAt,
    courseId: row.courseId,
    batchId: row.batchId,
    batchName: row.batch?.name ?? null,
    courseTitle: row.course?.title ?? null,
    memberCount: row._count.members,
    isMember: viewer.memberChannelIds.includes(row.id),
  }
}

/**
 * Channels a viewer may see. The query is a coarse prefilter — every candidate
 * is re-checked through `decideChannelVisibility`, which is the authority, so
 * the rule has one implementation.
 */
export async function listChannelsForViewer(
  viewer: ChannelViewer,
): Promise<ViewableChannel[]> {
  const staff = isStaffRole(viewer.role)
  const memberChannelIds = [...viewer.memberChannelIds]

  const rows = await db.channel.findMany({
    where: staff
      ? undefined
      : {
          OR: [
            { type: 'GLOBAL' },
            { type: 'ANNOUNCEMENT', courseId: null },
            ...(viewer.courseIds.length > 0
              ? [
                  { type: 'COURSE' as const, courseId: { in: [...viewer.courseIds] } },
                  { type: 'ANNOUNCEMENT' as const, courseId: { in: [...viewer.courseIds] } },
                ]
              : []),
            ...(viewer.batchIds.length > 0
              ? [{ type: 'BATCH' as const, batchId: { in: [...viewer.batchIds] } }]
              : []),
            ...(memberChannelIds.length > 0
              ? [{ id: { in: memberChannelIds } }]
              : []),
          ],
        },
    select: CHANNEL_SELECT,
    orderBy: [{ archivedAt: 'asc' }, { type: 'asc' }, { name: 'asc' }],
  })

  return rows
    .filter((row) => decideChannelVisibility(row, viewer).visible)
    .map((row) => toViewable(row, viewer))
}

export interface ChannelAccessResult {
  decision: ChannelVisibilityDecision
  channel: ViewableChannel | null
}

/** Loads one channel by slug and resolves visibility. Callers 404 on any denial. */
export async function loadChannelForViewer(
  slug: string,
  viewer: ChannelViewer,
): Promise<ChannelAccessResult> {
  const row = await db.channel.findUnique({
    where: { slug },
    select: CHANNEL_SELECT,
  })

  if (!row) {
    return {
      decision: { visible: false, reason: 'NOT_FOUND' },
      channel: null,
    }
  }

  const decision = decideChannelVisibility(row, viewer)
  return {
    decision,
    channel: decision.visible ? toViewable(row, viewer) : null,
  }
}

/** Fields safe to expose on a message. */
export interface ViewableMessage {
  id: string
  body: string
  createdAt: Date
  editedAt: Date | null
  deletedAt: Date | null
  pinned: boolean
  replyToId: string | null
  authorId: string
  authorName: string
  authorAvatarUrl: string | null
  authorRole: string
  attachmentIds: string[]
  reactions: { emoji: string; count: number; reactedByMe: boolean }[]
}

const MESSAGE_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  editedAt: true,
  deletedAt: true,
  pinned: true,
  replyToId: true,
  userId: true,
  attachmentIds: true,
  user: { select: { name: true, avatarUrl: true, role: true } },
  reactions: { select: { emoji: true, userId: true } },
} as const

interface MessageRow {
  id: string
  body: string
  createdAt: Date
  editedAt: Date | null
  deletedAt: Date | null
  pinned: boolean
  replyToId: string | null
  userId: string
  attachmentIds: string[]
  user: { name: string; avatarUrl: string | null; role: string }
  reactions: { emoji: string; userId: string }[]
}

function toViewableMessage(row: MessageRow, viewerId: string): ViewableMessage {
  const counts = new Map<string, { count: number; reactedByMe: boolean }>()
  for (const r of row.reactions) {
    const entry = counts.get(r.emoji) ?? { count: 0, reactedByMe: false }
    entry.count += 1
    if (r.userId === viewerId) entry.reactedByMe = true
    counts.set(r.emoji, entry)
  }

  return {
    id: row.id,
    // Deleted messages keep their place (so a reply thread doesn't renumber)
    // but their body is scrubbed. The deletion is metadata, not text.
    body: row.deletedAt ? '' : row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    pinned: row.pinned,
    replyToId: row.replyToId,
    authorId: row.userId,
    authorName: row.user.name,
    authorAvatarUrl: row.user.avatarUrl,
    authorRole: row.user.role,
    attachmentIds: row.deletedAt ? [] : row.attachmentIds,
    // Fold reactions into the per-emoji summary the UI needs. Sort keeps the
    // order stable across re-renders.
    reactions: [...counts.entries()]
      .map(([emoji, value]) => ({ emoji, count: value.count, reactedByMe: value.reactedByMe }))
      .sort((a, b) => a.emoji.localeCompare(b.emoji)),
  }
}

export interface MessageListOptions {
  /** Cursor on `(createdAt, id)` — the boundary is exclusive. Pass null for the first page. */
  before?: { createdAt: Date; id: string } | null
  /** Page size. Capped at 100. */
  take?: number
}

/** Page of messages in a channel, newest first, pinned messages surfaced. */
export async function listMessages(
  channelId: string,
  viewerId: string,
  options: MessageListOptions = {},
): Promise<{ messages: ViewableMessage[]; hasMore: boolean }> {
  const take = Math.min(Math.max(options.take ?? 50, 1), 100)
  const before = options.before ?? null

  // Pinned messages render at the top regardless of pagination; their existence
  // should not flicker as the user scrolls the history. We fetch them once and
  // then de-duplicate from the chronological page below.
  const [pinnedRows, pageRows] = await Promise.all([
    db.message.findMany({
      where: { channelId, pinned: true, deletedAt: null },
      select: MESSAGE_SELECT,
      orderBy: { createdAt: 'asc' },
    }),
    db.message.findMany({
      where: {
        channelId,
        // Cursor pagination on the compound `(channelId, createdAt)` index. The
        // id is the tiebreak for messages sharing a timestamp (cuidk order is
        // not chronological); it is also the deterministic second sort key.
        ...(before
          ? {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: { equals: before.createdAt }, id: { lt: before.id } },
              ],
            }
          : {}),
      },
      select: MESSAGE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1, // peek one to know whether hasMore is true
    }),
  ])

  const hasMore = pageRows.length > take
  const page = pageRows.slice(0, take)
  const pinnedIds = new Set(pinnedRows.map((row) => row.id))
  const chronological = page.filter((row) => !pinnedIds.has(row.id))
  const all = [...pinnedRows, ...chronological]

  return {
    messages: all.map((row) => toViewableMessage(row, viewerId)),
    hasMore,
  }
}

/** Unread counts per visible channel, in one query against `ChannelMember`. */
export async function unreadCounts(
  viewer: ChannelViewer,
  channels: ViewableChannel[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (channels.length === 0) return result

  const rows = await db.channelMember.findMany({
    where: {
      userId: viewer.id,
      channelId: { in: channels.map((channel) => channel.id) },
    },
    select: { channelId: true, lastReadAt: true },
  })

  const lastReadByChannel = new Map<string, Date | null>()
  for (const row of rows) {
    lastReadByChannel.set(row.channelId, row.lastReadAt)
  }

  // For each visible channel, count messages after `lastReadAt` (or all of them
  // if the viewer has never marked read). Done with one countMany per channel —
  // fused window queries in Prisma are verbose and the per-channel counts are
  // cheap on a single-room academy.
  const counts = await Promise.all(
    channels.map(async (channel) => {
      const lastReadAt = lastReadByChannel.get(channel.id) ?? null
      const count = await db.message.count({
        where: {
          channelId: channel.id,
          deletedAt: null,
          ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        },
      })
      return [channel.id, count] as const
    }),
  )

  for (const [id, count] of counts) result.set(id, count)
  return result
}

/** A single channel's unread count — cheaper than `unreadCounts` for one room. */
export async function unreadCount(channelId: string, viewerId: string): Promise<number> {
  const membership = await db.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId: viewerId } },
    select: { lastReadAt: true },
  })
  const lastReadAt = membership?.lastReadAt ?? null
  return db.message.count({
    where: {
      channelId,
      deletedAt: null,
      ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
    },
  })
}

/** Total unread across all rooms the viewer is a member of — for the nav badge. */
export async function totalUnreadForViewer(viewerId: string): Promise<number> {
  const memberships = await db.channelMember.findMany({
    where: { userId: viewerId, lastReadAt: { not: null } },
    select: { channelId: true, lastReadAt: true },
  })

  if (memberships.length === 0) {
    // No marks: every message in every membership channel is "unread" up to a
    // sensible cap, because the badge is a count not a census. Channels the
    // viewer is a member of but has never opened read as their full message
    // count, which is bounded by the channel being a finite community.
    const channels = await db.channelMember.findMany({
      where: { userId: viewerId },
      select: { channelId: true },
    })
    const counts = await Promise.all(
      channels.map((row) =>
        db.message.count({ where: { channelId: row.channelId, deletedAt: null } }),
      ),
    )
    return counts.reduce((sum, count) => sum + count, 0)
  }

  // The cleanest single query is a raw aggregate; here the per-channel counts
  // are batched because the membership set is small (a user belongs to dozens
  // of rooms at most) and each count hits the same index.
  const counts = await Promise.all(
    memberships.map((row) =>
      db.message.count({
        where: {
          channelId: row.channelId,
          deletedAt: null,
          createdAt: { gt: row.lastReadAt! },
        },
      }),
    ),
  )
  return counts.reduce((sum, count) => sum + count, 0)
}
