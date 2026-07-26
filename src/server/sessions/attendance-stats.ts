/**
 * Attendance arithmetic.
 *
 * Pure, and separate from the queries, because the percentage is the number a
 * client will quote at a parent, an employer or a regulator. It needs to be one
 * function with a written-down rule rather than a `reduce` copied into three
 * report pages.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 *  LATE counts as attended. They were in the room; lateness is a separate
 *  conversation from absence, and folding it into the absence figure loses it.
 *
 *  EXCUSED is removed from the denominator entirely — neither attended nor
 *  missed. An approved absence must not reduce a student's percentage, which is
 *  the whole reason for granting one, and counting it as attendance would
 *  overstate a figure someone may act on.
 *
 *  UNMARKED sessions are also excluded, and reported separately. A class nobody
 *  took the register for is missing data, not an absence: counting it against
 *  the student would let an instructor's admin backlog look like truancy.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { AttendanceStatus } from '@/generated/prisma/enums'

export interface AttendanceTally {
  present: number
  absent: number
  late: number
  excused: number
  /** Sessions the student was expected at, never fewer than those recorded. */
  expected: number
  /** Attendance-tracking sessions with no record for this student. */
  unmarked: number
  /** present + late. */
  attended: number
  /** attended + absent — the denominator. */
  countable: number
  /** 0-100, or null when nothing has been marked yet. */
  percent: number | null
}

/**
 * @param statuses  one entry per attendance record for the student, in scope
 * @param expectedSessions  attendance-tracking sessions they were on the roster
 *                          for; anything beyond `statuses.length` is unmarked
 */
export function tallyAttendance(
  statuses: readonly AttendanceStatus[],
  expectedSessions: number,
): AttendanceTally {
  let present = 0
  let absent = 0
  let late = 0
  let excused = 0

  for (const status of statuses) {
    switch (status) {
      case 'PRESENT':
        present += 1
        break
      case 'ABSENT':
        absent += 1
        break
      case 'LATE':
        late += 1
        break
      case 'EXCUSED':
        excused += 1
        break
      default: {
        // A new AttendanceStatus must be classified deliberately rather than
        // silently vanishing from every report.
        const exhaustive: never = status
        throw new Error(`Unhandled attendance status: ${String(exhaustive)}`)
      }
    }
  }

  const attended = present + late
  const countable = attended + absent

  return {
    present,
    absent,
    late,
    excused,
    expected: Math.max(expectedSessions, statuses.length),
    unmarked: Math.max(0, expectedSessions - statuses.length),
    attended,
    countable,
    // null, not 0: "no register taken yet" and "attended nothing" are different
    // facts, and rendering the first as 0% libels the student.
    percent: countable === 0 ? null : Math.round((attended / countable) * 100),
  }
}

/** "86%" or "—". */
export function formatAttendancePercent(percent: number | null): string {
  return percent === null ? '—' : `${percent}%`
}

/**
 * Below-threshold flag for the roster view. Unknown (nothing marked) is not
 * "at risk" — a report that flags every student in a new cohort is ignored.
 */
export function isBelowThreshold(tally: AttendanceTally, thresholdPercent: number): boolean {
  return tally.percent !== null && tally.percent < thresholdPercent
}
