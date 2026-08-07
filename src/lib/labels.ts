/**
 * Label resolution.
 *
 * Every user-facing noun that a vertical might rename reads from here rather
 * than being hardcoded. A pack supplies overrides (`liveSession.kind.BROADCAST`
 * → "Live Market Session") and this module layers them over the core defaults.
 *
 * The point is that core stays industry-neutral in its vocabulary as well as its
 * logic. A forex academy calling a broadcast a "Live Market Session" and a music
 * school calling it a "Masterclass" must not require two codebases — or two
 * copies of the same component with different strings.
 */

import { packLabels } from '@/lib/brand'

/**
 * Core defaults. Neutral on purpose: no trading, no fitness, no schooling
 * vocabulary. If a string here reads as industry-specific, it is a bug.
 */
export const CORE_LABELS = {
  // Navigation
  'nav.dashboard': 'Dashboard',
  'nav.courses': 'Courses',
  'nav.liveSessions': 'Live Sessions',
  'nav.calendar': 'Calendar',
  'nav.assignments': 'Assignments',
  'nav.resources': 'Resources',
  'nav.community': 'Community',
  'nav.journals': 'Journals',
  'nav.trackers': 'Trackers',
  'nav.quizzes': 'Quizzes',
  'nav.progress': 'Progress',
  'nav.billing': 'Billing',
  'nav.settings': 'Settings',
  'nav.students': 'Students',
  'nav.batches': 'Batches',
  'nav.attendance': 'Attendance',
  'nav.payments': 'Payments',
  'nav.coupons': 'Coupons',
  'nav.notifications': 'Notifications',
  'nav.reports': 'Reports',

  // Domain nouns
  'course.singular': 'Course',
  'course.plural': 'Courses',
  'course.level.BEGINNER': 'Beginner',
  'course.level.INTERMEDIATE': 'Intermediate',
  'course.level.ADVANCED': 'Advanced',
  'section.singular': 'Section',
  'section.plural': 'Sections',
  'lesson.singular': 'Lesson',
  'lesson.plural': 'Lessons',
  'batch.singular': 'Batch',
  'batch.plural': 'Batches',
  'student.singular': 'Student',
  'student.plural': 'Students',
  'instructor.singular': 'Instructor',
  'instructor.plural': 'Instructors',

  // Live sessions — the most-relabelled surface in the product
  'liveSession.singular': 'Live Session',
  'liveSession.plural': 'Live Sessions',
  'liveSession.kind.CLASS': 'Class',
  'liveSession.kind.CLASS.plural': 'Classes',
  'liveSession.kind.BROADCAST': 'Live Session',
  'liveSession.kind.BROADCAST.plural': 'Live Sessions',
  'liveSession.kind.WEBINAR': 'Webinar',
  'liveSession.kind.WEBINAR.plural': 'Webinars',
  'liveSession.kind.DOUBT_CLEARING': 'Q&A Session',
  'liveSession.kind.DOUBT_CLEARING.plural': 'Q&A Sessions',
  'liveSession.kind.EVENT': 'Event',
  'liveSession.kind.EVENT.plural': 'Events',
  'liveSession.recording': 'Recording',
  'liveSession.upcoming': 'Upcoming Sessions',
  'liveSession.joinNow': 'Join now',

  // Dashboard
  'dashboard.welcome': 'Welcome back, {{name}}',
  'dashboard.liveNow': 'Live now',
  'dashboard.continueLearning': 'Continue learning',
  'dashboard.nextSession': 'Next session',
  'dashboard.noCourses': 'You are not enrolled in any courses yet.',

  // Access and drip
  'access.locked': 'Locked',
  'access.unlocksOn': 'Unlocks {{date}}',
  'access.unlocksAfterSession': 'Unlocks after {{session}}',
  'access.completeToUnlock': 'Complete the previous lesson to unlock',

  // Fees
  'fee.due': 'Due',
  'fee.overdue': 'Overdue',
  'fee.paid': 'Paid',
  'fee.installment': 'Installment',
  'fee.payNow': 'Pay now',

  // Attendance
  'attendance.PRESENT': 'Present',
  'attendance.ABSENT': 'Absent',
  'attendance.LATE': 'Late',
  'attendance.EXCUSED': 'Excused',

  // Generic actions
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.delete': 'Delete',
  'action.signIn': 'Sign in',
  'action.signOut': 'Sign out',
} as const satisfies Record<string, string>

export type LabelKey = keyof typeof CORE_LABELS

export type LabelVars = Record<string, string | number>

/** `{{name}}` → value. Unmatched placeholders are left as-is, which makes a
 *  missing variable visible in review rather than silently rendering nothing. */
function interpolate(template: string, vars?: LabelVars): string {
  if (!vars) return template
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  )
}

/**
 * Resolves a label: pack override first, then core default.
 *
 * Typed against `LabelKey`, so renaming a core label surfaces every call site at
 * compile time. Pack overrides remain loosely typed by design — an unknown key
 * from a pack is ignored rather than fatal, so a core rename degrades a pack's
 * label to the default instead of breaking the deployment.
 */
export function t(key: LabelKey, vars?: LabelVars): string {
  const template = packLabels[key] ?? CORE_LABELS[key]
  return interpolate(template, vars)
}

/**
 * Label for a `LiveSession.kind`, singular or plural. Packs override per kind,
 * which is how BROADCAST becomes "Live Market Session" while CLASS stays "Class".
 */
export function liveSessionKindLabel(
  kind: 'CLASS' | 'BROADCAST' | 'WEBINAR' | 'DOUBT_CLEARING' | 'EVENT',
  form: 'singular' | 'plural' = 'singular',
): string {
  const key = (
    form === 'plural' ? `liveSession.kind.${kind}.plural` : `liveSession.kind.${kind}`
  ) as LabelKey
  return t(key)
}

/** Every label with pack overrides applied. For debugging and admin display. */
export function allLabels(): Record<string, string> {
  return { ...CORE_LABELS, ...packLabels }
}

/**
 * Pack label keys that no longer exist in core — i.e. dead overrides, usually
 * left behind by a core rename. Reported by the packs installer so they get
 * cleaned up rather than silently doing nothing.
 */
export function orphanedPackLabels(): string[] {
  return Object.keys(packLabels).filter((key) => !(key in CORE_LABELS))
}
