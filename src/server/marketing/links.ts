/**
 * Outbound routes from the marketing site.
 *
 * Collected here because these are contracts with surfaces this module does not
 * own — checkout, sign-in, the student area. When one of them moves, one file
 * changes rather than every CTA on the public site.
 */

/** Anchor the enquiry form is mounted at on both the hub and landing pages. */
export const ENQUIRY_ANCHOR = 'enquire'

export function landingHref(slug: string): string {
  return `/${slug}`
}

export function previewHref(landingSlug: string, lessonId: string): string {
  return `/${landingSlug}/preview/${lessonId}`
}

/**
 * Self-serve checkout for a course. Owned by the payments module; the course is
 * identified by slug rather than id so a public link never carries a database
 * identifier and stays readable in an ad.
 */
export function checkoutHref(courseSlug: string): string {
  return `/checkout?course=${encodeURIComponent(courseSlug)}`
}

export function enquiryHref(landingSlug?: string): string {
  return landingSlug ? `/${landingSlug}#${ENQUIRY_ANCHOR}` : `/#${ENQUIRY_ANCHOR}`
}
