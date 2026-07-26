/**
 * Batch seat accounting.
 *
 * Pure, because three surfaces ask the same question and must agree: the batch
 * list ("18/20"), the roster page, and the enrollment action that has to refuse
 * the 21st student. A count computed differently in any one of them is how a
 * cohort ends up with more people than the room holds.
 */

import type { EnrollmentStatus } from '@/generated/prisma/enums'

/**
 * Statuses that hold a seat.
 *
 * CANCELLED and EXPIRED do not: those students have left, and counting them
 * would keep a cohort permanently full and block the replacement the client just
 * sold. COMPLETED does hold one — inside a running batch it means the student
 * finished early, not that they vacated their place.
 */
export const SEAT_OCCUPYING: readonly EnrollmentStatus[] = [
  'PENDING',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
]

export interface SeatState {
  occupied: number
  /** null = uncapped. */
  capacity: number | null
  /** Seats left, floored at zero. null when uncapped. */
  remaining: number | null
  full: boolean
  /**
   * More seats held than capacity allows. Reachable without a bug — an admin may
   * lower capacity below the current roster, which is a state to display rather
   * than an edit to forbid.
   */
  overSubscribed: boolean
  /** 0-100 for a progress bar. null when uncapped. */
  percentFull: number | null
}

export function seatState(occupied: number, capacity: number | null): SeatState {
  if (capacity === null || capacity <= 0) {
    return {
      occupied,
      capacity: null,
      remaining: null,
      full: false,
      overSubscribed: false,
      percentFull: null,
    }
  }

  return {
    occupied,
    capacity,
    remaining: Math.max(0, capacity - occupied),
    full: occupied >= capacity,
    overSubscribed: occupied > capacity,
    // Capped at 100 so an over-subscribed batch does not render a bar past its
    // track; `overSubscribed` is what the UI should shout about instead.
    percentFull: Math.min(100, Math.round((occupied / capacity) * 100)),
  }
}

/** "18 / 20 seats" or "18 enrolled" when uncapped. */
export function describeSeats(state: SeatState): string {
  if (state.capacity === null) return `${state.occupied} enrolled`
  return `${state.occupied} / ${state.capacity} seats`
}
