import Link from 'next/link'

import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/labels'
import { enquiryHref } from '@/server/marketing/links'

/**
 * Public site header.
 *
 * Nav labels come from `t()` so a vertical that renames "Course" carries the
 * rename into its marketing site as well as its app — the coaching pack's
 * "Live Classes" and a music school's "Programmes" must not need a second
 * translation layer here.
 */
export function SiteHeader({
  orgName,
  logoUrl,
  showCatalogLink,
  showEnquiryLink,
}: {
  orgName: string
  logoUrl: string | null
  showCatalogLink: boolean
  showEnquiryLink: boolean
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-surface-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-content">
          <BrandLogo src={logoUrl} orgName={orgName} className="h-8 w-auto" />
        </Link>

        <nav aria-label="Primary" className="ml-auto flex items-center gap-1 sm:gap-3">
          {showCatalogLink && (
            <Link
              href="/#programmes"
              className="rounded-brand px-2 py-1 text-sm text-content-muted transition-colors hover:text-content sm:px-3"
            >
              {t('course.plural')}
            </Link>
          )}

          <Link
            href="/sign-in"
            className="rounded-brand px-2 py-1 text-sm text-content-muted transition-colors hover:text-content sm:px-3"
          >
            {t('action.signIn')}
          </Link>

          {showEnquiryLink && (
            <Link href={enquiryHref()}>
              <Button size="sm">Enquire</Button>
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}
