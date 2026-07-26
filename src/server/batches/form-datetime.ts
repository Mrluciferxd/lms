/**
 * Wall-clock values for `<input type="date">` and `<input type="datetime-local">`.
 *
 * Both inputs are zone-less: they show and submit whatever wall clock they are
 * given. Rendering a stored instant with `toISOString().slice(0, 16)` therefore
 * shows the admin the UTC hour and, once saved, moves the class — a 19:00 IST
 * session round-trips into 13:30 after two edits.
 *
 * So the round trip is closed here: render through the org timezone, and parse
 * back through it in the actions.
 */

import { formatInTimeZone } from 'date-fns-tz'

/** `YYYY-MM-DDTHH:mm` in the org timezone. */
export function toLocalDateTimeInput(date: Date | null, timezone: string): string {
  if (!date) return ''
  return formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm")
}

/** `YYYY-MM-DD` in the org timezone. */
export function toLocalDateInput(date: Date | null, timezone: string): string {
  if (!date) return ''
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd')
}
