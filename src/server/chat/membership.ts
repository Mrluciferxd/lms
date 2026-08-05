/**
 * Channel membership and visibility.
 *
 * The single decision point for "may this person see / post in / moderate this
 * channel", used by the channel list, the channel view, the composer and the
 * admin moderation console. One function per question with two consumers each is
 * the point: a channel list that hides a room while its detail page still renders
 * the message form is exactly the bug this prevents.
 *
 * Split into pure decisions and thin database wrappers, the way
 * ../sessions/visibility.ts is, so the whole matrix — six channel types, five
 * viewer shapes, staff bypass, archived / read-only / moderated rooms — is
 * testable without fixtures.
 *
 * ── ON `ChannelType.ROLE` ──────────────────────────────────────────────────
 * There is no `ChannelType.ROLE`, but the same intent — "only staff see this" —
 * is expressed by `ANNOUNCEMENT` combined with `readOnly`. That combination is
 * staff-writable, student-readable. A staff-only room (not even readable by
 * students) is a `TOPIC` room an admin simply does not add students to; the
 * roster is the gate, not a visibility mode. Keeping a second mechanism would
 * duplicate intent and force a guess in `decideChannelVisibility`.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { db } from '@/server/db'
import { isStaffRole, roleHasPermission } from '@/server/auth/roles'
import type { ChannelType, Role } from '@/generated/prisma/enums'

export type ChannelDenialReason =
  | 'NOT_FOUND'
  | 'NOT_AUTHENTICATED'
  | 'NOT_ENROLLED'
  | 'NOT_IN_BATCH'
  | 'NOT_A_MEMBER'
  | 'ARCHIVED'
  | 'MISCONFIGURED'

/** How visibility was granted. `MEMBER` means an explicit `ChannelMember` row. */
export type ChannelVisibilityVia = 'PUBLIC' | 'ENROLLED' | 'BATCH' | 'STAFF' | 'MEMBER'

export type ChannelVisibilityDecision =
  | { visible: true; via: ChannelVisibilityVia }
  | { visible: false; reason: ChannelDenialReason; warning?: string }

export interface ChannelSubject {
  type: ChannelType
  /** null on GLOBAL, ANNOUNCEMENT and TOPIC channels with no course scope. */
  courseId: string | null
  /** null unless the channel is scoped to a specific batch. */
  batchId: string | null
  archivedAt: Date | null
}

export interface ChannelViewer {
  id: string
  role: Role
  /** Courses the viewer holds an access-bearing enrollment for. */
  courseIds: readonly string[]
  /** Batches from those same enrollments. */
  batchIds: readonly string[]
  /** Explicit channel memberships (channelId set). */
  memberChannelIds: readonly string[]
}

/**
 * Enrollment states that grant access to course and batch channels. Matches the
 * rule in ../catalog/access.ts: COMPLETED still conveys access, because finishing
 * a course should not evict a student from its community chat.
 */
export const ROSTERED_STATUSES = ['ACTIVE', 'COMPLETED'] as const

/**
 * May the viewer see this channel at all?
 *
 * The prefilter in `listChannelsForViewer` returns candidate rows; this is the
 * authority. Encoding the whole rule in SQL would mean two implementations of
 * one authorization decision, which drift.
 */
export function decideChannelVisibility(
  channel: ChannelSubject & { id: string },
  viewer: ChannelViewer | null,
): ChannelVisibilityDecision {
  // Staff see every room: an instructor moderating, an admin auditing. A hidden
  // moderator-only room is one students were never rostered into, not one staff
  // reach via a different code path.
  if (viewer && isStaffRole(viewer.role)) return { visible: true, via: 'STAFF' }

  if (channel.archivedAt) {
    // Archived rooms are readonly history. Visible to existing members and to
    // staff (handled above); hidden from everyone else so the archive does not
    // clutter the channel list for new students who joined after it closed.
    if (viewer && viewer.memberChannelIds.includes(channel.id)) {
      return { visible: true, via: 'MEMBER' }
    }
    return { visible: false, reason: 'ARCHIVED' }
  }

  switch (channel.type) {
    case 'GLOBAL':
      // Academy-wide. Visible to every signed-in member — including a brand-new
      // student who has not enrolled in anything yet, because the lobby is the
      // one place they should be able to ask a question.
      if (!viewer) return { visible: false, reason: 'NOT_AUTHENTICATED' }
      return { visible: true, via: 'PUBLIC' }

    case 'ANNOUNCEMENT':
      // Read-only broadcast. Visible to every signed-in member (a course-scoped
      // announcement narrows below), writable only by staff — see `canPost`.
      if (!viewer) return { visible: false, reason: 'NOT_AUTHENTICATED' }
      if (channel.courseId === null) return { visible: true, via: 'PUBLIC' }
      if (!viewer) return { visible: false, reason: 'NOT_AUTHENTICATED' }
      return viewer.courseIds.includes(channel.courseId)
        ? { visible: true, via: 'ENROLLED' }
        : { visible: false, reason: 'NOT_ENROLLED' }

    case 'COURSE': {
      if (!viewer) return { visible: false, reason: 'NOT_AUTHENTICATED' }
      if (channel.courseId === null) {
        // A COURSE channel with no course is a packaging bug. Failing closed
        // (hidden) keeps it from broadcasting to everyone by accident.
        return {
          visible: false,
          reason: 'MISCONFIGURED',
          warning: 'COURSE channel has no course attached.',
        }
      }
      return viewer.courseIds.includes(channel.courseId)
        ? { visible: true, via: 'ENROLLED' }
        : { visible: false, reason: 'NOT_ENROLLED' }
    }

    case 'BATCH': {
      if (!viewer) return { visible: false, reason: 'NOT_AUTHENTICATED' }
      if (channel.batchId === null) {
        return {
          visible: false,
          reason: 'MISCONFIGURED',
          warning: 'BATCH channel has no batch attached.',
        }
      }
      return viewer.batchIds.includes(channel.batchId)
        ? { visible: true, via: 'BATCH' }
        : { visible: false, reason: 'NOT_IN_BATCH' }
    }

    case 'TOPIC':
    case 'DIRECT': {
      // Opt-in rooms. Visible only to explicit members; staff bypass above
      // covers moderation. A DIRECT channel is a 1:1/DM; a TOPIC channel is a
      // pack-seeded room like `#market-talk` that students must join (or be
      // added to) before it appears.
      if (!viewer) return { visible: false, reason: 'NOT_AUTHENTICATED' }
      return viewer.memberChannelIds.includes(channel.id)
        ? { visible: true, via: 'MEMBER' }
        : { visible: false, reason: 'NOT_A_MEMBER' }
    }

    default: {
      // Exhaustiveness guard: a new ChannelType fails the build here rather than
      // silently defaulting to visible.
      const exhaustive: never = channel.type
      throw new Error(`Unhandled channel type: ${String(exhaustive)}`)
    }
  }
}

export type PostDenialReason =
  | 'NOT_FOUND'
  | 'NOT_AUTHENTICATED'
  | 'READ_ONLY'
  | 'NOT_A_MEMBER'
  | 'MUTED'
  | 'ARCHIVED'

export type PostDecision =
  | { canPost: true }
  | { canPost: false; reason: PostDenialReason }

/**
 * May the viewer post a message in this channel *right now*?
 *
 * `readOnly` channels (ANNOUNCEMENT) are staff-writable only — the readonly flag
 * is the entire mechanism, not a per-role override. `isModerated` channels
 * accept a student's message but the moderator queue is the UI's concern, not
 * the post-decision's: a moderated room is still a room students post into.
 */
export function canPost(
  channel: ChannelSubject & { id: string; readOnly: boolean },
  viewer: ChannelViewer | null,
  membership: { role: 'MEMBER' | 'MODERATOR'; mutedUntil: Date | null } | null,
  now: Date,
): PostDecision {
  if (!viewer) return { canPost: false, reason: 'NOT_AUTHENTICATED' }
  if (channel.archivedAt) return { canPost: false, reason: 'ARCHIVED' }

  if (channel.readOnly) {
    // Announcement-style: only staff post, students read. A moderator role on
    // a readOnly room is not a thing the seed creates, and letting it write
    // would defeat the read-only semantics.
    return isStaffRole(viewer.role) ? { canPost: true } : { canPost: false, reason: 'READ_ONLY' }
  }

  // Non-readonly rooms require explicit membership for TOPIC/DIRECT; for
  // GLOBAL/COURSE/BATCH the enrollment IS the membership, so a viewer who can
  // see the room can post. Staff bypass covers moderation regardless.
  const isMember =
    viewer.memberChannelIds.includes(channel.id) ||
    channel.type === 'GLOBAL' ||
    (channel.type === 'COURSE' && channel.courseId !== null && viewer.courseIds.includes(channel.courseId)) ||
    (channel.type === 'BATCH' && channel.batchId !== null && viewer.batchIds.includes(channel.batchId)) ||
    (channel.type === 'ANNOUNCEMENT' && (channel.courseId === null || viewer.courseIds.includes(channel.courseId)))

  if (!isMember && !isStaffRole(viewer.role)) {
    return { canPost: false, reason: 'NOT_A_MEMBER' }
  }

  // A muted student can read but not post until the mute expires. Staff are
  // never muted — they are the ones who mute.
  if (membership && !isStaffRole(viewer.role) && membership.mutedUntil && membership.mutedUntil > now) {
    return { canPost: false, reason: 'MUTED' }
  }

  return { canPost: true }
}

/**
 * May the viewer moderate this channel — pin, delete others' messages, mute
 * members? Granted by the `chat:moderate` permission (instructor/admin/owner)
 * OR by holding the MODERATOR role on the channel itself, which lets an admin
 * delegate day-to-day moderation to a trusted student.
 */
export function canModerate(
  viewer: ChannelViewer | null,
  membership: { role: 'MEMBER' | 'MODERATOR' } | null,
): boolean {
  if (!viewer) return false
  if (roleHasPermission(viewer.role, 'chat:moderate')) return true
  return membership?.role === 'MODERATOR'
}

/**
 * The viewer's enrollment footprint and explicit channel memberships, in two
 * queries. Loaded once and reused for every channel on the page — calling per
 * channel would turn a 20-room list into 20 round trips.
 */
export async function loadChannelViewer(viewerId: string | null): Promise<ChannelViewer | null> {
  if (!viewerId) return null

  const user = await db.user.findUnique({
    where: { id: viewerId },
    select: { id: true, role: true, status: true },
  })

  // A suspended account is treated as absent rather than as a viewer.
  if (!user || user.status !== 'ACTIVE') return null

  const [enrollments, memberships] = await Promise.all([
    db.enrollment.findMany({
      where: { userId: user.id, status: { in: [...ROSTERED_STATUSES] } },
      select: { courseId: true, batchId: true },
    }),
    db.channelMember.findMany({
      where: { userId: user.id },
      select: { channelId: true },
    }),
  ])

  return {
    id: user.id,
    role: user.role,
    courseIds: [...new Set(enrollments.map((row) => row.courseId))],
    batchIds: enrollments.flatMap((row) => (row.batchId ? [row.batchId] : [])),
    memberChannelIds: memberships.map((row) => row.channelId),
  }
}
