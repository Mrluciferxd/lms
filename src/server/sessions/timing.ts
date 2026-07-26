/**
 * Session lifecycle timing.
 *
 * Where a session sits relative to now, as one pure function. Three surfaces ask
 * it — the student timetable enabling a join button, the admin attendance queue
 * listing what is markable, and the batch console — and a session that is
 * "joinable" on one page and "over" on another is a support ticket.
 *
 * `status` is the authority when it has been set explicitly (an instructor
 * pressed start or cancel); otherwise the clock decides. Both are needed:
 * nothing guarantees anyone presses the button, so a schedule that has plainly
 * passed must read as ended anyway.
 */

import type { SessionStatus } from '@/generated/prisma/enums'

/** Doors open this long before the scheduled start. */
export const JOIN_OPENS_MIN_BEFORE = 15

/** Assumed length when `scheduledEnd` was left blank. */
export const ASSUMED_DURATION_MIN = 60

export type SessionPhase =
  | 'CANCELLED'
  | 'UPCOMING'
  /** Not started, but close enough that the join link should work. */
  | 'JOINABLE'
  | 'LIVE'
  | 'ENDED'

export interface TimedSession {
  status: SessionStatus
  scheduledStart: Date
  scheduledEnd: Date | null
  actualEnd: Date | null
}

/**
 * When the session is over, actual end preferred.
 *
 * A missing `scheduledEnd` falls back to an assumed duration rather than to
 * infinity — otherwise a session created without an end time stays joinable
 * forever and its join link never expires from the timetable.
 */
export function effectiveEnd(session: TimedSession): Date {
  if (session.actualEnd) return session.actualEnd
  if (session.scheduledEnd) return session.scheduledEnd
  return new Date(session.scheduledStart.getTime() + ASSUMED_DURATION_MIN * 60_000)
}

export function sessionPhase(session: TimedSession, now: Date): SessionPhase {
  if (session.status === 'CANCELLED') return 'CANCELLED'
  if (session.status === 'ENDED' || session.actualEnd !== null) return 'ENDED'

  const end = effectiveEnd(session)

  // An instructor who pressed start keeps the session live past its scheduled
  // end — classes overrun, and cutting the join link mid-class is worse than
  // leaving it open a while.
  if (session.status === 'LIVE') return 'LIVE'

  if (now.getTime() > end.getTime()) return 'ENDED'

  const opensAt = session.scheduledStart.getTime() - JOIN_OPENS_MIN_BEFORE * 60_000
  return now.getTime() >= opensAt ? 'JOINABLE' : 'UPCOMING'
}

/** Whether the join link should be offered. */
export function canJoin(session: TimedSession, now: Date): boolean {
  const phase = sessionPhase(session, now)
  return phase === 'JOINABLE' || phase === 'LIVE'
}

/**
 * Whether attendance can be taken. Opens with the doors, not at the end: taking
 * the register at the start of class is how it is actually done.
 */
export function attendanceOpen(
  session: TimedSession & { tracksAttendance: boolean },
  now: Date,
): boolean {
  if (!session.tracksAttendance) return false
  const phase = sessionPhase(session, now)
  return phase === 'JOINABLE' || phase === 'LIVE' || phase === 'ENDED'
}

const PHASE_LABELS: Record<SessionPhase, string> = {
  CANCELLED: 'Cancelled',
  UPCOMING: 'Scheduled',
  JOINABLE: 'Starting soon',
  LIVE: 'Live now',
  ENDED: 'Ended',
}

export function describePhase(phase: SessionPhase): string {
  return PHASE_LABELS[phase]
}
