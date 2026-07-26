/**
 * Deterministic dedupe keys.
 *
 * `Notification.dedupeKey` is unique, so a key that is a pure function of
 * (rule, anchor, recipient, channel) turns a double send into a no-op insert.
 * This is the property the whole scheduler is built around: the cron will fire
 * twice, a run will overlap its predecessor, a deploy will restart one mid-batch
 * — and the failure mode being defended against is a second WhatsApp message to
 * a paying student, which costs money and reads as incompetence.
 *
 * The key includes the channel, unlike the shorter form in docs/02-data-model.md.
 * One rule fans out to several channels and each is its own `Notification` row,
 * so without the channel the second row's insert would collide with the first
 * and the student would silently lose their email because they got a push.
 *
 * Nothing about the *timing* is in the key. That is deliberate: if an admin moves
 * a class after its reminder has gone out, the rescheduled session does not
 * re-remind. Sending one reminder for a moved class is a smaller failure than
 * sending two, and the admin still has an explicit announcement to hand.
 */

import type { NotificationChannelType } from '@/generated/prisma/enums'
import type { AnchorKind } from './schedule'

export interface DedupeInput {
  ruleId: string
  anchorKind: AnchorKind
  anchorId: string
  userId: string
  channel: NotificationChannelType
}

export function dedupeKey(input: DedupeInput): string {
  return [
    'rule',
    input.ruleId,
    input.anchorKind,
    input.anchorId,
    'user',
    input.userId,
    input.channel,
  ].join(':')
}

/**
 * Key for a send that no rule produced — an admin broadcast, a one-off notice.
 * Callers supply their own scope so two unrelated features cannot collide.
 */
export function adHocDedupeKey(scope: string, subjectId: string, userId: string, channel: NotificationChannelType): string {
  return ['adhoc', scope, subjectId, 'user', userId, channel].join(':')
}
