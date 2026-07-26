/**
 * Timezone arithmetic for the notification engine.
 *
 * Kept in one module because the scheduler and the renderer need the same
 * answers and must not disagree about them: the scheduler decides that a fee
 * reminder fires on the local day three days before the due date, and the
 * renderer writes "due in 3 days" into the body. If those two computed days
 * differently the message would contradict its own timing.
 *
 * All of it is calendar arithmetic in an explicit zone. Subtracting timestamps
 * and dividing by 86,400,000 is the bug this exists to prevent — it answers
 * "how many 24-hour periods", which is not what "in 3 days" means to a student
 * looking at a calendar.
 */

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const MS_PER_DAY = 86_400_000
const MS_PER_MINUTE = 60_000

/** `2026-08-01` — the local calendar day an instant falls on. */
export function localDayKey(instant: Date, timezone: string): string {
  return formatInTimeZone(instant, timezone, 'yyyy-MM-dd')
}

/** The UTC instant of a local wall-clock hour on a local calendar day. */
export function localTimeToUtc(dayKey: string, hour: number, timezone: string): Date {
  const bounded = Math.min(Math.max(Math.trunc(hour), 0), 23)
  return fromZonedTime(`${dayKey} ${bounded.toString().padStart(2, '0')}:00:00`, timezone)
}

/**
 * Whole calendar days between two instants, in the given zone. Negative when
 * `to` is in the past — which is what makes `fee.daysUntilDue` read as an
 * overdue count without a second field.
 */
export function localDayDiff(from: Date, to: Date, timezone: string): number {
  const fromDay = Date.parse(`${localDayKey(from, timezone)}T00:00:00Z`)
  const toDay = Date.parse(`${localDayKey(to, timezone)}T00:00:00Z`)
  return Math.round((toDay - fromDay) / MS_PER_DAY)
}

/** Whole minutes from `from` to `to`, floored. Negative once `to` has passed. */
export function wholeMinutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_MINUTE)
}
