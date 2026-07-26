import type { MetadataRoute } from 'next'

import { getLandingPage, landingPages } from '@/server/marketing/content'
import { absoluteUrl, isIndexable } from '@/server/marketing/seo'

/**
 * The public URL set.
 *
 * Only pages an anonymous visitor can actually load: the hub, each configured
 * landing page whose course is published, and that course's free preview
 * lessons. A sitemap listing URLs that 404 or redirect to sign-in is worse than
 * no sitemap — it spends crawl budget and drags down the pages that do matter.
 *
 * Built from the database rather than a static list so publishing a course, or
 * marking one more lesson as a preview, shows up without a code change.
 */
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Nothing to advertise from a staging build; robots.ts already disallows all.
  if (!isIndexable()) return []

  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), changeFrequency: 'weekly', priority: 1 },
  ]

  const resolved = await Promise.all(landingPages().map((page) => getLandingPage(page.slug)))

  for (const landing of resolved) {
    if (!landing) continue

    entries.push({
      url: absoluteUrl(`/${landing.config.slug}`),
      lastModified: landing.course.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.9,
    })

    for (const lesson of landing.previewLessons) {
      entries.push({
        url: absoluteUrl(`/${landing.config.slug}/preview/${lesson.id}`),
        lastModified: landing.course.updatedAt,
        changeFrequency: 'monthly',
        priority: 0.5,
      })
    }
  }

  return entries
}
