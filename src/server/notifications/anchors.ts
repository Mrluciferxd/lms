/**
 * Anchor collection.
 *
 * Turns each built-in trigger into a list of "this thing happens at this time,
 * to these people, with this context". Everything clock-shaped is left to
 * ./schedule.ts; this module only answers what exists in the database.
 *
 * Two things bound the work, and both matter on a deployment with a few thousand
 * students. A collector runs only when some enabled rule actually wants its
 * trigger — most deployments enable two or three of the eight. And every query
 * is bounded by the anchor scan range derived from those rules' offsets, so a
 * class reminder job reads the next hour of timetable rather than the timetable.
 *
 * Feature flags gate collectors, not just navigation: with `feeInstallments`
 * off, the fee collector does not run and no fee reminder is queued. Hiding the
 * billing link while a cron still messages students about money is exactly the
 * failure the flag exists to prevent.
 */

import { brand } from '@/lib/brand'
import { liveSessionKindLabel } from '@/lib/labels'
import { resolveRelease, type ReleaseRule } from '@/server/batches/release'
import { db } from '@/server/db'
import { resolveFeatures } from '@/server/org/settings'
import type { AnchorKind, ScheduleAnchor, ScheduledTrigger } from './schedule'
import type { OrgContext, TemplateContext } from './variables'
import type { BrandFeatures } from '@/lib/brand/types'
import type { SessionKind } from '@/generated/prisma/enums'

export interface AnchorRecipient {
  userId: string
  name: string
  email: string | null
  phone: string | null
  /** Merged over the anchor's shared context. Per-student values live here. */
  context?: Partial<TemplateContext>
}

export interface CollectedAnchor extends ScheduleAnchor {
  kind: AnchorKind
  /** Shared across every recipient of this anchor. */
  context: Partial<TemplateContext>
  /** Deep link for the in-app copy. */
  actionUrl: string | null
  recipients: AnchorRecipient[]
}

export interface AnchorScanRange {
  from: Date
  to: Date
}

/**
 * Ranges to scan, keyed by trigger. Absence means "no enabled rule wants this",
 * so a collector whose triggers are all absent does no work at all — which is
 * what keeps a deployment using two of the eight triggers from paying for eight.
 */
export type AnchorScanRanges = ReadonlyMap<ScheduledTrigger, AnchorScanRange>

/**
 * The union of the ranges for a collector that serves more than one trigger.
 * Null when none of them is wanted.
 */
function rangeFor(
  ranges: AnchorScanRanges,
  triggers: readonly ScheduledTrigger[],
): AnchorScanRange | null {
  const found = triggers.flatMap((trigger) => ranges.get(trigger) ?? [])
  if (found.length === 0) return null

  return {
    from: new Date(Math.min(...found.map((range) => range.from.getTime()))),
    to: new Date(Math.max(...found.map((range) => range.to.getTime()))),
  }
}

/**
 * Which brand feature gates each trigger. Null where the trigger is part of the
 * platform's core obligation rather than an optional module — access expiry is
 * something every deployment must be able to warn about.
 */
const TRIGGER_FEATURE: Record<ScheduledTrigger, keyof BrandFeatures | null> = {
  CLASS_REMINDER: 'liveSessions',
  SESSION_STARTING: 'liveSessions',
  FEE_DUE: 'feeInstallments',
  FEE_OVERDUE: 'feeInstallments',
  ASSIGNMENT_DUE: 'assignments',
  CALENDAR_EVENT: 'calendar',
  ENROLLMENT_EXPIRING: null,
  DRIP_UNLOCKED: null,
}

/**
 * A single scheduler run above this many recipients for one anchor is almost
 * certainly a misconfigured audience rather than a real broadcast. It is logged,
 * not truncated: silently dropping recipients loses a class reminder, and
 * silently keeping them can bill the client for thousands of WhatsApp messages.
 * The operator gets to decide, from a log line that names the anchor.
 */
const FAN_OUT_WARNING_THRESHOLD = 2_000

type UserRow = { id: string; name: string; email: string | null; phone: string | null }

const USER_SELECT = { id: true, name: true, email: true, phone: true } as const

function toRecipient(user: UserRow, context?: Partial<TemplateContext>): AnchorRecipient {
  return { userId: user.id, name: user.name, email: user.email, phone: user.phone, context }
}

function warnOnFanOut(anchor: { kind: AnchorKind; id: string }, count: number): void {
  if (count > FAN_OUT_WARNING_THRESHOLD) {
    console.warn(
      `[notify] ${anchor.kind}:${anchor.id} resolved ${count} recipients, above the ${FAN_OUT_WARNING_THRESHOLD} review threshold`,
    )
  }
}

// -----------------------------------------------------------------------------
// URLs
// -----------------------------------------------------------------------------

/**
 * Links are absolute. A relative path is unusable in an email or an SMS, and
 * this is the only place that distinction should have to be remembered.
 */
function appUrl(org: OrgContext, path: string): string {
  return `${org.appUrl.replace(/\/+$/, '')}${path}`
}

// -----------------------------------------------------------------------------
// Recipient helpers
// -----------------------------------------------------------------------------

/**
 * Students whose enrollment currently conveys access.
 *
 * COMPLETED is excluded, unlike the access check in ../catalog/access.ts:
 * finishing a course keeps the library open but should not keep the reminders
 * coming for a cohort the student has left.
 */
async function enrolledRecipients(where: {
  batchId?: string
  courseId?: string
}): Promise<AnchorRecipient[]> {
  const enrollments = await db.enrollment.findMany({
    where: { ...where, status: 'ACTIVE', user: { status: 'ACTIVE' } },
    select: { user: { select: USER_SELECT } },
  })

  // A student enrolled in two batches of the same course would otherwise be
  // counted twice for a course-wide anchor.
  const byUser = new Map<string, AnchorRecipient>()
  for (const enrollment of enrollments) {
    byUser.set(enrollment.user.id, toRecipient(enrollment.user))
  }
  return [...byUser.values()]
}

async function allActiveStudents(): Promise<AnchorRecipient[]> {
  const users = await db.user.findMany({
    where: { role: 'STUDENT', status: 'ACTIVE' },
    select: USER_SELECT,
  })
  return users.map((user) => toRecipient(user))
}

// -----------------------------------------------------------------------------
// Collectors
// -----------------------------------------------------------------------------

const SESSION_KINDS_BY_TRIGGER: Record<'CLASS_REMINDER' | 'SESSION_STARTING', SessionKind[]> = {
  // A batch class and an open broadcast are the same table with a different
  // `kind`; the two triggers exist so an academy can remind its cohort about
  // class without also messaging everyone about every market session.
  CLASS_REMINDER: ['CLASS'],
  SESSION_STARTING: ['BROADCAST', 'WEBINAR', 'DOUBT_CLEARING', 'EVENT'],
}

async function sessionAnchors(
  ranges: AnchorScanRanges,
  org: OrgContext,
): Promise<CollectedAnchor[]> {
  const wanted = (['CLASS_REMINDER', 'SESSION_STARTING'] as const).filter((trigger) =>
    ranges.has(trigger),
  )
  const range = rangeFor(ranges, wanted)
  if (!range) return []

  const kindToTrigger = new Map<SessionKind, ScheduledTrigger>()
  for (const trigger of wanted) {
    for (const kind of SESSION_KINDS_BY_TRIGGER[trigger]) kindToTrigger.set(kind, trigger)
  }

  const sessions = await db.liveSession.findMany({
    where: {
      status: { in: ['SCHEDULED', 'LIVE'] },
      kind: { in: [...kindToTrigger.keys()] },
      scheduledStart: { gte: range.from, lte: range.to },
    },
    select: {
      id: true,
      kind: true,
      title: true,
      scheduledStart: true,
      joinUrl: true,
      location: true,
      batchId: true,
      courseId: true,
      batch: { select: { name: true, code: true } },
      course: { select: { title: true, slug: true } },
    },
  })

  const anchors: CollectedAnchor[] = []

  for (const session of sessions) {
    const trigger = kindToTrigger.get(session.kind)
    if (!trigger) continue

    // A handful of sessions fall in any one window, so a query per session is
    // cheaper than loading every enrollment and joining in memory.
    const recipients = session.batchId
      ? await enrolledRecipients({ batchId: session.batchId })
      : session.courseId
        ? await enrolledRecipients({ courseId: session.courseId })
        : // An untethered broadcast — the forex pack's "Live Market Session" —
          // belongs to the academy rather than to a cohort.
          await allActiveStudents()

    warnOnFanOut({ kind: 'session', id: session.id }, recipients.length)

    anchors.push({
      trigger,
      kind: 'session',
      id: session.id,
      at: session.scheduledStart,
      actionUrl: appUrl(org, '/app/live'),
      context: {
        session: {
          title: session.title,
          kind: liveSessionKindLabel(session.kind),
          startAt: session.scheduledStart,
          joinUrl: session.joinUrl,
          location: session.location,
        },
        ...(session.course
          ? {
              course: {
                title: session.course.title,
                url: appUrl(org, `/app/courses/${session.course.slug}`),
              },
            }
          : {}),
        ...(session.batch
          ? { batch: { name: session.batch.name, code: session.batch.code } }
          : {}),
      },
      recipients,
    })
  }

  return anchors
}

/**
 * Fee anchors.
 *
 * FEE_DUE and FEE_OVERDUE read the same rows and the same due date; what
 * separates them is the sign of the rule's offset. Both are emitted for every
 * unpaid installment in range so an academy can run "3 days before" and "2 days
 * after" off one obligation without the collector caring which is which.
 *
 * PAID, WAIVED and CANCELLED are excluded at the query, which is what stops a
 * student who has already paid from being chased.
 */
async function feeAnchors(
  ranges: AnchorScanRanges,
  org: OrgContext,
): Promise<CollectedAnchor[]> {
  const wanted = (['FEE_DUE', 'FEE_OVERDUE'] as const).filter((trigger) => ranges.has(trigger))
  const range = rangeFor(ranges, wanted)
  if (!range) return []

  const installments = await db.feeInstallment.findMany({
    where: {
      status: { in: ['PENDING', 'OVERDUE'] },
      dueDate: { gte: range.from, lte: range.to },
      feeSchedule: { enrollment: { status: 'ACTIVE', user: { status: 'ACTIVE' } } },
    },
    select: {
      id: true,
      seq: true,
      label: true,
      amountMinor: true,
      dueDate: true,
      feeSchedule: {
        select: {
          currency: true,
          enrollment: {
            select: {
              user: { select: USER_SELECT },
              course: { select: { title: true, slug: true } },
            },
          },
        },
      },
    },
  })

  return installments.flatMap((installment) => {
    const { enrollment, currency } = installment.feeSchedule
    const context: Partial<TemplateContext> = {
      fee: {
        label: installment.label ?? `Installment ${installment.seq}`,
        seq: installment.seq,
        amountMinor: installment.amountMinor,
        currency,
        dueDate: installment.dueDate,
        payUrl: appUrl(org, '/app/billing'),
      },
      course: {
        title: enrollment.course.title,
        url: appUrl(org, `/app/courses/${enrollment.course.slug}`),
      },
    }

    return wanted.map(
      (trigger): CollectedAnchor => ({
        trigger,
        kind: 'installment',
        id: installment.id,
        at: installment.dueDate,
        actionUrl: appUrl(org, '/app/billing'),
        context,
        recipients: [toRecipient(enrollment.user)],
      }),
    )
  })
}

/**
 * Assignment anchors.
 *
 * Students who have already submitted are dropped. Nagging someone about work
 * they handed in two days ago is the fastest way to teach a cohort that these
 * messages are noise, after which the ones that matter go unread too.
 */
async function assignmentAnchors(
  ranges: AnchorScanRanges,
  org: OrgContext,
): Promise<CollectedAnchor[]> {
  const range = ranges.get('ASSIGNMENT_DUE')
  if (!range) return []

  const assignments = await db.assignment.findMany({
    where: {
      status: 'PUBLISHED',
      dueAt: { gte: range.from, lte: range.to },
    },
    select: {
      id: true,
      title: true,
      dueAt: true,
      maxScore: true,
      batchId: true,
      courseId: true,
      course: { select: { title: true, slug: true } },
      submissions: {
        where: { status: { in: ['SUBMITTED', 'GRADED'] } },
        select: { userId: true },
      },
    },
  })

  const anchors: CollectedAnchor[] = []

  for (const assignment of assignments) {
    if (!assignment.dueAt) continue

    const scope = assignment.batchId
      ? { batchId: assignment.batchId }
      : assignment.courseId
        ? { courseId: assignment.courseId }
        : null
    // An assignment attached to neither a batch nor a course has no audience to
    // resolve; it is a draft in all but name.
    if (!scope) continue

    const submitted = new Set(assignment.submissions.map((submission) => submission.userId))
    const recipients = (await enrolledRecipients(scope)).filter(
      (recipient) => !submitted.has(recipient.userId),
    )
    if (recipients.length === 0) continue

    anchors.push({
      trigger: 'ASSIGNMENT_DUE',
      kind: 'assignment',
      id: assignment.id,
      at: assignment.dueAt,
      actionUrl: appUrl(org, `/app/assignments/${assignment.id}`),
      context: {
        assignment: {
          title: assignment.title,
          dueAt: assignment.dueAt,
          maxScore: assignment.maxScore,
          url: appUrl(org, `/app/assignments/${assignment.id}`),
        },
        ...(assignment.course
          ? {
              course: {
                title: assignment.course.title,
                url: appUrl(org, `/app/courses/${assignment.course.slug}`),
              },
            }
          : {}),
      },
      recipients,
    })
  }

  return anchors
}

async function enrollmentExpiryAnchors(
  ranges: AnchorScanRanges,
  org: OrgContext,
): Promise<CollectedAnchor[]> {
  const range = ranges.get('ENROLLMENT_EXPIRING')
  if (!range) return []

  const enrollments = await db.enrollment.findMany({
    where: {
      status: 'ACTIVE',
      expiresAt: { gte: range.from, lte: range.to },
      user: { status: 'ACTIVE' },
    },
    select: {
      id: true,
      expiresAt: true,
      percentComplete: true,
      user: { select: USER_SELECT },
      course: { select: { title: true, slug: true } },
    },
  })

  return enrollments.flatMap((enrollment): CollectedAnchor[] => {
    if (!enrollment.expiresAt) return []
    const courseUrl = appUrl(org, `/app/courses/${enrollment.course.slug}`)

    return [
      {
        trigger: 'ENROLLMENT_EXPIRING',
        kind: 'enrollment',
        id: enrollment.id,
        at: enrollment.expiresAt,
        actionUrl: courseUrl,
        context: {
          course: { title: enrollment.course.title, url: courseUrl },
          enrollment: {
            expiresAt: enrollment.expiresAt,
            percentComplete: enrollment.percentComplete,
          },
        },
        recipients: [toRecipient(enrollment.user)],
      },
    ]
  })
}

/**
 * Calendar anchors.
 *
 * `CalendarEvent.reminderOffsets` overrides the rule's offset rather than
 * stacking with it. An event that says "remind at 1440 and 60 minutes before" is
 * stating exactly when it wants to be announced; applying a rule's generic -30
 * on top would announce it at 25 and 1.5 hours before, which is neither thing
 * anybody asked for. Each declared offset becomes its own anchor id so the two
 * reminders dedupe independently.
 */
async function calendarAnchors(
  ranges: AnchorScanRanges,
  org: OrgContext,
): Promise<CollectedAnchor[]> {
  const range = ranges.get('CALENDAR_EVENT')
  if (!range) return []

  const events = await db.calendarEvent.findMany({
    where: { startAt: { gte: range.from, lte: range.to } },
    select: {
      id: true,
      title: true,
      startAt: true,
      location: true,
      joinUrl: true,
      audience: true,
      audienceRef: true,
      reminderOffsets: true,
    },
  })

  const anchors: CollectedAnchor[] = []

  for (const event of events) {
    const recipients = await calendarRecipients(event.audience, event.audienceRef)
    if (recipients.length === 0) continue
    warnOnFanOut({ kind: 'event', id: event.id }, recipients.length)

    const context: Partial<TemplateContext> = {
      event: {
        title: event.title,
        startAt: event.startAt,
        location: event.location,
        joinUrl: event.joinUrl,
      },
    }

    const base = {
      trigger: 'CALENDAR_EVENT' as const,
      kind: 'event' as const,
      at: event.startAt,
      actionUrl: appUrl(org, '/app/calendar'),
      context,
      recipients,
    }

    if (event.reminderOffsets.length === 0) {
      anchors.push({ ...base, id: event.id })
      continue
    }

    for (const minutesBefore of event.reminderOffsets) {
      anchors.push({
        ...base,
        id: `${event.id}:${minutesBefore}`,
        overrideOffsetMinutes: -Math.abs(minutesBefore),
      })
    }
  }

  return anchors
}

async function calendarRecipients(
  audience: 'ALL' | 'ROLE' | 'BATCH' | 'COURSE' | 'USERS',
  audienceRef: string[],
): Promise<AnchorRecipient[]> {
  switch (audience) {
    case 'ALL': {
      const users = await db.user.findMany({
        where: { status: 'ACTIVE' },
        select: USER_SELECT,
      })
      return users.map((user) => toRecipient(user))
    }

    case 'ROLE': {
      const users = await db.user.findMany({
        where: {
          status: 'ACTIVE',
          role: { in: audienceRef as ('OWNER' | 'ADMIN' | 'INSTRUCTOR' | 'STAFF' | 'STUDENT')[] },
        },
        select: USER_SELECT,
      })
      return users.map((user) => toRecipient(user))
    }

    case 'BATCH': {
      const enrollments = await db.enrollment.findMany({
        where: { batchId: { in: audienceRef }, status: 'ACTIVE', user: { status: 'ACTIVE' } },
        select: { user: { select: USER_SELECT } },
      })
      return dedupeRecipients(enrollments.map((enrollment) => enrollment.user))
    }

    case 'COURSE': {
      const enrollments = await db.enrollment.findMany({
        where: { courseId: { in: audienceRef }, status: 'ACTIVE', user: { status: 'ACTIVE' } },
        select: { user: { select: USER_SELECT } },
      })
      return dedupeRecipients(enrollments.map((enrollment) => enrollment.user))
    }

    case 'USERS': {
      const users = await db.user.findMany({
        where: { id: { in: audienceRef }, status: 'ACTIVE' },
        select: USER_SELECT,
      })
      return users.map((user) => toRecipient(user))
    }

    default: {
      // A new audience kind must be handled explicitly rather than defaulting to
      // "everybody", which is the expensive direction to get wrong.
      const exhaustive: never = audience
      throw new Error(`Unhandled calendar audience: ${String(exhaustive)}`)
    }
  }
}

function dedupeRecipients(users: UserRow[]): AnchorRecipient[] {
  const byUser = new Map<string, AnchorRecipient>()
  for (const user of users) byUser.set(user.id, toRecipient(user))
  return [...byUser.values()]
}

/**
 * Drip anchors.
 *
 * The unlock moment is not stored anywhere — availability is resolved from the
 * lesson's rule plus the student's enrollment, deliberately, so that moving a
 * batch start date moves every unlock with it (docs/02-data-model.md). So this
 * asks the release resolver itself: evaluated at the start of the scan range, a
 * lesson that unlocks later reports `releasesAt`, and one that unlocked already
 * reports released with no date. Reusing ../batches/release.ts rather than
 * recomputing the rule here is the point — two implementations of drip timing
 * would drift, and the one students see would win.
 *
 * MANUAL and AFTER_SESSION lessons produce nothing: neither has a knowable
 * unlock time in advance, and both are better announced by the instructor action
 * that releases them.
 *
 * Cost: enrollments × lessons of their courses, in memory. Fine for a cohort
 * academy; if a deployment reaches tens of thousands of enrollments this is the
 * collector to move to a materialised unlock calendar.
 */
async function dripAnchors(
  ranges: AnchorScanRanges,
  org: OrgContext,
): Promise<CollectedAnchor[]> {
  const range = ranges.get('DRIP_UNLOCKED')
  if (!range) return []

  const enrollments = await db.enrollment.findMany({
    where: { status: 'ACTIVE', user: { status: 'ACTIVE' } },
    select: {
      courseId: true,
      enrolledAt: true,
      startsAt: true,
      user: { select: USER_SELECT },
      course: { select: { title: true, slug: true } },
      batch: { select: { startDate: true } },
    },
  })
  if (enrollments.length === 0) return []

  const lessons = await db.lesson.findMany({
    where: {
      // The three modes whose unlock time is knowable from stored data.
      releaseMode: { in: ['DAYS_AFTER_ENROLLMENT', 'DAYS_AFTER_BATCH_START', 'FIXED_DATE'] },
      section: { courseId: { in: [...new Set(enrollments.map((e) => e.courseId))] } },
    },
    select: {
      id: true,
      title: true,
      releaseMode: true,
      releaseOffsetDays: true,
      releaseAt: true,
      section: { select: { courseId: true } },
    },
  })
  if (lessons.length === 0) return []

  const byCourse = new Map<string, typeof lessons>()
  for (const lesson of lessons) {
    const bucket = byCourse.get(lesson.section.courseId)
    if (bucket) bucket.push(lesson)
    else byCourse.set(lesson.section.courseId, [lesson])
  }

  const anchors: CollectedAnchor[] = []

  for (const enrollment of enrollments) {
    for (const lesson of byCourse.get(enrollment.courseId) ?? []) {
      const rule: ReleaseRule = {
        mode: lesson.releaseMode,
        offsetDays: lesson.releaseOffsetDays,
        releaseAt: lesson.releaseAt,
        manuallyReleasedAt: null,
        gateSession: null,
      }

      const decision = resolveRelease(rule, {
        enrolledAt: enrollment.enrolledAt,
        enrollmentStartsAt: enrollment.startsAt,
        batchStartDate: enrollment.batch?.startDate ?? null,
        // Evaluated at the start of the range: anything already unlocked by then
        // reports no date and is skipped, which is the filter we want.
        now: range.from,
      })

      if (!decision.releasesAt) continue

      const lessonUrl = appUrl(
        org,
        `/app/courses/${enrollment.course.slug}/lessons/${lesson.id}`,
      )

      anchors.push({
        trigger: 'DRIP_UNLOCKED',
        kind: 'lesson',
        // Per student: the same lesson unlocks on different days for different
        // people, so the enrollment has to be in the identity.
        id: `${lesson.id}:${enrollment.user.id}`,
        at: decision.releasesAt,
        actionUrl: lessonUrl,
        context: {
          lesson: { title: lesson.title, url: lessonUrl },
          course: {
            title: enrollment.course.title,
            url: appUrl(org, `/app/courses/${enrollment.course.slug}`),
          },
        },
        recipients: [toRecipient(enrollment.user)],
      })
    }
  }

  return anchors
}

// -----------------------------------------------------------------------------

/**
 * Triggers this deployment will evaluate: the ones some enabled rule wants, less
 * the ones whose feature is switched off at build time or at runtime.
 */
export async function enabledTriggers(
  wanted: ReadonlySet<ScheduledTrigger>,
): Promise<Set<ScheduledTrigger>> {
  const features = await resolveFeatures()

  return new Set(
    [...wanted].filter((trigger) => {
      const feature = TRIGGER_FEATURE[trigger]
      if (!feature) return true
      return brand.features[feature] && features[feature]
    }),
  )
}

export async function collectAnchors(input: {
  ranges: AnchorScanRanges
  org: OrgContext
}): Promise<CollectedAnchor[]> {
  const { ranges, org } = input
  if (ranges.size === 0) return []

  const collected = await Promise.all([
    sessionAnchors(ranges, org),
    feeAnchors(ranges, org),
    assignmentAnchors(ranges, org),
    enrollmentExpiryAnchors(ranges, org),
    calendarAnchors(ranges, org),
    dripAnchors(ranges, org),
  ])

  return collected.flat()
}
