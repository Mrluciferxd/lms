import { SiteFooter } from '@/components/marketing/site-footer'
import { SiteHeader } from '@/components/marketing/site-header'
import { getOrgDisplay, isFeatureEnabled } from '@/server/org/settings'

/**
 * Public site chrome.
 *
 * Every page below this reads the database — published courses, CMS blocks, open
 * cohorts — so the segment is dynamic rather than prerendered. Static generation
 * would freeze the catalogue at build time and mean a client publishing a course
 * has to wait for a deploy to see it, which is the opposite of what the CMS is
 * for.
 */
export const dynamic = 'force-dynamic'

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [org, publicCatalog, leadCapture] = await Promise.all([
    getOrgDisplay(),
    isFeatureEnabled('publicCatalog'),
    isFeatureEnabled('leadCapture'),
  ])

  return (
    <div className="flex min-h-screen flex-col">
      {/* First focusable element on the page, so a keyboard user is not walked
          through the whole header on every navigation. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-20 focus:rounded-brand focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <SiteHeader
        orgName={org.name}
        logoUrl={org.logoLightUrl}
        showCatalogLink={publicCatalog}
        showEnquiryLink={leadCapture}
      />

      <main id="main" className="flex-1">
        {children}
      </main>

      <SiteFooter
        orgName={org.name}
        supportEmail={org.supportEmail}
        supportPhone={org.supportPhone}
      />
    </div>
  )
}
