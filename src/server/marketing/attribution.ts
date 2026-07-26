/**
 * Lead attribution.
 *
 * Campaign parameters arrive in the query string of a public page, which means
 * they are attacker-controlled: anyone can hand a prospect a link carrying any
 * `utm_*` they like, and a bot can POST whatever it wants straight to the action.
 * They are captured anyway, because marketing spend is unattributable without
 * them — but they are treated as exactly one thing: opaque data on `Lead.utm`.
 *
 * Nothing produced here may reach a redirect, a query filter, a notification
 * template or an outbound request. The `source` a form declares is likewise not
 * believed; it is matched against the brand's configured landing pages and
 * falls back to `unknown`, so a crafted POST cannot attach an enquiry to a
 * course the client never advertised.
 */

/**
 * Name of the honeypot input on the lead form. Lives here rather than beside the
 * action because a `'use server'` module may export nothing but async functions,
 * and both the form and the action need the same string.
 */
export const HONEYPOT_FIELD = 'company'

export const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'ref',
] as const

export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number]
export type Attribution = Partial<Record<AttributionKey, string>>

/** Long enough for real campaign names, short enough that the column is not a payload. */
const MAX_VALUE_LENGTH = 200

/** Next's searchParams shape, and also what `Object.fromEntries(formData)` yields. */
export type RawParams = Record<string, string | string[] | undefined | null>

function firstValue(value: string | string[] | undefined | null): string | null {
  if (Array.isArray(value)) return value.length > 0 ? (value[0] ?? null) : null
  return typeof value === 'string' ? value : null
}

/**
 * Strips control characters, which are invisible in an admin's lead table and
 * are the usual way a log or CSV export gets forged a line break.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

function clean(value: string): string {
  return value
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_VALUE_LENGTH)
}

export function sanitizeAttribution(raw: RawParams | null | undefined): Attribution {
  if (!raw || typeof raw !== 'object') return {}

  const attribution: Attribution = {}
  for (const key of ATTRIBUTION_KEYS) {
    const value = firstValue(raw[key])
    if (value === null) continue
    const cleaned = clean(value)
    if (cleaned.length > 0) attribution[key] = cleaned
  }
  return attribution
}

// -----------------------------------------------------------------------------
// Lead source
// -----------------------------------------------------------------------------

export const LEAD_SOURCE_HUB = 'hub'
export const LEAD_SOURCE_UNKNOWN = 'unknown'
const LANDING_PREFIX = 'landing:'

export function landingSource(slug: string): string {
  return `${LANDING_PREFIX}${slug}`
}

/**
 * Resolves the form's declared origin against the landing pages this deployment
 * actually publishes. Anything else becomes `unknown` rather than being stored
 * verbatim, so the column stays a small closed set that admin can group by.
 */
export function resolveLeadSource(raw: unknown, landingSlugs: readonly string[]): string {
  if (typeof raw !== 'string') return LEAD_SOURCE_UNKNOWN

  const value = raw.trim()
  if (value === LEAD_SOURCE_HUB) return LEAD_SOURCE_HUB
  if (!value.startsWith(LANDING_PREFIX)) return LEAD_SOURCE_UNKNOWN

  const slug = value.slice(LANDING_PREFIX.length)
  return landingSlugs.includes(slug) ? landingSource(slug) : LEAD_SOURCE_UNKNOWN
}

/** The landing page a resolved source came from, or null for the hub. */
export function landingSlugFromSource(source: string): string | null {
  return source.startsWith(LANDING_PREFIX) ? source.slice(LANDING_PREFIX.length) : null
}
