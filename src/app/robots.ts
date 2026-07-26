import type { MetadataRoute } from 'next'

import { absoluteUrl, isIndexable } from '@/server/marketing/seo'

/**
 * Staging deployments must not be indexed.
 *
 * With one deployment per client there is a preview environment per client too,
 * and an indexed staging site competes with the client's own domain for their
 * own brand terms — with de-indexing measured in weeks. So anything that is not
 * a production build disallows everything, rather than relying on someone
 * remembering to set a header.
 *
 * In production the authenticated areas are excluded as well. They are already
 * behind auth, but a crawler following a link into /app burns budget on sign-in
 * redirects and can surface the URLs in search results.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isIndexable()) {
    return { rules: { userAgent: '*', disallow: '/' } }
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/app', '/admin', '/api', '/sign-in'],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
  }
}
