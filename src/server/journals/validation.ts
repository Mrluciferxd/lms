/**
 * Pure validation for journal entries against their journal's field schema.
 *
 * The field schema lives in the database as JSON and was authored by a pack
 * (or, later, by an admin form). This module knows nothing about the database
 * — it takes the parsed schema and the candidate entry data and returns the
 * per-field issues, the same posture as chat/validation and
 * assignments/validation. Bounded payloads matter: `textarea` and `text` fields
 * are student-authored and a momentum paste should not reach the database.
 *
 * No float arithmetic is performed here. Validators coerce where safe, but
 * numeric fields are stored as numbers and the expression evaluator reads them
 * back from the JSON column as numbers — `text`, `date`, `datetime` stay strings.
 *
 * The `JournalFieldType` union mirrors the pack-side type in
 * `src/packs/types.ts`. Core owns its own copy rather than importing the pack
 * contract, so a deployment with no packs can still parse the JSON column — the
 * pack installer wrote it, but the type is generic data.
 */

/** Mirrors PackJournalField['type'] in src/packs/types.ts. See file header. */
export type JournalFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'percent'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'image'
  | 'file'
  | 'url'

export const MAX_TEXT_LENGTH = 10_000
export const MAX_TEXTAREA_LENGTH = 50_000
export const MAX_URL_LENGTH = 2_000
export const MAX_TAGS = 20
export const MAX_ATTACHMENT_IDS = 10
export const MAX_COMMENT_LENGTH = 5_000

export interface JournalFieldSchema {
  key: string
  label: string
  type: JournalFieldType
  required?: boolean
  help?: string
  placeholder?: string
  /** Required for `select` / `multiselect`. */
  options?: { value: string; label: string }[]
  unit?: string
  min?: number
  max?: number
  step?: number
  defaultValue?: string | number | boolean
  /** Hidden from the entry form but still stored. */
  hidden?: boolean
  /** Expression over sibling field values; field renders only when truthy. */
  showIf?: string
}

export interface JournalFieldIssue {
  field: string
  message: string
}

/** Coerces a schema-shaped JSON value to a typed read for safe field access. */
function readField(value: unknown): JournalFieldSchema {
  return value as JournalFieldSchema
}

/** True if the value is a finite number (the JSON parse of an integer or decimal). */
function isNumberLike(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** True if the value is a non-empty string after trim. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Validates an entry's data against its journal's field schema. Returns the
 * per-field issues; flat because the form renders one message per field at most
 * and the server action surfaces the first message.
 */
export function validateJournalEntry(input: {
  fields: readonly unknown[]
  /** The entry data: field key -> JSON value. */
  data: Record<string, unknown>
}): JournalFieldIssue[] {
  const issues: JournalFieldIssue[] = []
  const seen = new Set<string>()

  for (const rawField of input.fields) {
    const field = readField(rawField)
    seen.add(field.key)
    const value = input.data[field.key]
    const isPresent = value !== undefined && value !== null && value !== ''

    if (field.required || field.type === 'boolean') {
      if (field.type === 'boolean') {
        if (value !== true && value !== false) {
          issues.push({
            field: field.key,
            message: `${field.label} must be on or off.`,
          })
          continue
        }
      } else if (!isPresent || (typeof value === 'string' && value.trim() === '')) {
        if (field.required) {
          issues.push({ field: field.key, message: `${field.label} is required.` })
          continue
        }
      }
    }

    // An absent non-required field passes; nothing left to check.
    if (!isPresent) continue

    const issue = validateFieldValue(field, value)
    if (issue) issues.push(issue)
  }

  // Extra-data guard: keys in the payload the schema does not declare. Admin form
  // edits can drop a field from a definition while a stale client still sends it;
  // we refuse to write it rather than store a value no UI ever reads.
  for (const key of Object.keys(input.data)) {
    if (!seen.has(key) && input.data[key] !== undefined && input.data[key] !== null) {
      issues.push({ field: key, message: `Unknown field "${key}".` })
    }
  }

  return issues
}

function validateFieldValue(
  field: JournalFieldSchema,
  value: unknown,
): JournalFieldIssue | null {
  switch (field.type) {
    case 'text': {
      if (!isNonEmptyString(value)) {
        return { field: field.key, message: `${field.label} must be text.` }
      }
      if (value.length > MAX_TEXT_LENGTH) {
        return {
          field: field.key,
          message: `${field.label} must be ${MAX_TEXT_LENGTH} characters or fewer.`,
        }
      }
      return null
    }

    case 'textarea': {
      if (!isNonEmptyString(value)) {
        return { field: field.key, message: `${field.label} must be text.` }
      }
      if (value.length > MAX_TEXTAREA_LENGTH) {
        return {
          field: field.key,
          message: `${field.label} must be ${MAX_TEXTAREA_LENGTH} characters or fewer.`,
        }
      }
      return null
    }

    case 'url': {
      if (typeof value !== 'string') {
        return { field: field.key, message: `${field.label} must be a URL.` }
      }
      if (value.length > MAX_URL_LENGTH) {
        return {
          field: field.key,
          message: `${field.label} must be ${MAX_URL_LENGTH} characters or fewer.`,
        }
      }
      try {
        const parsed = new URL(value)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return {
            field: field.key,
            message: `${field.label} must be an http(s) URL.`,
          }
        }
      } catch {
        return { field: field.key, message: `${field.label} is not a valid URL.` }
      }
      return null
    }

    case 'number': {
      if (!isNumberLike(value)) {
        return { field: field.key, message: `${field.label} must be a number.` }
      }
      if (field.min !== undefined && value < field.min) {
        return { field: field.key, message: `${field.label} must be ${field.min} or greater.` }
      }
      if (field.max !== undefined && value > field.max) {
        return { field: field.key, message: `${field.label} must be ${field.max} or less.` }
      }
      return null
    }

    case 'currency': {
      if (!isNumberLike(value) || value < 0) {
        return {
          field: field.key,
          message: `${field.label} must be a non-negative amount.`,
        }
      }
      return null
    }

    case 'percent': {
      if (!isNumberLike(value) || value < 0 || value > 100) {
        return {
          field: field.key,
          message: `${field.label} must be a percentage between 0 and 100.`,
        }
      }
      return null
    }

    case 'select': {
      const allowed = (field.options ?? []).map((option) => option.value)
      if (typeof value !== 'string' || !allowed.includes(value)) {
        return { field: field.key, message: `${field.label} must be one of the options.` }
      }
      return null
    }

    case 'multiselect': {
      if (!Array.isArray(value)) {
        return { field: field.key, message: `${field.label} must be a list.` }
      }
      const allowed = new Set((field.options ?? []).map((option) => option.value))
      for (const item of value) {
        if (typeof item !== 'string' || !allowed.has(item)) {
          return {
            field: field.key,
            message: `${field.label} contains an invalid option.`,
          }
        }
      }
      return null
    }

    case 'boolean': {
      // Required/optional handled above; the type guard already ran.
      return null
    }

    case 'date': {
      if (typeof value !== 'string') {
        return { field: field.key, message: `${field.label} must be a date.` }
      }
      const date = new Date(value + 'T00:00:00Z')
      if (Number.isNaN(date.getTime())) {
        return { field: field.key, message: `${field.label} must be a date.` }
      }
      return null
    }

    case 'datetime': {
      if (typeof value !== 'string') {
        return { field: field.key, message: `${field.label} must be a date and time.` }
      }
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) {
        return { field: field.key, message: `${field.label} is not a valid date and time.` }
      }
      return null
    }

    case 'image':
    case 'file': {
      // ids only; the upload API issued them, this just records references.
      if (typeof value !== 'string') {
        return { field: field.key, message: `${field.label} must be an upload id.` }
      }
      return null
    }

    default: {
      // Exhaustiveness — an unknown future type the validator is unaware of
      // must not silently pass through.
      return {
        field: field.key,
        message: `${field.label} has an unsupported type in its definition.`,
      }
    }
  }
}

/** True iff the data validates against the schema. The action fast-exits on this. */
export function isJournalEntryValid(input: {
  fields: readonly unknown[]
  data: Record<string, unknown>
}): boolean {
  return validateJournalEntry(input).length === 0
}

/** Validates a comment body. Bounded so the table does not become a wall. */
export function validateComment(body: string): string | null {
  const trimmed = body.trim()
  if (trimmed.length === 0) return 'Comment cannot be empty.'
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer.`
  }
  return null
}

/** Validates the tags array on an entry; bounded to keep the list readable. */
export function validateTags(tags: unknown): string | null {
  if (!Array.isArray(tags)) return null
  if (tags.length > MAX_TAGS) return `An entry may have at most ${MAX_TAGS} tags.`
  for (const tag of tags) {
    if (typeof tag !== 'string' || tag.trim().length === 0) {
      return 'Tags must be non-empty strings.'
    }
  }
  return null
}

/** True iff `value` is an array of valid attachment ids. */
export function validateAttachmentIds(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  if (value.length > MAX_ATTACHMENT_IDS) {
    return `An entry may have at most ${MAX_ATTACHMENT_IDS} attachments.`
  }
  for (const id of value) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return 'Attachment ids must be non-empty strings.'
    }
  }
  return null
}
