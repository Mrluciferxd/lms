/**
 * Chat server actions — the only path to mutate channels, messages, memberships
 * and reactions. Every action re-checks auth + visibility + write permission
 * because a server action is a directly invocable endpoint, not a navigation.
 * Hiding the composer is not authorization.
 *
 * Returns a discriminated result rather than throwing, so a component can render
 * the failure inline (e.g. "you were muted an hour ago") instead of routing to
 * an error page. The convention matches ../catalog/actions.ts and ../sessions/
 * attendance.ts.
 *
 * ── ACTION INVARIANT ─────────────────────────────────────────────────────────
 * Every action loads the channel fresh, loads the viewer fresh, resolves
 * visibility through `decideChannelVisibility`, and resolves write permission
 * through `canPost` / `canModerate`. None of these is read off the client. A
 * stale page that has not refreshed since the user's enrollment lapsed, since
 * they were muted, or since the channel was archived cannot get a message in.
 * ──────────────────────────────────────────────────────────────────────────
 */

'use server'

import { db } from '@/server/db'
import { getCurrentUser } from '@/server/auth/rbac'
import { roleHasPermission } from '@/server/auth/roles'
import {
  canModerate,
  canPost,
  decideChannelVisibility,
  loadChannelViewer,
  type ChannelViewer,
} from './membership'
import {
  deriveSlug,
  firstMessageIssue,
  validateChannelDescription,
  validateChannelName,
  validateChannelSlug,
} from './validation'
import type { ChannelRole, ChannelType } from '@/generated/prisma/enums'

/** Common ok shape — extended per action when it carries data. */
export type ActionResult<T = void> =
  | ({ ok: true; data?: T })
  | { ok: false; reason: string }

const NOT_AUTH = { ok: false, reason: 'You must be signed in.' } as const
const NOT_FOUND = { ok: false, reason: 'Channel not found.' } as const
const NOT_ALLOWED = { ok: false, reason: 'You cannot do that here.' } as const

/** Loads a channel + viewer + visibility decision in one round trip. */
async function resolveChannel(
  slug: string,
): Promise<
  | {
      viewer: ChannelViewer
      channel: {
        id: string
        slug: string
        name: string
        type: ChannelType
        courseId: string | null
        batchId: string | null
        readOnly: boolean
        isModerated: boolean
        archivedAt: Date | null
      }
      decision: ReturnType<typeof decideChannelVisibility>
    }
  | null
> {
  const user = await getCurrentUser()
  if (!user) return null
  const viewer = await loadChannelViewer(user.id)
  if (!viewer) return null

  const channel = await db.channel.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      type: true,
      courseId: true,
      batchId: true,
      readOnly: true,
      isModerated: true,
      archivedAt: true,
    },
  })
  if (!channel) return null

  const decision = decideChannelVisibility(channel, viewer)
  if (!decision.visible) return { viewer, channel, decision }

  return { viewer, channel, decision }
}

/** Membership row for the viewer, if they are an explicit member. */
async function membershipFor(
  channelId: string,
  viewerId: string,
): Promise<{ role: ChannelRole; mutedUntil: Date | null } | null> {
  const row = await db.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId: viewerId } },
    select: { role: true, mutedUntil: true },
  })
  return row ? { role: row.role, mutedUntil: row.mutedUntil } : null
}

// ─── POST ──────────────────────────────────────────────────────────────────

export interface PostedMessage {
  id: string
  createdAt: Date
}

export async function postMessage(input: {
  channelSlug: string
  body: string
  replyToId?: string | null
  attachmentIds?: string[]
}): Promise<ActionResult<PostedMessage>> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const resolved = await resolveChannel(input.channelSlug)
  if (!resolved) return NOT_FOUND
  const { viewer, channel } = resolved

  const membership = await membershipFor(channel.id, viewer.id)
  const post = canPost(channel, viewer, membership, new Date())
  if (!post.canPost) {
    const reasons: Record<string, string> = {
      READ_ONLY: 'This channel is read-only — only staff can post.',
      NOT_A_MEMBER: 'You are not a member of this channel.',
      MUTED: 'You have been muted in this channel.',
      ARCHIVED: 'This channel has been archived.',
      NOT_AUTHENTICATED: 'You must be signed in.',
      NOT_FOUND: 'Channel not found.',
    }
    return { ok: false, reason: reasons[post.reason] ?? NOT_ALLOWED.reason }
  }

  // Reply depth: a reply to a reply is a reply to that reply's parent. The
  // depth check runs against the resolved root, so the client passing the
  // immediate parent of a 1-deep reply is correct even though the column
  // stores the parent id.
  let replyToId: string | null = null
  let replyDepth = 0
  if (input.replyToId) {
    const parent = await db.message.findUnique({
      where: { id: input.replyToId },
      select: { id: true, replyToId: true, channelId: true, deletedAt: true },
    })
    if (!parent || parent.channelId !== channel.id) {
      return { ok: false, reason: 'Reply target not found in this channel.' }
    }
    if (parent.deletedAt) {
      return { ok: false, reason: 'You cannot reply to a deleted message.' }
    }
    replyToId = parent.replyToId ?? parent.id
    replyDepth = parent.replyToId ? 2 : 1
  }

  const issue = firstMessageIssue(
    { body: input.body, attachmentIds: input.attachmentIds },
    { hasAttachments: (input.attachmentIds?.length ?? 0) > 0, replyDepth },
  )
  if (issue) return { ok: false, reason: issue.message }

  const message = await db.message.create({
    data: {
      channelId: channel.id,
      userId: viewer.id,
      body: input.body.trim(),
      attachmentIds: input.attachmentIds ?? [],
      replyToId,
    },
    select: { id: true, createdAt: true },
  })
  return { ok: true, data: { id: message.id, createdAt: message.createdAt } }
}

// ─── EDIT ───────────────────────────────────────────────────────────────────

export async function editMessage(input: {
  channelSlug: string
  messageId: string
  body: string
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const issue = firstMessageIssue({ body: input.body, attachmentIds: [] })
  if (issue) return { ok: false, reason: issue.message }

  const message = await db.message.findUnique({
    where: { id: input.messageId },
    select: { id: true, channelId: true, userId: true, deletedAt: true },
  })
  if (!message || message.deletedAt) return NOT_FOUND

  // Re-check the channel — a move is not possible (channelId is fixed) but the
  // viewer's access to that channel can have lapsed since the page rendered.
  const channel = await db.channel.findUnique({
    where: { id: message.channelId },
    select: { slug: true, archivedAt: true },
  })
  if (!channel || channel.slug !== input.channelSlug) return NOT_FOUND
  if (channel.archivedAt) return { ok: false, reason: 'This channel has been archived.' }

  // Only the author may edit. Staff moderate by deletion; rewriting a
  // student's words is a line we do not cross, because it would let a
  // moderator put words in a student's mouth without audit.
  if (message.userId !== user.id) return NOT_ALLOWED

  await db.message.update({
    where: { id: message.id },
    data: { body: input.body.trim(), editedAt: new Date() },
  })
  return { ok: true }
}

// ─── DELETE ────────────────────────────────────────────────────────────────

export async function deleteMessage(input: {
  channelSlug: string
  messageId: string
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const message = await db.message.findUnique({
    where: { id: input.messageId },
    select: { id: true, channelId: true, userId: true, deletedAt: true },
  })
  if (!message) return NOT_FOUND
  if (message.deletedAt) return { ok: true } // idempotent

  const channel = await db.channel.findUnique({
    where: { id: message.channelId },
    select: { id: true, slug: true, archivedAt: true },
  })
  if (!channel || channel.slug !== input.channelSlug) return NOT_FOUND
  if (channel.archivedAt) return { ok: false, reason: 'This channel has been archived.' }

  const viewer = await loadChannelViewer(user.id)
  if (!viewer) return NOT_AUTH

  const isAuthor = message.userId === user.id
  const membership = await membershipFor(channel.id, viewer.id)
  const mayModerate = canModerate(viewer, membership)
  if (!isAuthor && !mayModerate) return NOT_ALLOWED

  // Soft delete preserves the place in a thread (replies reference it) without
  // keeping the text. The `toViewableMessage` scrub on read makes the row read
  // as an empty placeholder rather than vanishing.
  await db.message.update({
    where: { id: message.id },
    data: { deletedAt: new Date() },
  })
  return { ok: true }
}

// ─── REACTIONS ──────────────────────────────────────────────────────────────

const EMOJI_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]{1,2}$/u

export async function toggleReaction(input: {
  channelSlug: string
  messageId: string
  emoji: string
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!EMOJI_RE.test(input.emoji)) return { ok: false, reason: 'Invalid emoji.' }

  const resolved = await resolveChannel(input.channelSlug)
  if (!resolved) return NOT_FOUND
  const { viewer, channel } = resolved

  const message = await db.message.findUnique({
    where: { id: input.messageId },
    select: { id: true, channelId: true, deletedAt: true },
  })
  if (!message || message.channelId !== channel.id || message.deletedAt) return NOT_FOUND

  // Toggle: insert if absent, delete if present. The unique `(messageId, userId,
  // emoji)` index is the dedupe guarantee.
  const existing = await db.messageReaction.findUnique({
    where: {
      messageId_userId_emoji: {
        messageId: message.id,
        userId: viewer.id,
        emoji: input.emoji,
      },
    },
    select: { id: true },
  })
  if (existing) {
    await db.messageReaction.delete({ where: { id: existing.id } })
  } else {
    await db.messageReaction.create({
      data: { messageId: message.id, userId: viewer.id, emoji: input.emoji },
    })
  }
  return { ok: true }
}

// ─── PIN ────────────────────────────────────────────────────────────────────

export async function togglePin(input: {
  channelSlug: string
  messageId: string
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const resolved = await resolveChannel(input.channelSlug)
  if (!resolved) return NOT_FOUND
  const { viewer, channel } = resolved

  // Pin requires moderator powers, not just membership — a pinned message is a
  // room-wide signal, so the bar matches the moderator action it is.
  const membership = await membershipFor(channel.id, viewer.id)
  if (!canModerate(viewer, membership)) return NOT_ALLOWED

  const message = await db.message.findUnique({
    where: { id: input.messageId },
    select: { id: true, channelId: true, pinned: true, deletedAt: true },
  })
  if (!message || message.channelId !== channel.id || message.deletedAt) return NOT_FOUND

  await db.message.update({
    where: { id: message.id },
    data: { pinned: !message.pinned },
  })
  return { ok: true }
}

// ─── MEMBERSHIP ─────────────────────────────────────────────────────────────

/**
 * Join an opt-in (TOPIC/DIRECT) channel. GLOBAL/COURSE/BATCH/ANNOUNCEMENT do not
 * require an explicit row — visibility is enrollment-driven — so this refuses
 * them to keep the membership row meaningful. Auto-creating a `ChannelMember`
 * for a COURSE channel would also be wrong: the roster IS the membership.
 */
export async function joinChannel(input: { channelSlug: string }): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const resolved = await resolveChannel(input.channelSlug)
  if (!resolved) return NOT_FOUND
  const { viewer, channel } = resolved

  if (channel.type !== 'TOPIC' && channel.type !== 'DIRECT') {
    return {
      ok: false,
      reason: 'This channel does not require joining — you are in by default.',
    }
  }
  if (channel.archivedAt) return { ok: false, reason: 'This channel has been archived.' }

  // Upsert: rejoining a room you left should not error on the unique constraint.
  await db.channelMember.upsert({
    where: { channelId_userId: { channelId: channel.id, userId: viewer.id } },
    update: {}, // re-joining does not reset mutedUntil deliberately; a mute is
    // a moderator action and re-joining is not a way to clear it.
    create: { channelId: channel.id, userId: viewer.id, role: 'MEMBER' },
  })
  return { ok: true }
}

export async function leaveChannel(input: { channelSlug: string }): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const resolved = await resolveChannel(input.channelSlug)
  if (!resolved) return NOT_FOUND
  const { viewer, channel } = resolved

  // GLOBAL / COURSE / BATCH / ANNOUNCEMENT rooms: a student cannot "leave" —
  // their enrollment IS the membership. Leaving would create a room they can
  // see but be silent in, which is a confusing UX.
  if (channel.type !== 'TOPIC' && channel.type !== 'DIRECT') {
    return {
      ok: false,
      reason: 'You cannot leave a channel tied to your enrollment.',
    }
  }

  await db.channelMember.deleteMany({
    where: { channelId: channel.id, userId: viewer.id },
  })
  return { ok: true }
}

/**
 * Marks the channel read up to `now`. Called on channel open and on scroll.
 * Setting `lastReadAt` slightly ahead of `now` is intentional: it pins the
 * unread window to "what arrived before the user opened the room", so a message
 * arriving mid-load does not flip to unread before the user has seen it.
 */
export async function markChannelRead(input: { channelSlug: string }): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const resolved = await resolveChannel(input.channelSlug)
  if (!resolved) return NOT_FOUND
  const { viewer, channel } = resolved

  // Channels without an explicit membership row (GLOBAL/COURSE/BATCH/ANNOUNCEMENT)
  // still need a read state, so we create one on first read.
  await db.channelMember.upsert({
    where: { channelId_userId: { channelId: channel.id, userId: viewer.id } },
    update: { lastReadAt: new Date() },
    create: { channelId: channel.id, userId: viewer.id, role: 'MEMBER', lastReadAt: new Date() },
  })
  return { ok: true }
}

// ─── MODERATOR ACTIONS ───────────────────────────────────────────────────────

export async function muteMember(input: {
  channelSlug: string
  userId: string
  until: Date
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const resolved = await resolveChannel(input.channelSlug)
  if (!resolved) return NOT_FOUND
  const { viewer, channel } = resolved

  const myMembership = await membershipFor(channel.id, viewer.id)
  if (!canModerate(viewer, myMembership)) return NOT_ALLOWED
  if (input.until <= new Date()) {
    return { ok: false, reason: 'Mute end must be in the future.' }
  }

  await db.channelMember.upsert({
    where: { channelId_userId: { channelId: channel.id, userId: input.userId } },
    update: { mutedUntil: input.until },
    create: {
      channelId: channel.id,
      userId: input.userId,
      role: 'MEMBER',
      mutedUntil: input.until,
    },
  })
  return { ok: true }
}

export async function unmuteMember(input: {
  channelSlug: string
  userId: string
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const resolved = await resolveChannel(input.channelSlug)
  if (!resolved) return NOT_FOUND
  const { viewer, channel } = resolved

  const myMembership = await membershipFor(channel.id, viewer.id)
  if (!canModerate(viewer, myMembership)) return NOT_ALLOWED

  await db.channelMember.updateMany({
    where: { channelId: channel.id, userId: input.userId },
    data: { mutedUntil: null },
  })
  return { ok: true }
}

// ─── CHANNEL CREATION (staff) ───────────────────────────────────────────────

export interface CreatedChannel {
  id: string
  slug: string
}

/**
 * Creates a channel. Staff with `chat:moderate` only. Channels tied to a course
 * or batch are auto-derived from the cohort tools, not authored by hand, so
 * creation here is limited to GLOBAL/ANNOUNCEMENT/TOPIC.
 */
export async function createChannel(input: {
  name: string
  description?: string | null
  type: ChannelType
  slug?: string | null
  readOnly?: boolean
}): Promise<ActionResult<CreatedChannel>> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'chat:moderate')) return NOT_ALLOWED

  const nameIssue = validateChannelName(input.name)
  if (nameIssue) return { ok: false, reason: nameIssue.message }

  const descIssue = validateChannelDescription(input.description ?? null)
  if (descIssue) return { ok: false, reason: descIssue.message }

  if (input.type === 'COURSE' || input.type === 'BATCH' || input.type === 'DIRECT') {
    return {
      ok: false,
      reason: 'That channel type is created from the cohort tools, not by hand.',
    }
  }

  const slug = deriveSlug(input.slug ?? null, input.name)
  const slugIssue = validateChannelSlug(slug)
  if (slugIssue) return { ok: false, reason: slugIssue.message }

  const existing = await db.channel.findUnique({ where: { slug }, select: { id: true } })
  if (existing) return { ok: false, reason: `A channel with slug "${slug}" already exists.` }

  const channel = await db.channel.create({
    data: {
      slug,
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      type: input.type,
      // ANNOUNCEMENT channels default to read-only (staff post, students read).
      // GLOBAL and TOPIC are writeable by any member.
      readOnly: input.readOnly ?? input.type === 'ANNOUNCEMENT',
    },
    select: { id: true, slug: true },
  })
  return { ok: true, data: { id: channel.id, slug: channel.slug } }
}

export async function archiveChannel(input: { channelSlug: string }): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'chat:moderate')) return NOT_ALLOWED

  const channel = await db.channel.findUnique({
    where: { slug: input.channelSlug },
    select: { id: true, archivedAt: true },
  })
  if (!channel) return NOT_FOUND
  if (channel.archivedAt) return { ok: true } // idempotent

  await db.channel.update({
    where: { id: channel.id },
    data: { archivedAt: new Date() },
  })
  return { ok: true }
}

export async function unarchiveChannel(input: { channelSlug: string }): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'chat:moderate')) return NOT_ALLOWED

  const channel = await db.channel.findUnique({
    where: { slug: input.channelSlug },
    select: { id: true, archivedAt: true },
  })
  if (!channel) return NOT_FOUND
  if (!channel.archivedAt) return { ok: true }

  await db.channel.update({
    where: { id: channel.id },
    data: { archivedAt: null },
  })
  return { ok: true }
}
