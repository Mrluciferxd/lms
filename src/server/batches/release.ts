/**
 * Drip release resolution.
 *
 * Availability is COMPUTED from a lesson's rule plus the student's enrollment and
 * batch — there is no per-student unlock table. Batch start dates move (a cohort
 * slips a week, a class is rescheduled) and a materialised unlock table would
 * need backfilling on every such edit, with a stale row for every one you miss.
 * Computing means the rule is the only truth.
 *
 * This module is deliberately pure: no database, no clock of its own. `now` is
 * passed in, which is what makes the whole release matrix testable.
 *
 * Scope note: drip is *pacing*, not authorization. The security boundary is the
 * enrollment check in ../catalog/access.ts. That distinction matters below, where
 * a missing batch anchor falls back to the enrollment date rather than locking a
 * student out of content they paid for.
 */

import type { ReleaseMode, SessionStatus } from '@/generated/prisma/enums'

const MS_PER_DAY = 86_400_000

export interface ReleaseRule {
  mode: ReleaseMode
  offsetDays: number | null
  releaseAt: Date | null
  manuallyReleasedAt: Date | null
  gateSession: GateSession | null
}

export interface GateSession {
  id: string
  title: string
  scheduledStart: Date
  actualEnd: Date | null
  status: SessionStatus
}

export interface ReleaseContext {
  /** Access start, falling back to the enrollment timestamp. */
  enrolledAt: Date
  enrollmentStartsAt: Date | null
  batchStartDate: Date | null
  now: Date
}

export type ReleaseReason =
  /** Scheduled, not reached yet. `releasesAt` is set. */
  | 'NOT_YET'
  /** Gated on a live session that has not finished. */
  | 'AWAITING_SESSION'
  /** MANUAL mode, instructor has not released it. */
  | 'MANUAL_HOLD'
  /** Misconfigured rule — a mode whose anchor is missing. */
  | 'MISCONFIGURED'

export interface ReleaseDecision {
  released: boolean
  reason?: ReleaseReason
  /** When it will unlock, when that is knowable. */
  releasesAt?: Date
  /** Gate session, for messages like "unlocks after Week 3 Live Class". */
  gate?: GateSession
  /**
   * Set when the rule could not be applied as written and a fallback was used, so
   * admin can surface the misconfiguration without students seeing a locked
   * lesson. Not an error — the lesson still resolves.
   */
  warning?: string
}

const RELEASED: ReleaseDecision = { released: true }

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * MS_PER_DAY)
}

/** A session counts as finished once it has an end time or is marked ENDED. */
function hasEnded(session: GateSession): boolean {
  return session.actualEnd !== null || session.status === 'ENDED'
}

function scheduled(releasesAt: Date, now: Date): ReleaseDecision {
  return releasesAt.getTime() <= now.getTime()
    ? RELEASED
    : { released: false, reason: 'NOT_YET', releasesAt }
}

/**
 * Resolves whether one lesson is available to one student right now.
 */
export function resolveRelease(rule: ReleaseRule, ctx: ReleaseContext): ReleaseDecision {
  switch (rule.mode) {
    case 'IMMEDIATE':
      return RELEASED

    case 'DAYS_AFTER_ENROLLMENT': {
      const anchor = ctx.enrollmentStartsAt ?? ctx.enrolledAt
      return scheduled(addDays(anchor, rule.offsetDays ?? 0), ctx.now)
    }

    case 'DAYS_AFTER_BATCH_START': {
      /**
       * No batch: the student bought this course self-paced while the lesson is
       * configured for cohort pacing. Blocking forever would make content
       * unreachable for someone who paid for it, so anchor on their enrollment
       * instead — the staged pacing intent is preserved, and admin gets a warning.
       */
      if (!ctx.batchStartDate) {
        const anchor = ctx.enrollmentStartsAt ?? ctx.enrolledAt
        return {
          ...scheduled(addDays(anchor, rule.offsetDays ?? 0), ctx.now),
          warning:
            'Lesson drips from batch start but this enrollment has no batch; anchored to the enrollment date instead.',
        }
      }
      return scheduled(addDays(ctx.batchStartDate, rule.offsetDays ?? 0), ctx.now)
    }

    case 'FIXED_DATE': {
      // A FIXED_DATE rule with no date reads as "not scheduled yet", so it stays
      // locked. Unlike the batch case there is no sensible anchor to fall back on.
      if (!rule.releaseAt) {
        return {
          released: false,
          reason: 'MISCONFIGURED',
          warning: 'Lesson uses a fixed release date but none is set.',
        }
      }
      return scheduled(rule.releaseAt, ctx.now)
    }

    case 'AFTER_SESSION': {
      if (!rule.gateSession) {
        return {
          released: false,
          reason: 'MISCONFIGURED',
          warning: 'Lesson unlocks after a live session, but the session is missing or deleted.',
        }
      }
      if (hasEnded(rule.gateSession)) return RELEASED

      // A cancelled gate would otherwise lock the lesson permanently.
      if (rule.gateSession.status === 'CANCELLED') {
        return {
          released: false,
          reason: 'MISCONFIGURED',
          gate: rule.gateSession,
          warning: `Gate session "${rule.gateSession.title}" was cancelled; this lesson can never unlock.`,
        }
      }

      return { released: false, reason: 'AWAITING_SESSION', gate: rule.gateSession }
    }

    case 'MANUAL':
      return rule.manuallyReleasedAt !== null &&
        rule.manuallyReleasedAt.getTime() <= ctx.now.getTime()
        ? RELEASED
        : { released: false, reason: 'MANUAL_HOLD' }

    default: {
      // Exhaustiveness guard: a new ReleaseMode fails the build here rather than
      // silently defaulting to released.
      const exhaustive: never = rule.mode
      throw new Error(`Unhandled release mode: ${String(exhaustive)}`)
    }
  }
}

/**
 * Human-readable explanation for a locked lesson. Kept next to the resolver so
 * the two never drift.
 */
export function describeRelease(
  decision: ReleaseDecision,
  formatDate: (date: Date) => string,
): string | null {
  if (decision.released) return null

  switch (decision.reason) {
    case 'NOT_YET':
      return decision.releasesAt ? `Unlocks ${formatDate(decision.releasesAt)}` : 'Not yet available'
    case 'AWAITING_SESSION':
      return decision.gate ? `Unlocks after ${decision.gate.title}` : 'Unlocks after a live session'
    case 'MANUAL_HOLD':
      return 'Not released yet'
    case 'MISCONFIGURED':
      // Students should never see a configuration problem described as one.
      return 'Not yet available'
    default:
      return 'Not yet available'
  }
}
