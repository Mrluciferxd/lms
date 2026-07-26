/**
 * Attendance reads and writes.
 *
 * Separate from ./actions.ts because every exported async function in a
 * `'use server'` module is a callable endpoint — a report query that takes a
 * batch id must not be one of those.
 *
 * The register for a session is the batch roster, not the set of people who
 * happen to have a row already: a student with no record is *unmarked*, which is
 * a different fact from absent (see ./attendance-stats.ts) and only the roster
 * can tell them apart.
 */

import { db } from '@/server/db'
import { ROSTERED_STATUSES } from './visibility'
import { type AttendanceTally, tallyAttendance } from './attendance-stats'
import type { AttendanceStatus, EnrollmentStatus, SessionKind } from '@/generated/prisma/enums'

export interface AttendanceSheetSession {
  id: string
  title: string
  kind: SessionKind
  scheduledStart: Date
  scheduledEnd: Date | null
  actualEnd: Date | null
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  tracksAttendance: boolean
  batchId: string | null
  batchName: string | null
  courseTitle: string | null
}

export interface AttendanceSheetRow {
  userId: string
  name: string
  email: string | null
  /** null for an attendee who is not on the batch roster (open broadcast). */
  enrollmentStatus: EnrollmentStatus | null
  status: AttendanceStatus | null
  note: string | null
  markedAt: Date | null
  markedByName: string | null
}

export interface AttendanceSheet {
  session: AttendanceSheetSession
  rows: AttendanceSheetRow[]
}

export async function getAttendanceSheet(sessionId: string): Promise<AttendanceSheet | null> {
  const session = await db.liveSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      kind: true,
      scheduledStart: true,
      scheduledEnd: true,
      actualEnd: true,
      status: true,
      tracksAttendance: true,
      batchId: true,
      batch: { select: { name: true } },
      course: { select: { title: true } },
    },
  })

  if (!session) return null

  const [enrollments, records] = await Promise.all([
    session.batchId
      ? db.enrollment.findMany({
          where: { batchId: session.batchId, status: { in: [...ROSTERED_STATUSES] } },
          select: {
            status: true,
            user: { select: { id: true, name: true, email: true } },
          },
        })
      : Promise.resolve([]),
    db.attendance.findMany({
      where: { liveSessionId: sessionId },
      select: {
        userId: true,
        status: true,
        note: true,
        markedAt: true,
        user: { select: { id: true, name: true, email: true } },
        markedBy: { select: { name: true } },
      },
    }),
  ])

  const byUser = new Map(records.map((record) => [record.userId, record]))

  const rows: AttendanceSheetRow[] = enrollments.map((enrollment) => {
    const record = byUser.get(enrollment.user.id)
    return {
      userId: enrollment.user.id,
      name: enrollment.user.name,
      email: enrollment.user.email,
      enrollmentStatus: enrollment.status,
      status: record?.status ?? null,
      note: record?.note ?? null,
      markedAt: record?.markedAt ?? null,
      markedByName: record?.markedBy?.name ?? null,
    }
  })

  // Anyone marked who is not on the roster — a guest at a broadcast, or a
  // student moved to another batch after the class. Dropping them would make
  // their record unreachable and un-editable.
  const rostered = new Set(rows.map((row) => row.userId))
  for (const record of records) {
    if (rostered.has(record.userId)) continue
    rows.push({
      userId: record.user.id,
      name: record.user.name,
      email: record.user.email,
      enrollmentStatus: null,
      status: record.status,
      note: record.note,
      markedAt: record.markedAt,
      markedByName: record.markedBy?.name ?? null,
    })
  }

  rows.sort((a, b) => a.name.localeCompare(b.name))

  return {
    session: {
      id: session.id,
      title: session.title,
      kind: session.kind,
      scheduledStart: session.scheduledStart,
      scheduledEnd: session.scheduledEnd,
      actualEnd: session.actualEnd,
      status: session.status,
      tracksAttendance: session.tracksAttendance,
      batchId: session.batchId,
      batchName: session.batch?.name ?? null,
      courseTitle: session.course?.title ?? null,
    },
    rows,
  }
}

export interface AttendanceMark {
  userId: string
  status: AttendanceStatus
  note?: string | null
}

/**
 * Writes marks for one session. Upserts on `(liveSessionId, userId)`, so
 * re-marking a corrected register updates rather than duplicating.
 *
 * One transaction: a half-written register is worse than a failed one, because
 * the missing half reads as "not marked yet" and nobody goes back for it.
 */
export async function applyAttendance(
  sessionId: string,
  marks: readonly AttendanceMark[],
  markedById: string,
): Promise<number> {
  if (marks.length === 0) return 0

  const now = new Date()

  await db.$transaction(
    marks.map((mark) =>
      db.attendance.upsert({
        where: { liveSessionId_userId: { liveSessionId: sessionId, userId: mark.userId } },
        update: {
          status: mark.status,
          note: mark.note ?? null,
          method: 'MANUAL',
          markedById,
          markedAt: now,
        },
        create: {
          liveSessionId: sessionId,
          userId: mark.userId,
          status: mark.status,
          note: mark.note ?? null,
          method: 'MANUAL',
          markedById,
          markedAt: now,
        },
      }),
    ),
  )

  return marks.length
}

export interface StudentAttendanceRow {
  userId: string
  name: string
  email: string | null
  tally: AttendanceTally
}

export interface BatchAttendanceReport {
  /** Attendance-tracking sessions that have started. */
  sessionsHeld: number
  rows: StudentAttendanceRow[]
}

/**
 * Sessions a register could exist for: attendance-tracking, not cancelled, and
 * already begun. A class scheduled for next week is not a gap in the record.
 */
function heldSessionFilter(batchId: string, now: Date) {
  return {
    batchId,
    tracksAttendance: true,
    status: { not: 'CANCELLED' as const },
    scheduledStart: { lte: now },
  }
}

export async function getBatchAttendanceReport(
  batchId: string,
  now = new Date(),
): Promise<BatchAttendanceReport> {
  const sessions = await db.liveSession.findMany({
    where: heldSessionFilter(batchId, now),
    select: { id: true, scheduledStart: true },
  })

  const [enrollments, records] = await Promise.all([
    db.enrollment.findMany({
      where: { batchId, status: { in: [...ROSTERED_STATUSES] } },
      select: {
        enrolledAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    sessions.length > 0
      ? db.attendance.findMany({
          where: { liveSessionId: { in: sessions.map((session) => session.id) } },
          select: { userId: true, status: true },
        })
      : Promise.resolve([]),
  ])

  const statusesByUser = new Map<string, AttendanceStatus[]>()
  for (const record of records) {
    const list = statusesByUser.get(record.userId)
    if (list) list.push(record.status)
    else statusesByUser.set(record.userId, [record.status])
  }

  const rows = enrollments.map((enrollment): StudentAttendanceRow => {
    // Expected sessions are counted from the student's own enrollment date. A
    // student who joined in week 4 must not show as absent for weeks 1-3.
    const expected = sessions.filter(
      (session) => session.scheduledStart.getTime() >= enrollment.enrolledAt.getTime(),
    ).length

    return {
      userId: enrollment.user.id,
      name: enrollment.user.name,
      email: enrollment.user.email,
      tally: tallyAttendance(statusesByUser.get(enrollment.user.id) ?? [], expected),
    }
  })

  rows.sort((a, b) => a.name.localeCompare(b.name))

  return { sessionsHeld: sessions.length, rows }
}

export interface StudentBatchAttendance {
  batchId: string
  batchName: string
  courseTitle: string
  tally: AttendanceTally
}

export interface StudentAttendanceRecord {
  sessionId: string
  title: string
  scheduledStart: Date
  status: AttendanceStatus
  batchName: string | null
}

export interface StudentAttendanceReport {
  overall: AttendanceTally
  batches: StudentBatchAttendance[]
  recent: StudentAttendanceRecord[]
}

export async function getStudentAttendanceReport(
  userId: string,
  now = new Date(),
): Promise<StudentAttendanceReport> {
  const enrollments = await db.enrollment.findMany({
    where: { userId, status: { in: [...ROSTERED_STATUSES] }, batchId: { not: null } },
    select: {
      enrolledAt: true,
      batch: { select: { id: true, name: true, course: { select: { title: true } } } },
    },
  })

  const batchIds = enrollments.flatMap((row) => (row.batch ? [row.batch.id] : []))

  const [sessions, records] = await Promise.all([
    batchIds.length > 0
      ? db.liveSession.findMany({
          where: {
            batchId: { in: batchIds },
            tracksAttendance: true,
            status: { not: 'CANCELLED' },
            scheduledStart: { lte: now },
          },
          select: { id: true, batchId: true, scheduledStart: true },
        })
      : Promise.resolve([]),
    db.attendance.findMany({
      where: { userId },
      select: {
        status: true,
        liveSession: {
          select: {
            id: true,
            title: true,
            batchId: true,
            scheduledStart: true,
            tracksAttendance: true,
            status: true,
            batch: { select: { name: true } },
          },
        },
      },
      orderBy: { markedAt: 'desc' },
      take: 200,
    }),
  ])

  const batches = enrollments.flatMap((enrollment): StudentBatchAttendance[] => {
    if (!enrollment.batch) return []
    const batchId = enrollment.batch.id

    const expected = sessions.filter(
      (session) =>
        session.batchId === batchId &&
        session.scheduledStart.getTime() >= enrollment.enrolledAt.getTime(),
    ).length

    const statuses = records
      .filter((record) => record.liveSession.batchId === batchId)
      .map((record) => record.status)

    return [
      {
        batchId,
        batchName: enrollment.batch.name,
        courseTitle: enrollment.batch.course.title,
        tally: tallyAttendance(statuses, expected),
      },
    ]
  })

  // Summed from the per-batch figures rather than counted independently, so the
  // total and the rows below it cannot disagree about how many classes were held.
  const overall = tallyAttendance(
    records.map((record) => record.status),
    batches.reduce((total, batch) => total + batch.tally.expected, 0),
  )

  const recent = records.slice(0, 20).map(
    (record): StudentAttendanceRecord => ({
      sessionId: record.liveSession.id,
      title: record.liveSession.title,
      scheduledStart: record.liveSession.scheduledStart,
      status: record.status,
      batchName: record.liveSession.batch?.name ?? null,
    }),
  )

  return { overall, batches, recent }
}
