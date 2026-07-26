/**
 * Forensic watermark rendering.
 *
 * Burns viewer identity into the played stream. This does not prevent recording —
 * nothing can, see docs/06-video-security.md — but it makes a recording
 * *attributable*, which converts an anonymous act into a traceable one. For a
 * paid cohort programme this is the highest-leverage deterrent available, and the
 * only one that survives the phone-camera case, since the overlay is in frame
 * either way.
 *
 * The template lives in brand config (`videoSecurity.watermarkTemplate`) and is
 * mirrored to OrgSettings so a client can adjust how intrusive it is without a
 * deploy.
 */

/** Keeps the overlay legible and bounds what reaches a provider's API. */
const MAX_FIELD_LENGTH = 64
const MAX_OUTPUT_LENGTH = 200

/** C0 controls, DEL and C1 controls — covers newlines and tabs. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g

/** Braces would let a value inject another placeholder on re-render. */
const BRACES = /[{}]/g

export interface WatermarkSubject {
  userId: string
  name: string
  email: string | null
  ip: string | null
}

export interface WatermarkOptions {
  timezone: string
  locale: string
  now: Date
}

function sanitize(value: string): string {
  const cleaned = value.replace(CONTROL_CHARS, '').replace(BRACES, '').trim()
  return cleaned.length > MAX_FIELD_LENGTH
    ? `${cleaned.slice(0, MAX_FIELD_LENGTH - 1)}…`
    : cleaned
}

/**
 * `a***@example.com`. Offered as a separate variable so a client can choose
 * between maximum traceability and not putting a student's full address on screen
 * in a frame they might share.
 */
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0) return sanitize(email)
  const local = email.slice(0, at)
  const domain = email.slice(at)
  const head = local.slice(0, 1)
  return sanitize(`${head}${'*'.repeat(Math.max(local.length - 1, 1))}${domain}`)
}

export function watermarkVariables(
  subject: WatermarkSubject,
  options: WatermarkOptions,
): Record<string, string> {
  const email = subject.email ?? ''
  return {
    name: sanitize(subject.name),
    email: sanitize(email),
    emailMasked: email ? maskEmail(email) : '',
    userId: sanitize(subject.userId),
    /** Last six characters — identifies the account without dominating the frame. */
    shortId: sanitize(subject.userId.slice(-6)),
    ip: sanitize(subject.ip ?? ''),
    date: new Intl.DateTimeFormat(options.locale, {
      dateStyle: 'short',
      timeZone: options.timezone,
    }).format(options.now),
    time: new Intl.DateTimeFormat(options.locale, {
      timeStyle: 'short',
      timeZone: options.timezone,
    }).format(options.now),
  }
}

/**
 * Renders the template. Unresolved placeholders are dropped rather than left
 * literal — a student seeing `{{ip}}` on screen looks like a bug, whereas the
 * missing-variable case is caught by `unknownWatermarkVariables` at config time.
 *
 * Separators orphaned by an empty value are collapsed, so `{{name}} · {{ip}}`
 * does not render as `Asha ·` when the IP is unknown.
 */
export function renderWatermark(
  template: string,
  subject: WatermarkSubject,
  options: WatermarkOptions,
): string {
  const variables = watermarkVariables(subject, options)

  const rendered = template
    .replace(/\{\{(\w+)\}\}/g, (_match, key: string) => variables[key] ?? '')
    // Drop a separator whose right-hand side is empty, repeatedly.
    .replace(/\s*·\s*(?=\s*·|\s*$)/g, '')
    // Drop a leading separator left by an empty first value.
    .replace(/^\s*·\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  return rendered.length > MAX_OUTPUT_LENGTH ? rendered.slice(0, MAX_OUTPUT_LENGTH) : rendered
}

/**
 * Placeholders a template uses that this renderer does not supply. Surfaced in
 * admin when the template is edited, so a typo is caught there rather than
 * silently producing a thinner watermark than the client believes they have.
 */
export function unknownWatermarkVariables(template: string): string[] {
  const known = new Set(
    Object.keys(
      watermarkVariables(
        { userId: 'x', name: 'x', email: 'x@x.x', ip: '0.0.0.0' },
        { timezone: 'UTC', locale: 'en', now: new Date(0) },
      ),
    ),
  )
  const found = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]!)
  return [...new Set(found.filter((key) => !known.has(key)))]
}
