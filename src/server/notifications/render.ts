/**
 * Template rendering, per channel.
 *
 * One template row, five channels, five different sets of constraints. A body
 * written for email — a greeting, blank lines, a sign-off — becomes an expensive
 * three-segment SMS and a WhatsApp template rejection if it is passed through
 * unchanged. So the substitution happens once and the *shaping* happens per
 * channel, against limits that come from what the providers actually enforce.
 *
 * Pure. No database, no clock, no environment: the admin editor imports this
 * module directly to render its live preview in the browser, which is the only
 * way a preview can be trusted to match what the worker will send.
 */

import type { NotificationChannelType } from '@/generated/prisma/enums'
import type { TemplateVariables } from './variables'

/** `{{ student.firstName }}` — dotted keys, whitespace tolerated. */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g

export interface RenderableTemplate {
  subject?: string | null
  body: string
}

export interface RenderedMessage {
  /** Null on channels that carry no subject line. */
  subject: string | null
  body: string
  /** Variables the template asked for that the context did not supply. */
  missing: string[]
}

interface ChannelShape {
  /** `none` drops the subject; `required` synthesises one from the body. */
  subject: 'optional' | 'required' | 'none'
  maxSubject: number
  maxBody: number
  /** Collapse all line breaks to single spaces. */
  singleLine: boolean
  /** Runs of newlines longer than this are collapsed. */
  maxConsecutiveNewlines: number
}

/**
 * Where these numbers come from:
 *
 * SMS — 480 characters is three GSM-7 segments (153 each after the concatenation
 * header). Line breaks are collapsed because each one costs a character and the
 * operator bills per segment, so an email-shaped body silently triples the price
 * of every class reminder.
 *
 * WHATSAPP — the Cloud API rejects a template body over 1024 characters, and
 * rejects leading or trailing whitespace and long newline runs outright. Sending
 * a message the provider will refuse is worse than sending a shortened one.
 *
 * PUSH — Android truncates around 178 characters and titles around 65, and a
 * push with no title renders as the app name, which tells the student nothing.
 *
 * EMAIL and IN_APP keep the author's structure; they are the channels where the
 * long form was intended.
 */
const CHANNEL_SHAPES: Record<NotificationChannelType, ChannelShape> = {
  EMAIL: {
    subject: 'optional',
    maxSubject: 200,
    maxBody: 20_000,
    singleLine: false,
    maxConsecutiveNewlines: 4,
  },
  SMS: {
    subject: 'none',
    maxSubject: 0,
    maxBody: 480,
    singleLine: true,
    maxConsecutiveNewlines: 1,
  },
  WHATSAPP: {
    subject: 'none',
    maxSubject: 0,
    maxBody: 1024,
    singleLine: false,
    maxConsecutiveNewlines: 2,
  },
  PUSH: {
    subject: 'required',
    maxSubject: 64,
    maxBody: 178,
    singleLine: true,
    maxConsecutiveNewlines: 1,
  },
  IN_APP: {
    subject: 'optional',
    maxSubject: 200,
    maxBody: 4000,
    singleLine: false,
    maxConsecutiveNewlines: 4,
  },
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value
}

/**
 * Substitutes and reports what it could not resolve.
 *
 * An unresolved placeholder is dropped rather than left literal: a student
 * reading `{{fee.amount}}` in a WhatsApp message reads it as a broken product.
 * The typo is caught instead at edit time, by `missing` here and by
 * `unknownVariables` in the admin editor.
 */
function substitute(
  template: string,
  variables: TemplateVariables,
  missing: Set<string>,
): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = variables[key]
    if (value === undefined) {
      missing.add(key)
      return ''
    }
    return value
  })
}

function shapeBody(body: string, shape: ChannelShape): string {
  const normalized = body.replace(/\r\n/g, '\n')

  if (shape.singleLine) {
    return truncate(normalized.replace(/\s+/g, ' ').trim(), shape.maxBody)
  }

  const shaped = normalized
    // Collapse newline runs left behind by a dropped placeholder that occupied a
    // line of its own, and keep WhatsApp inside what it will accept.
    .replace(
      new RegExp(`\\n{${shape.maxConsecutiveNewlines + 1},}`, 'g'),
      '\n'.repeat(shape.maxConsecutiveNewlines),
    )
    .split('\n')
    .map((line) => line.replace(/[^\S\n]{2,}/g, ' ').trimEnd())
    .join('\n')

  return truncate(shaped.trim(), shape.maxBody)
}

/** First sentence or line, for channels that demand a title the author omitted. */
function synthesizeSubject(body: string, max: number): string {
  const firstLine = body.split('\n').find((line) => line.trim().length > 0) ?? ''
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine
  return truncate(sentence.trim(), max)
}

export function renderForChannel(
  template: RenderableTemplate,
  channel: NotificationChannelType,
  variables: TemplateVariables,
): RenderedMessage {
  const shape = CHANNEL_SHAPES[channel]
  const missing = new Set<string>()

  const body = shapeBody(substitute(template.body, variables, missing), shape)

  const rawSubject = template.subject
    ? substitute(template.subject, variables, missing).replace(/\s+/g, ' ').trim()
    : ''

  let subject: string | null
  switch (shape.subject) {
    case 'none':
      // SMS and WhatsApp have nowhere to put it. Both packs' templates repeat the
      // essentials in the body, which is the shape a subject-less channel needs.
      subject = null
      break
    case 'required':
      subject = truncate(rawSubject || synthesizeSubject(body, shape.maxSubject), shape.maxSubject)
      break
    case 'optional':
      subject = rawSubject ? truncate(rawSubject, shape.maxSubject) : null
      break
  }

  return { subject, body, missing: [...missing] }
}

/**
 * Placeholders a template uses that a given variable set cannot supply.
 *
 * Surfaced in the admin editor against the trigger's own sample context, so a
 * template that references `{{test.rank}}` — which no core trigger produces —
 * is caught while it is being written rather than after it has sent a hundred
 * messages with a hole in them.
 */
export function unknownVariables(
  template: RenderableTemplate,
  variables: TemplateVariables,
): string[] {
  const found = [
    ...`${template.subject ?? ''}\n${template.body}`.matchAll(PLACEHOLDER),
  ].map((match) => match[1]!)
  return [...new Set(found.filter((key) => variables[key] === undefined))]
}

/** Every placeholder a template references, in first-seen order. */
export function referencedVariables(template: RenderableTemplate): string[] {
  const found = [
    ...`${template.subject ?? ''}\n${template.body}`.matchAll(PLACEHOLDER),
  ].map((match) => match[1]!)
  return [...new Set(found)]
}
