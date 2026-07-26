/**
 * Batch roster reads.
 *
 * Kept out of ./actions.ts on purpose: every exported async function in a
 * `'use server'` module is a publicly callable endpoint, so query helpers that
 * take an id and return student data must not live there.
 */

import { db } from '@/server/db'
import { SEAT_OCCUPYING, type SeatState, seatState } from './capacity'
import type { EnrollmentStatus } from '@/generated/prisma/enums'

export interface RosterEntry {
  enrollmentId: string
  userId: string
  name: string
  email: string | null
  phone: string | null
  status: EnrollmentStatus
  enrolledAt: Date
  percentComplete: number
  lastActivityAt: Date | null
}

export interface BatchRoster {
  entries: RosterEntry[]
  seats: SeatState
}

export async function countOccupiedSeats(batchId: string): Promise<number> {
  return db.enrollment.count({
    where: { batchId, status: { in: [...SEAT_OCCUPYING] } },
  })
}

/**
 * Everyone attached to the batch, including departed students.
 *
 * Cancelled enrollments stay on the list — greyed out rather than deleted —
 * because "who dropped out of this cohort" is a question the client asks, and it
 * is unanswerable if leaving a batch erases the row.
 */
export async function getBatchRoster(batchId: string, capacity: number | null): Promise<BatchRoster> {
  const enrollments = await db.enrollment.findMany({
    where: { batchId },
    select: {
      id: true,
      status: true,
      enrolledAt: true,
      percentComplete: true,
      lastActivityAt: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
    orderBy: [{ status: 'asc' }, { enrolledAt: 'asc' }],
  })

  const entries = enrollments.map(
    (enrollment): RosterEntry => ({
      enrollmentId: enrollment.id,
      userId: enrollment.user.id,
      name: enrollment.user.name,
      email: enrollment.user.email,
      phone: enrollment.user.phone,
      status: enrollment.status,
      enrolledAt: enrollment.enrolledAt,
      percentComplete: enrollment.percentComplete,
      lastActivityAt: enrollment.lastActivityAt,
    }),
  )

  const occupied = entries.filter((entry) => SEAT_OCCUPYING.includes(entry.status)).length

  return { entries, seats: seatState(occupied, capacity) }
}

export interface StudentOption {
  id: string
  name: string
  email: string | null
}

/**
 * Students who could be added to this batch.
 *
 * Excludes anyone already holding a seat in it. It deliberately does NOT exclude
 * students enrolled in the same course through a different batch — moving a
 * repeating student into a later cohort is the common case, and the enrollment
 * action handles the collision.
 */
export async function findEnrollableStudents(
  batchId: string,
  query: string,
  limit = 20,
): Promise<StudentOption[]> {
  const trimmed = query.trim()

  const students = await db.user.findMany({
    where: {
      role: 'STUDENT',
      status: 'ACTIVE',
      ...(trimmed
        ? {
            OR: [
              { name: { contains: trimmed, mode: 'insensitive' as const } },
              { email: { contains: trimmed, mode: 'insensitive' as const } },
              { phone: { contains: trimmed } },
            ],
          }
        : {}),
      NOT: { enrollments: { some: { batchId, status: { in: [...SEAT_OCCUPYING] } } } },
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
    take: limit,
  })

  return students
}

/** Other batches on the same course, as move targets. */
export async function listSiblingBatches(
  courseId: string,
  excludeBatchId: string,
): Promise<{ id: string; name: string; code: string }[]> {
  return db.batch.findMany({
    where: {
      courseId,
      id: { not: excludeBatchId },
      // A finished or cancelled cohort is not somewhere to move a student into.
      status: { in: ['UPCOMING', 'ENROLLING', 'RUNNING'] },
    },
    select: { id: true, name: true, code: true },
    orderBy: { startDate: 'asc' },
  })
}
