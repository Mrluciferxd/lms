/**
 * Recurring batch schedules.
 *
 * `Batch.schedule` is JSON, shaped like
 * `{ "rrule": "FREQ=WEEKLY;BYDAY=MO,WE,FR", "startTime": "19:00", "durationMin": 90 }`,
 * and this module turns it into the concrete `LiveSession` rows a cohort's
 * timetable is made of.
 *
 * ── WHY A HAND-WRITTEN SUBSET RATHER THAN A FULL RRULE LIBRARY ───────────────
 * The supported grammar is deliberately tiny: DAILY and WEEKLY, an INTERVAL, a
 * BYDAY list, and an end bound. Anything outside it is REJECTED by name rather
 * than approximated. A recurrence engine that silently ignores the part it does
 * not understand generates a timetable missing every Wednesday, which nobody
 * notices until a cohort turns up to an empty room — an error at parse time is
 * strictly cheaper than a plausible-looking wrong schedule.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Pure: no database, no clock. The window and the timezone are passed in, which
 * is what makes the DST and interval behaviour testable.
 *
 * `startTime` is WALL CLOCK in the org timezone, not UTC. A 19:00 class is 19:00
 * for the students regardless of what the server thinks the hour is, so each
 * occurrence is resolved through the timezone rather than by adding fixed
 * offsets — the arithmetic that quietly moves a class by an hour in any country
 * that observes DST.
 */

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const MS_PER_DAY = 86_400_000

/** Guard against a pathological window scanning years of civil days. */
const MAX_DAYS_SCANNED = 1500

/** Cap on rows one generation run may produce. */
export const MAX_OCCURRENCES = 400

/** iCal weekday codes in `Date.getUTCDay()` order. */
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export interface SessionRecurrence {
  freq: 'DAILY' | 'WEEKLY'
  /** Every n days or n weeks. */
  interval: number
  /** Weekday numbers, `Date.getUTCDay()` convention. Empty for DAILY. */
  byDay: readonly number[]
  /** Stop after n occurrences. */
  count: number | null
  /** Stop after this instant. */
  until: Date | null
  hour: number
  minute: number
  durationMin: number
}

export type ScheduleParse =
  /** No recurring schedule configured — the default `{}`. Not an error. */
  | { status: 'empty' }
  | { status: 'invalid'; error: string }
  | { status: 'valid'; recurrence: SessionRecurrence }

function invalid(error: string): ScheduleParse {
  return { status: 'invalid', error }
}

function readInt(raw: string, min: number, max: number): number | null {
  if (!/^\d{1,4}$/.test(raw)) return null
  const value = Number(raw)
  return value >= min && value <= max ? value : null
}

/** `YYYYMMDD`, the iCal basic form, or a plain ISO date. Interpreted as UTC. */
function parseUntil(raw: string): Date | null {
  const compact = raw.replace(/-/g, '').slice(0, 8)
  if (!/^\d{8}$/.test(compact)) return null
  const year = Number(compact.slice(0, 4))
  const month = Number(compact.slice(4, 6))
  const day = Number(compact.slice(6, 8))
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // End of that day, so UNTIL=20260731 includes the 31st.
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
}

function parseRrule(rrule: string): { ok: true; parts: Map<string, string> } | { ok: false; error: string } {
  const parts = new Map<string, string>()

  for (const segment of rrule.split(';')) {
    const trimmed = segment.trim()
    if (!trimmed) continue

    const separator = trimmed.indexOf('=')
    if (separator < 1) return { ok: false, error: `Could not read "${trimmed}" — expected KEY=VALUE.` }

    const key = trimmed.slice(0, separator).toUpperCase()
    if (parts.has(key)) return { ok: false, error: `${key} appears more than once.` }
    parts.set(key, trimmed.slice(separator + 1).toUpperCase())
  }

  return { ok: true, parts }
}

const SUPPORTED_KEYS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL'])

/**
 * Validates a `Batch.schedule` JSON value into a recurrence, or explains why it
 * cannot. Every rejection names the offending part so an admin can fix it
 * without reading this file.
 */
export function parseSchedule(value: unknown): ScheduleParse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'empty' }
  }

  const record = value as Record<string, unknown>
  const rawRrule = record.rrule
  if (rawRrule === undefined || rawRrule === null || rawRrule === '') return { status: 'empty' }
  if (typeof rawRrule !== 'string' || rawRrule.length > 200) {
    return invalid('rrule must be a short text value, e.g. FREQ=WEEKLY;BYDAY=MO,WE.')
  }

  const startTime = record.startTime
  if (typeof startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
    return invalid('startTime must be a 24-hour time like "19:00".')
  }

  const durationMin = record.durationMin
  if (
    typeof durationMin !== 'number' ||
    !Number.isInteger(durationMin) ||
    durationMin < 5 ||
    durationMin > 1440
  ) {
    return invalid('durationMin must be a whole number of minutes between 5 and 1440.')
  }

  const parsed = parseRrule(rawRrule)
  if (!parsed.ok) return invalid(parsed.error)

  for (const key of parsed.parts.keys()) {
    if (!SUPPORTED_KEYS.has(key)) {
      return invalid(
        `${key} is not supported. This platform generates DAILY and WEEKLY schedules only — add the other sessions by hand.`,
      )
    }
  }

  const freq = parsed.parts.get('FREQ')
  if (freq !== 'DAILY' && freq !== 'WEEKLY') {
    return invalid('FREQ must be DAILY or WEEKLY.')
  }

  const rawInterval = parsed.parts.get('INTERVAL')
  const interval = rawInterval === undefined ? 1 : readInt(rawInterval, 1, 52)
  if (interval === null) return invalid('INTERVAL must be a whole number between 1 and 52.')

  const rawByDay = parsed.parts.get('BYDAY')
  let byDay: number[] = []

  if (freq === 'WEEKLY') {
    if (!rawByDay) return invalid('A weekly schedule needs BYDAY, e.g. BYDAY=MO,WE,FR.')
    for (const code of rawByDay.split(',')) {
      const index = DAY_CODES.indexOf(code.trim() as (typeof DAY_CODES)[number])
      if (index < 0) return invalid(`"${code}" is not a weekday. Use ${DAY_CODES.join(', ')}.`)
      if (!byDay.includes(index)) byDay.push(index)
    }
    byDay = byDay.sort((a, b) => a - b)
  } else if (rawByDay) {
    return invalid('BYDAY only applies to a weekly schedule. Use FREQ=WEEKLY, or drop BYDAY.')
  }

  const rawCount = parsed.parts.get('COUNT')
  const count = rawCount === undefined ? null : readInt(rawCount, 1, MAX_OCCURRENCES)
  if (rawCount !== undefined && count === null) {
    return invalid(`COUNT must be a whole number between 1 and ${MAX_OCCURRENCES}.`)
  }

  const rawUntil = parsed.parts.get('UNTIL')
  const until = rawUntil === undefined ? null : parseUntil(rawUntil)
  if (rawUntil !== undefined && until === null) {
    return invalid('UNTIL must be a date like 20260731.')
  }

  const [hour, minute] = startTime.split(':').map(Number) as [number, number]

  return {
    status: 'valid',
    recurrence: { freq, interval, byDay, count, until, hour, minute, durationMin },
  }
}

export interface OccurrenceWindow {
  /** Inclusive lower bound; also the anchor for INTERVAL counting. */
  from: Date
  /** Inclusive upper bound. */
  to: Date
  /** Org timezone. `startTime` is wall clock here. */
  timezone: string
  limit?: number
}

export interface Occurrence {
  start: Date
  end: Date
}

/** Civil (timezone-free) date, as whole days since the epoch. */
function civilDayNumber(date: Date, timezone: string): number {
  const [year, month, day] = formatInTimeZone(date, timezone, 'yyyy-MM-dd')
    .split('-')
    .map(Number) as [number, number, number]
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

/**
 * Expands a recurrence into concrete instants inside a window.
 *
 * Occurrences are produced by resolving a civil date plus a wall-clock time
 * through the timezone, never by adding a fixed number of milliseconds to the
 * previous one — the latter drifts by an hour across a DST boundary and puts a
 * cohort's class at 18:00 for half the term.
 */
export function generateOccurrences(
  recurrence: SessionRecurrence,
  window: OccurrenceWindow,
): Occurrence[] {
  const limit = Math.min(window.limit ?? MAX_OCCURRENCES, MAX_OCCURRENCES)
  if (limit <= 0 || window.to.getTime() < window.from.getTime()) return []

  const firstDay = civilDayNumber(window.from, window.timezone)
  const lastDay = civilDayNumber(window.to, window.timezone)

  // Weeks are counted from the Monday of the anchor week, so INTERVAL=2 means
  // "alternate weeks" rather than "every 14th day from whenever I pressed the
  // button" — the two differ whenever a schedule names several weekdays.
  const anchorWeekday = new Date(firstDay * MS_PER_DAY).getUTCDay()
  const anchorWeekStart = firstDay - ((anchorWeekday + 6) % 7)

  const occurrences: Occurrence[] = []
  const scanEnd = Math.min(lastDay, firstDay + MAX_DAYS_SCANNED)

  for (let day = firstDay; day <= scanEnd; day += 1) {
    if (occurrences.length >= limit) break
    if (recurrence.count !== null && occurrences.length >= recurrence.count) break

    const civil = new Date(day * MS_PER_DAY)

    if (recurrence.freq === 'WEEKLY') {
      if (!recurrence.byDay.includes(civil.getUTCDay())) continue
      if (Math.floor((day - anchorWeekStart) / 7) % recurrence.interval !== 0) continue
    } else if ((day - firstDay) % recurrence.interval !== 0) {
      continue
    }

    const wallClock = `${civil.getUTCFullYear()}-${pad(civil.getUTCMonth() + 1)}-${pad(
      civil.getUTCDate(),
    )}T${pad(recurrence.hour)}:${pad(recurrence.minute)}:00`

    const start = fromZonedTime(wallClock, window.timezone)

    // The first and last civil days are partial: a 19:00 class on the start date
    // is outside a window that opens at 20:00.
    if (start.getTime() < window.from.getTime()) continue
    if (start.getTime() > window.to.getTime()) break
    if (recurrence.until && start.getTime() > recurrence.until.getTime()) break

    occurrences.push({
      start,
      end: new Date(start.getTime() + recurrence.durationMin * 60_000),
    })
  }

  return occurrences
}

/** Admin-facing summary, e.g. "Every week on Mon, Wed at 19:00 · 90 min". */
export function describeRecurrence(recurrence: SessionRecurrence): string {
  const every =
    recurrence.interval === 1
      ? recurrence.freq === 'WEEKLY'
        ? 'Every week'
        : 'Every day'
      : recurrence.freq === 'WEEKLY'
        ? `Every ${recurrence.interval} weeks`
        : `Every ${recurrence.interval} days`

  const days =
    recurrence.byDay.length > 0
      ? ` on ${recurrence.byDay.map((index) => DAY_NAMES[index]).join(', ')}`
      : ''

  const time = ` at ${pad(recurrence.hour)}:${pad(recurrence.minute)}`
  const bound = recurrence.count !== null ? ` · ${recurrence.count} sessions` : ''

  return `${every}${days}${time} · ${recurrence.durationMin} min${bound}`
}
