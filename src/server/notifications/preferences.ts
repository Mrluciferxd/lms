/**
 * Notification opt-outs.
 *
 * `NotificationPreference` is an opt-out model: the absence of a row means the
 * channel is on. That is the right default for a cohort product, where a student
 * who never opens settings still needs to know their class moved.
 *
 * Split pure-decision / thin-db-wrapper in the manner of ../catalog/access.ts, so
 * the precedence rules are testable without fixtures.
 */

import { db } from '@/server/db'
import type { NotificationChannelType, NotificationTrigger } from '@/generated/prisma/enums'

export interface PreferenceRow {
  channel: NotificationChannelType
  /** Null = applies to every trigger on that channel. */
  trigger: NotificationTrigger | null
  enabled: boolean
}

/**
 * Triggers a recipient cannot mute.
 *
 * Fee reminders are not marketing. They are notice of a payment obligation the
 * academy will later rely on having given — for a suspension, a late fee, or a
 * dispute — and the person with the strongest incentive to silence them is
 * exactly the person who owes the money. Letting the debtor switch off the
 * dunning notices and then claim they were never told is a commercial hole, not
 * a preference.
 *
 * The schema cannot express this: `NotificationPreference` accepts a row for any
 * (channel, trigger) pair, and docs/02-data-model.md records that the constraint
 * is policy rather than schema. This constant is that policy, and the student
 * settings UI must render these as fixed rather than pretending the toggle works.
 *
 * IN_APP is not exempted separately — a mandatory trigger is mandatory on every
 * channel, since muting the inbox copy would defeat the record just as well.
 */
export const MANDATORY_TRIGGERS: readonly NotificationTrigger[] = ['FEE_DUE', 'FEE_OVERDUE']

export function isMandatory(trigger: NotificationTrigger): boolean {
  return MANDATORY_TRIGGERS.includes(trigger)
}

/**
 * Whether one message may go out on one channel.
 *
 * Precedence: a row naming the trigger explicitly beats a channel-wide row, so a
 * student who muted everything on WhatsApp but re-enabled class reminders gets
 * class reminders.
 */
export function isChannelAllowed(
  trigger: NotificationTrigger,
  channel: NotificationChannelType,
  preferences: readonly PreferenceRow[],
): boolean {
  if (isMandatory(trigger)) return true

  const forChannel = preferences.filter((preference) => preference.channel === channel)
  const specific = forChannel.find((preference) => preference.trigger === trigger)
  if (specific) return specific.enabled

  const channelWide = forChannel.find((preference) => preference.trigger === null)
  if (channelWide) return channelWide.enabled

  return true
}

/**
 * Preferences for a batch of recipients, keyed by user.
 *
 * One query for the whole scheduler run: the alternative is a query per
 * recipient, and a class reminder for a 200-student batch would issue 200 of
 * them for a table that is almost always empty.
 */
export async function loadPreferences(
  userIds: readonly string[],
): Promise<Map<string, PreferenceRow[]>> {
  const byUser = new Map<string, PreferenceRow[]>()
  if (userIds.length === 0) return byUser

  const rows = await db.notificationPreference.findMany({
    where: { userId: { in: [...new Set(userIds)] } },
    select: { userId: true, channel: true, trigger: true, enabled: true },
  })

  for (const row of rows) {
    const bucket = byUser.get(row.userId)
    const preference: PreferenceRow = {
      channel: row.channel,
      trigger: row.trigger,
      enabled: row.enabled,
    }
    if (bucket) bucket.push(preference)
    else byUser.set(row.userId, [preference])
  }

  return byUser
}
