/**
 * Installment plan generation.
 *
 * Pure. Two things have to be exactly right and both are easy to get subtly
 * wrong, so both live here with their own tests:
 *
 *  1. **The split adds up.** Three installments of a ₹10,000.01 fee are not
 *     ₹3,333.33 each. The remainder is distributed rather than lost, and the
 *     invariant `sum(installments) === total` holds for every input.
 *
 *  2. **The dates step in the org timezone, not UTC.** A fee due on 31 January
 *     in Asia/Kolkata is stored as 2026-01-30T18:30:00Z. Adding a month to that
 *     instant in UTC lands on 2026-02-28T18:30:00Z, which renders as 1 March in
 *     the org timezone — the student is told they are a day later than they are,
 *     and the overdue job agrees with the wrong date. So the arithmetic
 *     decomposes into the org timezone's calendar, steps there, and recomposes.
 *
 * The zone helpers below are local to payments on purpose; if a second domain
 * needs calendar arithmetic they should move to src/lib, which is not this
 * module's to edit.
 */

export type FeeCadence = 'MONTHLY' | 'FORTNIGHTLY' | 'WEEKLY'

export interface ZonedParts {
  year: number
  /** 1-12, unlike Date's 0-11. */
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export interface PlannedInstallment {
  seq: number
  amountMinor: number
  dueDate: Date
}

export interface InstallmentPlanInput {
  totalMinor: number
  count: number
  /** Due date of the first installment; every later one steps from this. */
  firstDueDate: Date
  cadence: FeeCadence
  /** OrgSettings.timezone. The calendar the steps happen in. */
  timezone: string
}

/** Intl formatters are expensive to construct and this runs per installment. */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = FORMATTERS.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      // `hourCycle: 'h23'` rather than `hour12: false`, which renders midnight as
      // "24" on some ICU versions and would push every date a day forward.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    FORMATTERS.set(timezone, formatter)
  }
  return formatter
}

/** Wall-clock fields of an instant, as read in `timezone`. */
export function zonedParts(timezone: string, instant: Date): ZonedParts {
  const parts = formatterFor(timezone).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      throw new RangeError(`Could not read ${type} for timezone "${timezone}".`)
    }
    return parsed
  }

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Defensive modulo: see the hourCycle note above.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  }
}

/** The zone's UTC offset in milliseconds at a given instant. */
export function zoneOffsetMs(timezone: string, instant: Date): number {
  const parts = zonedParts(timezone, instant)
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  // The formatter drops sub-second precision, so floor the instant to the second
  // before differencing — otherwise the milliseconds land in the offset.
  const flooredMs = Math.floor(instant.getTime() / 1000) * 1000
  return asIfUtc - flooredMs
}

/**
 * The instant at which `parts` is the wall clock in `timezone`.
 *
 * Two passes: guess by treating the wall clock as UTC, correct by the offset at
 * that guess, then re-read the offset at the corrected instant. The second pass
 * is what makes this right across a DST transition, where the offset before and
 * after the guess differ by an hour. Times inside a spring-forward gap do not
 * exist; they resolve deterministically to the instant just after the jump,
 * which is the least surprising answer for a due date.
 */
export function instantFromZonedParts(timezone: string, parts: ZonedParts): Date {
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )

  const firstGuess = wallClockAsUtc - zoneOffsetMs(timezone, new Date(wallClockAsUtc))
  const settled = wallClockAsUtc - zoneOffsetMs(timezone, new Date(firstGuess))
  return new Date(settled)
}

/** Days in a 1-12 month. Day 0 of the next month is the last day of this one. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Adds calendar months in the org timezone, clamping the day to the end of the
 * target month. 31 January plus one month is 28 February (29 in a leap year) —
 * not 3 March, which is what unclamped date arithmetic produces and what puts a
 * fee due date in the wrong month on every 31st.
 */
export function addMonthsInZone(timezone: string, instant: Date, months: number): Date {
  const parts = zonedParts(timezone, instant)
  const zeroBased = parts.month - 1 + months
  const year = parts.year + Math.floor(zeroBased / 12)
  // JS `%` keeps the sign of the dividend, so normalise for negative offsets.
  const month = ((zeroBased % 12) + 12) % 12 + 1

  return instantFromZonedParts(timezone, {
    ...parts,
    year,
    month,
    day: Math.min(parts.day, daysInMonth(year, month)),
  })
}

/**
 * Adds whole days in the org timezone. Distinct from adding 86,400,000 ms: on a
 * DST-shifting day that would move the wall-clock time of every subsequent due
 * date by an hour, and eventually across midnight.
 */
export function addDaysInZone(timezone: string, instant: Date, days: number): Date {
  const parts = zonedParts(timezone, instant)
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))

  return instantFromZonedParts(timezone, {
    ...parts,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  })
}

/**
 * Splits an amount into `parts` integer amounts that sum exactly to the total.
 *
 * The remainder goes to the earliest installments rather than the last. Both are
 * defensible; collecting the odd paise first means the final installment is never
 * larger than the ones a student has already agreed to pay, which is the version
 * that does not generate a phone call.
 */
export function splitAmount(totalMinor: number, parts: number): number[] {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    throw new TypeError(`Total must be a non-negative integer of minor units, got ${totalMinor}.`)
  }
  if (!Number.isSafeInteger(parts) || parts < 1) {
    throw new TypeError(`Installment count must be a positive integer, got ${parts}.`)
  }

  const base = Math.floor(totalMinor / parts)
  const remainder = totalMinor - base * parts

  return Array.from({ length: parts }, (_, index) => (index < remainder ? base + 1 : base))
}

const CADENCE_STEP: Record<FeeCadence, (timezone: string, from: Date, index: number) => Date> = {
  MONTHLY: (timezone, from, index) => addMonthsInZone(timezone, from, index),
  FORTNIGHTLY: (timezone, from, index) => addDaysInZone(timezone, from, index * 14),
  WEEKLY: (timezone, from, index) => addDaysInZone(timezone, from, index * 7),
}

/**
 * The dated, priced installments for a fee schedule.
 *
 * Every due date steps from the *first* one rather than from its predecessor, so
 * a monthly plan starting on the 31st reads 31 Jan, 28 Feb, 31 Mar — clamping
 * once per step instead of compounding it into 28 Feb, 28 Mar, 28 Apr.
 */
export function buildInstallmentPlan(input: InstallmentPlanInput): PlannedInstallment[] {
  if (Number.isNaN(input.firstDueDate.getTime())) {
    throw new TypeError('First due date is not a valid date.')
  }

  const amounts = splitAmount(input.totalMinor, input.count)
  const step = CADENCE_STEP[input.cadence]

  return amounts.map((amountMinor, index) => ({
    seq: index + 1,
    amountMinor,
    dueDate: step(input.timezone, input.firstDueDate, index),
  }))
}
