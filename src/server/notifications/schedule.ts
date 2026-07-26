/**
 * Which rules fire, for which anchors, at time T.
 *
 * Deliberately pure, in the manner of ../batches/release.ts: no database, no
 * clock of its own, everything injected. That is what makes the whole matrix —
 * eight triggers, offsets before and after the anchor, two precisions, an org
 * timezone — testable without fixtures, and it is the part of the notification
 * engine where a bug is expensive rather than merely visible.
 *
 * ── THE WINDOW ───────────────────────────────────────────────────────────────
 * A rule fires when `anchor + offset` lands in the half-open window
 * `(after, until]`. The window is deliberately WIDER than the cron period: the
 * scheduler will be late, will overlap itself, and will miss a run during a
 * deploy, and a window sized exactly to the period turns each of those into a
 * silently un-sent class reminder. Correctness under re-runs comes from the
 * deterministic dedupe key (see ./dedupe.ts), not from the window being exact —
 * so the window is sized for "never miss" and the key handles "never repeat".
 *
 * ── TIMEZONE ─────────────────────────────────────────────────────────────────
 * A 9am reminder means 9am where the academy is. `DAILY` anchors are pinned to a
 * local send hour rather than fired at the anchor's own time of day, because a
 * fee due date's time component is an artefact of how the row was written and
 * nobody wants a payment reminder at 04:30. India has no DST to hide an error
 * behind: a mistake here is a flat 5.5-hour offset that ships.
 */

import { localDayKey, localTimeToUtc } from './time'
import type { NotificationTrigger } from '@/generated/prisma/enums'

/** The entity an anchor hangs off. Part of the dedupe key. */
export type AnchorKind = 'session' | 'installment' | 'assignment' | 'enrollment' | 'event' | 'lesson'

/**
 * `INSTANT` — the anchor's time of day is meaningful to the recipient (a class
 * starts at 19:00), so the reminder is placed relative to that exact moment.
 *
 * `DAILY` — the anchor is really a date (a fee falls due on the 1st), so the
 * reminder is placed at the org's send hour on the resulting local day.
 */
export type AnchorPrecision = 'INSTANT' | 'DAILY'

/** Triggers the built-in scheduler evaluates. */
export type ScheduledTrigger =
  | 'CLASS_REMINDER'
  | 'SESSION_STARTING'
  | 'FEE_DUE'
  | 'FEE_OVERDUE'
  | 'ASSIGNMENT_DUE'
  | 'ENROLLMENT_EXPIRING'
  | 'CALENDAR_EVENT'
  | 'DRIP_UNLOCKED'

/**
 * Precision per trigger, and the exhaustiveness guard that keeps this table
 * honest when a trigger is added to the enum.
 *
 * `ENROLLMENT_CREATED` is event-driven — it fires from the enrollment path, not
 * from a clock — and `CUSTOM` belongs to whichever pack declared it.
 */
const TRIGGER_PRECISION: Record<NotificationTrigger, AnchorPrecision | 'UNSCHEDULED'> = {
  CLASS_REMINDER: 'INSTANT',
  SESSION_STARTING: 'INSTANT',
  ASSIGNMENT_DUE: 'INSTANT',
  CALENDAR_EVENT: 'INSTANT',
  // A due date, an expiry date and an unlock day all carry a time of day that
  // means nothing to the student — it is when the row happened to be written.
  FEE_DUE: 'DAILY',
  FEE_OVERDUE: 'DAILY',
  ENROLLMENT_EXPIRING: 'DAILY',
  DRIP_UNLOCKED: 'DAILY',
  ENROLLMENT_CREATED: 'UNSCHEDULED',
  CUSTOM: 'UNSCHEDULED',
}

export const SCHEDULED_TRIGGERS: readonly ScheduledTrigger[] = (
  Object.keys(TRIGGER_PRECISION) as NotificationTrigger[]
).filter(isScheduledTrigger)

export function isScheduledTrigger(trigger: NotificationTrigger): trigger is ScheduledTrigger {
  return TRIGGER_PRECISION[trigger] !== 'UNSCHEDULED'
}

export function precisionFor(trigger: ScheduledTrigger): AnchorPrecision {
  // Narrowed by the type: a ScheduledTrigger never maps to 'UNSCHEDULED'.
  return TRIGGER_PRECISION[trigger] as AnchorPrecision
}

export interface ScheduleRule {
  id: string
  key: string
  trigger: ScheduledTrigger
  /** Negative = before the anchor, positive = after. */
  offsetMinutes: number
}

export interface ScheduleAnchor {
  trigger: ScheduledTrigger
  kind: AnchorKind
  /** Stable identity of this anchor occurrence. Part of the dedupe key. */
  id: string
  /** The anchor moment, UTC. */
  at: Date
  /**
   * Set when the anchor itself dictates the lead time — a `CalendarEvent` that
   * declares `reminderOffsets` is stating exactly when it wants to be announced,
   * and applying the rule's generic offset on top would double-count it.
   */
  overrideOffsetMinutes?: number
}

export interface SchedulingClock {
  /** OrgSettings.timezone. The single authority for what "9am" means. */
  timezone: string
  /** Local hour DAILY anchors fire at, 0-23. */
  dailySendHour: number
  /** Exclusive lower bound. */
  after: Date
  /** Inclusive upper bound — "now" for this run. */
  until: Date
}

export interface ScheduledFire<A extends ScheduleAnchor = ScheduleAnchor> {
  rule: ScheduleRule
  anchor: A
  fireAt: Date
}

const MS_PER_MINUTE = 60_000

/**
 * Widest lookback accepted. A cron that has been down for longer should be
 * investigated, not allowed to dump a week of stale reminders into a cohort's
 * inbox at once — the messages would all be about events that have passed.
 */
export const MAX_LOOKBACK_MINUTES = 24 * 60

export const DEFAULT_LOOKBACK_MINUTES = 60

export function schedulingWindow(
  now: Date,
  lookbackMinutes: number = DEFAULT_LOOKBACK_MINUTES,
): { after: Date; until: Date } {
  const bounded = Math.min(Math.max(Math.trunc(lookbackMinutes), 1), MAX_LOOKBACK_MINUTES)
  return { after: new Date(now.getTime() - bounded * MS_PER_MINUTE), until: now }
}

/**
 * The moment a rule fires for an anchor.
 *
 * DAILY resolution deliberately shifts the instant first and takes the local
 * calendar day of the result, so "three days before" means three days before in
 * the org's own reckoning. Adding absolute minutes is exact in a zone without
 * DST — which is every zone this product targets today — and off by an hour for
 * anchors within an hour of local midnight in a zone that has it. Should a
 * client land in such a zone, the fix is calendar-day arithmetic here, and this
 * function is the only place it would go.
 */
export function resolveFireAt(
  rule: Pick<ScheduleRule, 'offsetMinutes'>,
  anchor: ScheduleAnchor,
  clock: SchedulingClock,
): Date {
  const offsetMinutes = anchor.overrideOffsetMinutes ?? rule.offsetMinutes
  const shifted = new Date(anchor.at.getTime() + offsetMinutes * MS_PER_MINUTE)
  const precision = precisionFor(anchor.trigger)

  switch (precision) {
    case 'INSTANT':
      return shifted

    case 'DAILY':
      return localTimeToUtc(
        localDayKey(shifted, clock.timezone),
        clock.dailySendHour,
        clock.timezone,
      )

    default: {
      // Exhaustiveness guard: a new precision fails the build here rather than
      // silently falling through to the instant case.
      const exhaustive: never = precision
      throw new Error(`Unhandled anchor precision: ${String(exhaustive)}`)
    }
  }
}

/**
 * Half-open on purpose. An anchor landing exactly on a run boundary belongs to
 * exactly one of two consecutive windows, so overlapping runs do not depend on
 * the dedupe key to stay correct — the key is the backstop, not the mechanism.
 */
export function isDue(fireAt: Date, clock: SchedulingClock): boolean {
  return fireAt.getTime() > clock.after.getTime() && fireAt.getTime() <= clock.until.getTime()
}

/**
 * Every (rule, anchor) pair due in this window.
 *
 * Generic over the anchor so callers can carry recipients and variables along on
 * the anchor and get them back typed, without this module knowing what a
 * recipient is.
 */
export function selectDue<A extends ScheduleAnchor>(
  rules: readonly ScheduleRule[],
  anchors: readonly A[],
  clock: SchedulingClock,
): ScheduledFire<A>[] {
  const byTrigger = new Map<ScheduledTrigger, A[]>()
  for (const anchor of anchors) {
    const bucket = byTrigger.get(anchor.trigger)
    if (bucket) bucket.push(anchor)
    else byTrigger.set(anchor.trigger, [anchor])
  }

  const due: ScheduledFire<A>[] = []
  for (const rule of rules) {
    for (const anchor of byTrigger.get(rule.trigger) ?? []) {
      const fireAt = resolveFireAt(rule, anchor, clock)
      if (isDue(fireAt, clock)) due.push({ rule, anchor, fireAt })
    }
  }
  return due
}

/**
 * The range of anchor times worth loading for a set of rules.
 *
 * An anchor at A fires at A + offset, so to catch every fire inside
 * `(after, until]` the query needs A across `[after - maxOffset, until -
 * minOffset]`. DAILY rules move the fire time to a local send hour that can sit
 * up to a day either side of the shifted instant, so the range is padded rather
 * than computed exactly — over-fetching an anchor costs one row, under-fetching
 * it costs a reminder nobody receives.
 */
export function anchorScanRange(
  rules: readonly ScheduleRule[],
  clock: SchedulingClock,
): { from: Date; to: Date } {
  if (rules.length === 0) return { from: clock.after, to: clock.until }

  const offsets = rules.map((rule) => rule.offsetMinutes)
  const maxOffset = Math.max(...offsets)
  const minOffset = Math.min(...offsets)
  const pad = rules.some((rule) => precisionFor(rule.trigger) === 'DAILY') ? 36 * 60 : 0

  return {
    from: new Date(clock.after.getTime() - (maxOffset + pad) * MS_PER_MINUTE),
    to: new Date(clock.until.getTime() - (minOffset - pad) * MS_PER_MINUTE),
  }
}

/**
 * A range per trigger rather than one range for everything.
 *
 * The union would be correct but wasteful: a single "warn 30 days before access
 * expires" rule would otherwise widen the *timetable* query to thirty days as
 * well, and the collector that pays for that has nothing to do with enrollments.
 * Each trigger scans only what its own rules can reach.
 *
 * Membership doubles as the enabled set — a trigger with no key here has no rule
 * wanting it, or its feature is switched off, and its collector does not run.
 */
export function anchorScanRanges(
  rules: readonly ScheduleRule[],
  clock: SchedulingClock,
): Map<ScheduledTrigger, { from: Date; to: Date }> {
  const byTrigger = new Map<ScheduledTrigger, ScheduleRule[]>()
  for (const rule of rules) {
    const bucket = byTrigger.get(rule.trigger)
    if (bucket) bucket.push(rule)
    else byTrigger.set(rule.trigger, [rule])
  }

  return new Map(
    [...byTrigger].map(([trigger, group]) => [trigger, anchorScanRange(group, clock)]),
  )
}
