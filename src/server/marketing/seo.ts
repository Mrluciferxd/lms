/**
 * Search metadata and structured data.
 *
 * Pure builders returning plain objects, so the JSON-LD a crawler receives is
 * assertable in a unit test rather than something you find out about from Search
 * Console six weeks after launch.
 *
 * Indexability is one function used by robots.ts, sitemap.ts and every page's
 * metadata. A staging deployment that gets indexed competes with the client's
 * own domain for their own brand terms, and de-indexing takes weeks — so the
 * check lives in one place and defaults to "not indexable".
 */

import { brand } from '@/lib/brand'

export function isIndexable(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === 'production'
}

/** Matches `metadataBase` in the root layout, so canonical URLs agree with OG URLs. */
export function siteBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? `https://${brand.domain}`
}

export function absoluteUrl(path: string, base: string = siteBaseUrl()): string {
  return new URL(path, base).toString()
}

/**
 * Minor units as a plain decimal string for structured data.
 *
 * Not `formatMoney`: schema.org `price` must be an unlocalized number with a dot
 * separator and no symbol or grouping — exactly what Intl exists to add. Done
 * with integer arithmetic so no float touches currency here either.
 */
export function minorToDecimalString(amountMinor: number): string {
  const rounded = Math.trunc(amountMinor)
  const sign = rounded < 0 ? '-' : ''
  const absolute = Math.abs(rounded)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

/**
 * `JSON.stringify` output is not safe to drop into a `<script>` element: a course
 * description containing `</script>` closes the tag and everything after it is
 * parsed as markup. Escaping `<` keeps the JSON valid and the element intact.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** Collapses whitespace and truncates on a word boundary, for meta descriptions. */
export function summarize(text: string | null | undefined, maxLength = 160): string | undefined {
  if (!text) return undefined

  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length === 0) return undefined
  if (collapsed.length <= maxLength) return collapsed

  const clipped = collapsed.slice(0, maxLength - 1)
  const lastSpace = clipped.lastIndexOf(' ')
  return `${(lastSpace > maxLength / 2 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`
}

// -----------------------------------------------------------------------------
// Structured data
// -----------------------------------------------------------------------------

const SCHEMA_CONTEXT = 'https://schema.org'

export interface OrganizationJsonLdInput {
  name: string
  url: string
  description?: string | null
  logoUrl?: string | null
  email?: string | null
  telephone?: string | null
  /** Social profiles, which is how a knowledge panel gets linked to the client. */
  sameAs?: string[]
}

/**
 * `EducationalOrganization` rather than `Organization`: it is the accurate type
 * for every vertical this platform serves — a trading academy, a coaching
 * institute, a music school — and it costs nothing to be specific.
 */
export function organizationJsonLd(input: OrganizationJsonLdInput): Record<string, unknown> {
  return prune({
    '@context': SCHEMA_CONTEXT,
    '@type': 'EducationalOrganization',
    name: input.name,
    url: input.url,
    description: input.description ?? undefined,
    logo: input.logoUrl ?? undefined,
    email: input.email ?? undefined,
    telephone: input.telephone ?? undefined,
    sameAs: input.sameAs && input.sameAs.length > 0 ? input.sameAs : undefined,
  })
}

export interface CourseInstanceInput {
  startDate: Date
  endDate: Date | null
}

export interface CourseJsonLdInput {
  name: string
  description?: string | null
  url: string
  provider: { name: string; url: string }
  imageUrl?: string | null
  /** Null means "not directly purchasable" — no `offers` is emitted. */
  priceMinor?: number | null
  currency?: string
  inLanguage?: string
  /** Upcoming cohorts. Google rejects a Course with no `hasCourseInstance`. */
  instances?: readonly CourseInstanceInput[]
}

export function courseJsonLd(input: CourseJsonLdInput): Record<string, unknown> {
  const instances = input.instances ?? []

  return prune({
    '@context': SCHEMA_CONTEXT,
    '@type': 'Course',
    name: input.name,
    description: summarize(input.description, 500),
    url: input.url,
    image: input.imageUrl ?? undefined,
    inLanguage: input.inLanguage ?? undefined,
    provider: {
      '@type': 'EducationalOrganization',
      name: input.provider.name,
      url: input.provider.url,
    },
    offers:
      input.priceMinor !== null && input.priceMinor !== undefined
        ? {
            '@type': 'Offer',
            price: minorToDecimalString(input.priceMinor),
            priceCurrency: input.currency ?? 'INR',
            // Required by Google alongside `price`; a free programme is still an offer.
            category: input.priceMinor === 0 ? 'Free' : 'Paid',
            availability: 'https://schema.org/InStock',
            url: input.url,
          }
        : undefined,
    /**
     * A cohort product always has instances, but a self-paced course may have no
     * batch rows at all. `Online` + `Self-Paced` is the accurate description of
     * that case and keeps the entity valid instead of omitting it.
     */
    hasCourseInstance:
      instances.length > 0
        ? instances.map((instance) =>
            prune({
              '@type': 'CourseInstance',
              courseMode: 'Online',
              startDate: isoDate(instance.startDate),
              endDate: instance.endDate ? isoDate(instance.endDate) : undefined,
            }),
          )
        : [{ '@type': 'CourseInstance', courseMode: 'Online', courseSchedule: 'Self-Paced' }],
  })
}

export interface FaqItem {
  question: string
  answer: string
}

export function faqJsonLd(items: readonly FaqItem[]): Record<string, unknown> | null {
  if (items.length === 0) return null

  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  }
}

/** Dates in structured data are date-only ISO; a time would imply a precision batches do not carry. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Drops undefined keys so the emitted JSON has no empty properties for a crawler to trip on. */
function prune(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}
