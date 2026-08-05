/**
 * Pure validation for assignments and submissions.
 *
 * No database access — the server actions and the UI inline-hints both call
 * these. Bounded payloads matter: `instructions` is admin-authored but
 * `contentText` is student-authored, and the student surface is the one that
 * should bound a malicious oversized paste before it touches the database.
 */

export const MAX_TITLE_LENGTH = 200
export const MAX_INSTRUCTIONS_LENGTH = 20_000
export const MAX_SUBMISSION_TEXT_LENGTH = 50_000
export const MAX_FEEDBACK_LENGTH = 10_000
export const MAX_ATTACHMENT_IDS = 10
export const MIN_SCORE = 0
export const MAX_SCORE_CEILING = 10_000

export interface AssignmentFieldIssue {
  field: 'title' | 'instructions' | 'maxScore' | 'dueAt' | 'attachmentIds'
  message: string
}

/**
 * Validates the full assignment write. `maxScore` is upper-bounded at the
 * schema's reasonable ceiling rather than the per-row default, so an admin
 * can lift the ceiling up to a grading bar without rewriting the column.
 */
export function validateAssignment(input: {
  title: string
  instructions?: string | null
  maxScore?: number | null
  dueAt?: Date | null
  attachmentIds?: readonly string[]
}): AssignmentFieldIssue[] {
  const issues: AssignmentFieldIssue[] = []

  const title = input.title.trim()
  if (title.length === 0) {
    issues.push({ field: 'title', message: 'Title is required.' })
  } else if (title.length > MAX_TITLE_LENGTH) {
    issues.push({
      field: 'title',
      message: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`,
    })
  }

  if (input.instructions) {
    if (input.instructions.length > MAX_INSTRUCTIONS_LENGTH) {
      issues.push({
        field: 'instructions',
        message: `Instructions must be ${MAX_INSTRUCTIONS_LENGTH} characters or fewer.`,
      })
    }
  }

  // `maxScore` defaults to 100 in the schema; an explicit null is treated as
  // "use default" rather than "no score" — the column is non-nullable INT.
  if (input.maxScore !== null && input.maxScore !== undefined) {
    if (!Number.isInteger(input.maxScore)) {
      issues.push({ field: 'maxScore', message: 'Max score must be a whole number.' })
    } else if (input.maxScore < MIN_SCORE) {
      issues.push({ field: 'maxScore', message: 'Max score cannot be negative.' })
    } else if (input.maxScore > MAX_SCORE_CEILING) {
      issues.push({
        field: 'maxScore',
        message: `Max score must be ${MAX_SCORE_CEILING} or less.`,
      })
    }
  }

  // A past due date is allowed (closing an assignment immediately) but a null
  // due date with a published status means "no due date" — the admin flow uses
  // null as the "no nag" choice, and the validation here only catches the
  // surface-level "the form sent a non-Date" case via a type guard at the
  // caller. Nothing to test at this layer beyond null-vs-not-null.

  const attachmentCount = input.attachmentIds?.length ?? 0
  if (attachmentCount > MAX_ATTACHMENT_IDS) {
    issues.push({
      field: 'attachmentIds',
      message: `An assignment may have at most ${MAX_ATTACHMENT_IDS} attachments.`,
    })
  }

  return issues
}

export interface SubmissionFieldIssue {
  field: 'contentText' | 'attachmentIds'
  message: string
}

/**
 * Validates a submission body. A submission may be empty text *if* it has
 * attachments — the same rule as chat: text-or-attachment, not text-and.
 */
export function validateSubmission(input: {
  contentText?: string | null
  attachmentIds?: readonly string[]
}): SubmissionFieldIssue[] {
  const issues: SubmissionFieldIssue[] = []
  const text = (input.contentText ?? '').trim()
  const hasAttachments = (input.attachmentIds?.length ?? 0) > 0

  if (text.length === 0 && !hasAttachments) {
    issues.push({
      field: 'contentText',
      message: 'A submission must have text or an attachment.',
    })
  }
  if (text.length > MAX_SUBMISSION_TEXT_LENGTH) {
    issues.push({
      field: 'contentText',
      message: `Submission must be ${MAX_SUBMISSION_TEXT_LENGTH} characters or fewer.`,
    })
  }

  const attachmentCount = input.attachmentIds?.length ?? 0
  if (attachmentCount > MAX_ATTACHMENT_IDS) {
    issues.push({
      field: 'attachmentIds',
      message: `A submission may have at most ${MAX_ATTACHMENT_IDS} attachments.`,
    })
  }

  return issues
}

export interface GradeIssue {
  field: 'score' | 'feedback'
  message: string
}

/**
 * Pure bounds check on the grader's score. The actual comparison against
 * `assignment.maxScore` is enforced in the action — `validateGrade` does not
 * know the maxScore because holding it in this closure would mean the action
 * passes a stale value. The action looks the assignment up and rejects out-of-
 * range scores against the live row.
 */
export function validateGrade(input: {
  score?: number | null
  feedback?: string | null
}): GradeIssue[] {
  const issues: GradeIssue[] = []

  if (input.score !== null && input.score !== undefined) {
    if (!Number.isInteger(input.score)) {
      issues.push({ field: 'score', message: 'Score must be a whole number.' })
    } else if (input.score < MIN_SCORE) {
      issues.push({ field: 'score', message: 'Score cannot be negative.' })
    }
  }

  if (input.feedback && input.feedback.length > MAX_FEEDBACK_LENGTH) {
    issues.push({
      field: 'feedback',
      message: `Feedback must be ${MAX_FEEDBACK_LENGTH} characters or fewer.`,
    })
  }

  return issues
}

/**
 * True if a submission may be graded against this maxScore. Pure so the action
 * and any future inline grader hint share one rule. Mirrors the "money maths"
 * rule from payments: integer arithmetic only, no floats on a per-row score.
 */
export function isScoreInRange(score: number, maxScore: number): boolean {
  if (!Number.isInteger(score) || !Number.isInteger(maxScore)) return false
  if (maxScore <= 0) return false
  return score >= MIN_SCORE && score <= maxScore
}
