/**
 * Pure validation for chat messages and channel metadata.
 *
 * No database access — these are pure rules the server actions call before
 * writing, and the UI calls for inline hints. Keeping them pure means every
 * rule is exhaustively testable without fixtures, mirroring the pattern in
 * ../payments/pricing.ts and ../sessions/schedule.ts.
 *
 * ── WHY BODY IS A SINGLE STRING, NOT BLOCKS ────────────────────────────────
 * A learning community is a chat, not a document editor. The rich-blocks
 * expansion would only buy us markdown rendering for which the protocol
 * surface (paste handling, collaborative editing, mobile keyboard nuances) is a
 * much larger feature than the chat itself. Plain text plus attachments is the
 * 80/20 of every successful cohort chat we modelled on. If a markdown renderer
 * lands later, a `bodyFormat` column with a defaulted migration is the addition.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { slugify } from '@/lib/utils'

export const MAX_MESSAGE_LENGTH = 4000
export const MAX_CHANNEL_NAME_LENGTH = 80
export const MAX_CHANNEL_DESCRIPTION_LENGTH = 280
export const MAX_SLUG_LENGTH = 40
export const MAX_ATTACHMENTS = 5
export const MAX_REPLY_DEPTH = 1

export interface MessageIssue {
  field: 'body' | 'attachments' | 'replyTo'
  message: string
}

/**
 * Validates a message body and attachment list together, because the body may
 * not be empty when there are no attachments, and may be empty when there are.
 */
export function validateMessage(
  input: { body: string; attachmentIds?: readonly string[] },
  options: { hasAttachments?: boolean; replyDepth?: number } = {},
): MessageIssue[] {
  const issues: MessageIssue[] = []
  const body = input.body.trim()
  const hasAttachments = options.hasAttachments ?? false
  const replyDepth = options.replyDepth ?? 0

  if (body.length === 0 && !hasAttachments) {
    issues.push({ field: 'body', message: 'A message must have text or an attachment.' })
  }
  if (body.length > MAX_MESSAGE_LENGTH) {
    issues.push({
      field: 'body',
      message: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
    })
  }
  if (replyDepth > MAX_REPLY_DEPTH) {
    issues.push({
      field: 'replyTo',
      message: 'Replies are one level deep — reply to the original message, not to a reply.',
    })
  }

  const attachmentCount = input.attachmentIds?.length ?? 0
  if (attachmentCount > MAX_ATTACHMENTS) {
    issues.push({
      field: 'attachments',
      message: `A message may have at most ${MAX_ATTACHMENTS} attachments.`,
    })
  }
  // Duplicate attachment ids would let a payload reference the same file twice,
  // which is wasteful and indicates a client bug.
  if (input.attachmentIds) {
    const seen = new Set<string>()
    for (const id of input.attachmentIds) {
      if (seen.has(id)) {
        issues.push({ field: 'attachments', message: 'Duplicate attachment.' })
        break
      }
      seen.add(id)
    }
  }

  return issues
}

/** Summary form returning the first issue, for compact call sites. */
export function firstMessageIssue(
  input: { body: string; attachmentIds?: readonly string[] },
  options: { hasAttachments?: boolean; replyDepth?: number } = {},
): MessageIssue | null {
  return validateMessage(input, options)[0] ?? null
}

export interface ChannelNameIssue {
  field: 'name' | 'slug' | 'description'
  message: string
}

/**
 * Validates a proposed channel slug. A null slug means "derive one from the
 * name" and is always valid as input — the action normalizes it before this
 * runs against a real value.
 */
export function validateChannelSlug(slug: string | null): ChannelNameIssue | null {
  if (slug === null) return null
  if (slug.length === 0) return { field: 'slug', message: 'Slug cannot be empty.' }
  if (slug.length > MAX_SLUG_LENGTH) {
    return { field: 'slug', message: `Slug must be ${MAX_SLUG_LENGTH} characters or fewer.` }
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return {
      field: 'slug',
      message: 'Slug must be lowercase letters, digits and hyphens — and cannot start or end with a hyphen.',
    }
  }
  return null
}

export function validateChannelName(name: string): ChannelNameIssue | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return { field: 'name', message: 'Channel name is required.' }
  if (trimmed.length > MAX_CHANNEL_NAME_LENGTH) {
    return {
      field: 'name',
      message: `Channel name must be ${MAX_CHANNEL_NAME_LENGTH} characters or fewer.`,
    }
  }
  return null
}

export function validateChannelDescription(description: string | null): ChannelNameIssue | null {
  if (!description) return null
  if (description.length > MAX_CHANNEL_DESCRIPTION_LENGTH) {
    return {
      field: 'description',
      message: `Description must be ${MAX_CHANNEL_DESCRIPTION_LENGTH} characters or fewer.`,
    }
  }
  return null
}

/** Normalizes a user-supplied slug, or derives one from the name when null. */
export function deriveSlug(slug: string | null | undefined, name: string): string {
  if (slug && slug.trim().length > 0) return slugify(slug)
  return slugify(name)
}
