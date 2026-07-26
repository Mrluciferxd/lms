/**
 * Enrollment creation — the single entry point.
 *
 * ── WHY THIS EXISTS RATHER THAN A BARE upsert ────────────────────────────────
 * `Enrollment` declares `@@unique([userId, courseId, batchId])`, which reads as
 * "one enrollment per student per course per batch". It does not fully deliver
 * that, for two reasons, both rooted in `batchId` being nullable:
 *
 *  1. Postgres treats NULLs as distinct in a unique index, so
 *     `(user, course, NULL)` can be inserted repeatedly. Self-paced enrollments
 *     are exactly that shape, so the constraint does not constrain them.
 *  2. Prisma cannot target a compound unique containing a null, so
 *     `upsert({ where: { userId_courseId_batchId: { ..., batchId: null } } })`
 *     throws "Argument `batchId` must not be null" outright.
 *
 * Postgres 15+ could fix (1) with `NULLS NOT DISTINCT`, but Prisma has no syntax
 * for it (verified against 7.9), so adding it by raw SQL would leave
 * schema.prisma permanently out of step with the database and break the
 * migration-drift check in CI. The trade chosen is: enforce it here, in the one
 * function every caller uses, and keep the schema and migrations honest.
 *
 * The check-then-write is not atomic. In practice the paths that create
 * enrollments are already idempotent upstream — the Razorpay webhook dedupes on
 * `WebhookEvent(gateway, eventId)` before reaching here, and admin enrollment is
 * a single operator action. If a genuinely concurrent path appears later, wrap
 * the call in a transaction with a row lock on the user.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { recordAudit } from '@/server/audit'
import { db } from '@/server/db'
import type { EnrollmentSource, EnrollmentStatus } from '@/generated/prisma/enums'

export interface EnrollInput {
  userId: string
  courseId: string
  batchId?: string | null
  status?: EnrollmentStatus
  source?: EnrollmentSource
  /** Access start, when it differs from the enrollment moment. */
  startsAt?: Date | null
  /** Explicit expiry. Otherwise derived from the course's accessDurationDays. */
  expiresAt?: Date | null
  actorId?: string | null
}

export interface EnrollResult {
  enrollmentId: string
  /** False when an existing enrollment was reused or reactivated. */
  created: boolean
}

/**
 * Idempotent by (userId, courseId, batchId). Re-enrolling a student who already
 * has an active enrollment is a no-op rather than a duplicate row.
 */
export async function enrollUser(input: EnrollInput): Promise<EnrollResult> {
  const batchId = input.batchId ?? null

  const existing = await db.enrollment.findFirst({
    where: { userId: input.userId, courseId: input.courseId, batchId },
    select: { id: true, status: true },
  })

  if (existing) {
    // Reactivate a paused or cancelled enrollment rather than creating a second
    // one; the student's progress hangs off lessons, but their fee schedule and
    // certificate hang off this row.
    const reactivating =
      existing.status === 'CANCELLED' ||
      existing.status === 'EXPIRED' ||
      existing.status === 'PAUSED'

    if (reactivating) {
      await db.enrollment.update({
        where: { id: existing.id },
        data: {
          status: input.status ?? 'ACTIVE',
          expiresAt: input.expiresAt ?? null,
          startsAt: input.startsAt ?? null,
        },
      })

      await recordAudit({
        actorId: input.actorId ?? input.userId,
        action: 'enrollment.reactivated',
        entityType: 'Enrollment',
        entityId: existing.id,
        meta: { from: existing.status, courseId: input.courseId },
      })
    }

    return { enrollmentId: existing.id, created: false }
  }

  // Derive expiry from the course when not given explicitly.
  let expiresAt = input.expiresAt ?? null
  if (!expiresAt) {
    const course = await db.course.findUnique({
      where: { id: input.courseId },
      select: { accessDurationDays: true },
    })
    if (course?.accessDurationDays) {
      const anchor = input.startsAt ?? new Date()
      expiresAt = new Date(anchor.getTime() + course.accessDurationDays * 86_400_000)
    }
  }

  const enrollment = await db.enrollment.create({
    data: {
      userId: input.userId,
      courseId: input.courseId,
      batchId,
      status: input.status ?? 'ACTIVE',
      source: input.source ?? 'MANUAL',
      startsAt: input.startsAt ?? null,
      expiresAt,
    },
    select: { id: true },
  })

  await recordAudit({
    actorId: input.actorId ?? input.userId,
    action: 'enrollment.created',
    entityType: 'Enrollment',
    entityId: enrollment.id,
    meta: { courseId: input.courseId, batchId, source: input.source ?? 'MANUAL' },
  })

  return { enrollmentId: enrollment.id, created: true }
}
