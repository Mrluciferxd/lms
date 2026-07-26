/**
 * The template variable context.
 *
 * Templates are Handlebars-shaped (`{{student.firstName}}`) and are edited by
 * non-developers, so the variable surface has to be enumerable, typed, and safe
 * to hand to a third-party API afterwards.
 *
 * Two rules are borrowed from src/server/media/watermark.ts for the same
 * reasons. Values are sanitised, because a display name is user-controlled input
 * on its way into an SMS gateway. And braces are stripped from values, because
 * otherwise a student called `{{org.name}}` would inject a placeholder that the
 * next render pass resolves.
 *
 * This module is also the single place where a stored value becomes a string:
 * money arrives as integer minor units and dates arrive as UTC instants, and
 * both are formatted here against the org's currency, locale and timezone. No
 * caller formats either itself.
 *
 * Pure — no database, no clock, no environment. The admin preview renders in the
 * browser through exactly this code path.
 */

import { formatDate, formatDateTime, formatMoney } from '@/lib/utils'
import { localDayDiff, wholeMinutesBetween } from './time'

/** Keeps one runaway value from dominating an SMS. */
const MAX_VALUE_LENGTH = 200

/** C0 controls, DEL and C1 controls. Newlines inside a *value* are not wanted. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g

/** Braces would let a value inject another placeholder on re-render. */
const BRACES = /[{}]/g

/** Only schemes a mail client or WhatsApp will render as a safe link. */
const SAFE_URL_SCHEMES = ['http:', 'https:']

// -----------------------------------------------------------------------------
// Context shape
// -----------------------------------------------------------------------------

export interface OrgContext {
  name: string
  timezone: string
  locale: string
  currency: string
  supportEmail: string | null
  supportPhone: string | null
  /** Absolute base URL. Relative links are useless in an email. */
  appUrl: string
}

export interface StudentContext {
  name: string
  email: string | null
  phone: string | null
}

export interface CourseContext {
  title: string
  url: string
}

export interface BatchContext {
  name: string
  code: string
}

export interface SessionContext {
  title: string
  /** Already resolved through `liveSessionKindLabel`, so packs relabel it. */
  kind: string
  startAt: Date
  joinUrl: string | null
  location: string | null
}

export interface FeeContext {
  label: string
  seq: number
  /** Integer minor units. Formatted here and nowhere else. */
  amountMinor: number
  currency: string
  dueDate: Date
  payUrl: string
}

export interface AssignmentContext {
  title: string
  dueAt: Date | null
  url: string
  maxScore: number
}

export interface EventContext {
  title: string
  startAt: Date
  location: string | null
  joinUrl: string | null
}

export interface LessonContext {
  title: string
  url: string
}

export interface EnrollmentContext {
  expiresAt: Date | null
  percentComplete: number
}

export interface TemplateContext {
  org: OrgContext
  student?: StudentContext
  course?: CourseContext
  batch?: BatchContext
  session?: SessionContext
  fee?: FeeContext
  assignment?: AssignmentContext
  event?: EventContext
  lesson?: LessonContext
  enrollment?: EnrollmentContext
}

export type TemplateVariables = Record<string, string>

// -----------------------------------------------------------------------------
// Sanitisation
// -----------------------------------------------------------------------------

export function sanitizeValue(value: string): string {
  const cleaned = value.replace(CONTROL_CHARS, ' ').replace(BRACES, '').replace(/\s{2,}/g, ' ').trim()
  return cleaned.length > MAX_VALUE_LENGTH
    ? `${cleaned.slice(0, MAX_VALUE_LENGTH - 1)}…`
    : cleaned
}

/**
 * URLs are not truncated — half a link is worse than none — but the scheme is
 * enforced. `joinUrl` is admin-entered free text, and a `javascript:` URL
 * arriving in an email body is a stored-XSS delivery mechanism we would be
 * paying a vendor to distribute.
 */
export function sanitizeUrl(value: string | null): string {
  if (!value) return ''
  const trimmed = value.replace(CONTROL_CHARS, '').replace(BRACES, '').trim()
  try {
    const parsed = new URL(trimmed)
    return SAFE_URL_SCHEMES.includes(parsed.protocol) ? parsed.toString() : ''
  } catch {
    return ''
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

// -----------------------------------------------------------------------------
// Flattening
// -----------------------------------------------------------------------------

/**
 * Flattens the typed context into the dotted keys templates address.
 *
 * Absent groups contribute no keys at all rather than empty ones, which is what
 * makes `unknownVariables` able to tell "this template asks for something this
 * trigger cannot supply" from "this value happens to be blank right now".
 *
 * `sendAt` is the moment the message is scheduled for, not the moment this runs.
 * Every relative value — "starts in 15 minutes", "due in 3 days" — is derived
 * from it, because a notification queued now and delivered after a retry must
 * still describe the world as of when it was meant to arrive. Passing the time
 * in rather than reading a clock also keeps this function pure, which is what
 * lets the admin preview render through it.
 */
export function buildVariables(context: TemplateContext, sendAt: Date): TemplateVariables {
  const { org } = context
  const time = (date: Date) => formatDateTime(date, org.timezone, org.locale)
  const day = (date: Date) => formatDate(date, org.timezone, org.locale)
  const clock = (date: Date) =>
    formatDate(date, org.timezone, org.locale, { timeStyle: 'short' })

  const variables: TemplateVariables = {
    'org.name': sanitizeValue(org.name),
    'org.timezone': sanitizeValue(org.timezone),
    'org.supportEmail': sanitizeValue(org.supportEmail ?? ''),
    'org.supportPhone': sanitizeValue(org.supportPhone ?? ''),
    'org.url': sanitizeUrl(org.appUrl),
  }

  const { student, course, batch, session, fee, assignment, event, lesson, enrollment } = context

  if (student) {
    variables['student.name'] = sanitizeValue(student.name)
    variables['student.firstName'] = sanitizeValue(firstName(student.name))
    variables['student.email'] = sanitizeValue(student.email ?? '')
    variables['student.phone'] = sanitizeValue(student.phone ?? '')
  }

  if (course) {
    variables['course.title'] = sanitizeValue(course.title)
    variables['course.url'] = sanitizeUrl(course.url)
  }

  if (batch) {
    variables['batch.name'] = sanitizeValue(batch.name)
    variables['batch.code'] = sanitizeValue(batch.code)
  }

  if (session) {
    variables['session.title'] = sanitizeValue(session.title)
    variables['session.kind'] = sanitizeValue(session.kind)
    variables['session.startTime'] = sanitizeValue(clock(session.startAt))
    variables['session.startDate'] = sanitizeValue(day(session.startAt))
    variables['session.startAt'] = sanitizeValue(time(session.startAt))
    variables['session.minutesUntil'] = String(
      Math.max(0, wholeMinutesBetween(sendAt, session.startAt)),
    )
    variables['session.joinUrl'] = sanitizeUrl(session.joinUrl)
    variables['session.location'] = sanitizeValue(session.location ?? '')
  }

  if (fee) {
    variables['fee.label'] = sanitizeValue(fee.label)
    variables['fee.seq'] = String(fee.seq)
    variables['fee.amount'] = sanitizeValue(
      formatMoney(fee.amountMinor, fee.currency, org.locale),
    )
    variables['fee.dueDate'] = sanitizeValue(day(fee.dueDate))
    // Calendar days in the org timezone, not elapsed 24-hour periods: "due in
    // 3 days" has to agree with the date the student reads two lines above.
    const daysUntilDue = localDayDiff(sendAt, fee.dueDate, org.timezone)
    variables['fee.daysUntilDue'] = String(daysUntilDue)
    variables['fee.daysOverdue'] = String(Math.max(0, -daysUntilDue))
    variables['fee.payUrl'] = sanitizeUrl(fee.payUrl)
  }

  if (assignment) {
    variables['assignment.title'] = sanitizeValue(assignment.title)
    variables['assignment.dueDate'] = assignment.dueAt ? sanitizeValue(day(assignment.dueAt)) : ''
    variables['assignment.dueAt'] = assignment.dueAt ? sanitizeValue(time(assignment.dueAt)) : ''
    variables['assignment.maxScore'] = String(assignment.maxScore)
    variables['assignment.url'] = sanitizeUrl(assignment.url)
  }

  if (event) {
    variables['event.title'] = sanitizeValue(event.title)
    variables['event.startTime'] = sanitizeValue(clock(event.startAt))
    variables['event.startDate'] = sanitizeValue(day(event.startAt))
    variables['event.startAt'] = sanitizeValue(time(event.startAt))
    variables['event.minutesUntil'] = String(
      Math.max(0, wholeMinutesBetween(sendAt, event.startAt)),
    )
    variables['event.location'] = sanitizeValue(event.location ?? '')
    variables['event.joinUrl'] = sanitizeUrl(event.joinUrl)
  }

  if (lesson) {
    variables['lesson.title'] = sanitizeValue(lesson.title)
    variables['lesson.url'] = sanitizeUrl(lesson.url)
  }

  if (enrollment) {
    variables['enrollment.expiresOn'] = enrollment.expiresAt
      ? sanitizeValue(day(enrollment.expiresAt))
      : ''
    variables['enrollment.daysRemaining'] = String(
      enrollment.expiresAt
        ? Math.max(0, localDayDiff(sendAt, enrollment.expiresAt, org.timezone))
        : 0,
    )
    variables['enrollment.percentComplete'] = String(enrollment.percentComplete)
  }

  return variables
}

/**
 * Documentation for the admin editor, keyed by variable. Descriptions are
 * optional by construction: the authoritative list of *available* variables is
 * whatever `buildVariables` emits for the trigger, so a variable added to the
 * builder without a description degrades to an undescribed row rather than
 * disappearing from the editor.
 */
export const VARIABLE_DESCRIPTIONS: Record<string, string> = {
  'org.name': 'Academy name',
  'org.timezone': 'Org timezone, e.g. Asia/Kolkata',
  'org.supportEmail': 'Support email address',
  'org.supportPhone': 'Support phone number',
  'org.url': 'Base URL of the platform',
  'student.name': 'Full name',
  'student.firstName': 'First name only — the usual greeting',
  'student.email': 'Email address',
  'student.phone': 'Phone number',
  'course.title': 'Course title',
  'course.url': 'Link to the course',
  'batch.name': 'Batch name',
  'batch.code': 'Batch code',
  'session.title': 'Session title',
  'session.kind': 'Session type, relabelled by the active pack',
  'session.startTime': 'Start time of day, in the org timezone',
  'session.startDate': 'Start date, in the org timezone',
  'session.startAt': 'Full start date and time, in the org timezone',
  'session.minutesUntil': 'Whole minutes until the session starts',
  'session.joinUrl': 'Joining link',
  'session.location': 'Venue, for offline and hybrid sessions',
  'fee.label': 'Installment label',
  'fee.seq': 'Installment number within the schedule',
  'fee.amount': 'Amount due, formatted in the org currency',
  'fee.dueDate': 'Due date, in the org timezone',
  'fee.daysUntilDue': 'Days until due; negative once overdue',
  'fee.daysOverdue': 'Days overdue; zero before the due date',
  'fee.payUrl': 'Link to the billing page',
  'assignment.title': 'Assignment title',
  'assignment.dueDate': 'Due date, in the org timezone',
  'assignment.dueAt': 'Full due date and time, in the org timezone',
  'assignment.maxScore': 'Maximum score',
  'assignment.url': 'Link to the assignment',
  'event.title': 'Event title',
  'event.startTime': 'Start time of day, in the org timezone',
  'event.startDate': 'Start date, in the org timezone',
  'event.startAt': 'Full start date and time, in the org timezone',
  'event.minutesUntil': 'Whole minutes until the event starts',
  'event.location': 'Location',
  'event.joinUrl': 'Joining link',
  'lesson.title': 'Lesson title',
  'lesson.url': 'Link to the lesson',
  'enrollment.expiresOn': 'Access expiry date, in the org timezone',
  'enrollment.daysRemaining': 'Days of access remaining',
  'enrollment.percentComplete': 'Course progress percentage',
}
