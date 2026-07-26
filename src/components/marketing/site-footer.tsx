import Link from 'next/link'

import { brand } from '@/lib/brand'

/**
 * Public site footer.
 *
 * `marketing.riskDisclaimer` renders here whenever the brand sets it, and only
 * then. For a financial-education client this block is a regulatory requirement
 * rather than decoration — see docs/04-white-label.md — so it is not collapsed,
 * not truncated and not behind a toggle. Verticals with no such obligation leave
 * the field unset and the block does not render at all.
 */

const SOCIAL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  telegram: 'Telegram',
  x: 'X',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
}

/** Brand config is ours, but a typo that becomes a `javascript:` href is still an XSS. */
function isExternalUrl(value: string): boolean {
  return value.startsWith('https://')
}

export function SiteFooter({
  orgName,
  supportEmail,
  supportPhone,
}: {
  orgName: string
  supportEmail: string
  supportPhone: string | null
}) {
  const legal = brand.legal
  const socials = Object.entries(brand.marketing.social ?? {}).filter(
    ([key, url]) => typeof url === 'string' && isExternalUrl(url) && key in SOCIAL_LABELS,
  ) as Array<[string, string]>

  const legalLinks = [
    { href: legal?.termsUrl, label: 'Terms' },
    { href: legal?.privacyUrl, label: 'Privacy' },
    { href: legal?.refundUrl, label: 'Refunds' },
  ].filter((link): link is { href: string; label: string } => Boolean(link.href))

  return (
    <footer className="mt-20 border-t border-surface-border bg-surface-muted">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-content">{orgName}</p>
            <p className="max-w-sm text-sm text-content-muted">{brand.marketing.tagline}</p>
          </div>

          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
              Contact
            </h2>
            <ul className="space-y-1 text-sm text-content-muted">
              <li>
                <a href={`mailto:${supportEmail}`} className="underline underline-offset-4 hover:text-content">
                  {supportEmail}
                </a>
              </li>
              {supportPhone && (
                <li>
                  <a href={`tel:${supportPhone}`} className="underline underline-offset-4 hover:text-content">
                    {supportPhone}
                  </a>
                </li>
              )}
              {legal?.address && <li className="max-w-xs">{legal.address}</li>}
              {legal?.gstin && <li>GSTIN {legal.gstin}</li>}
            </ul>
          </div>

          {(legalLinks.length > 0 || socials.length > 0) && (
            <div className="space-y-4">
              {legalLinks.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                    Policies
                  </h2>
                  <ul className="space-y-1 text-sm text-content-muted">
                    {legalLinks.map((link) => (
                      <li key={link.label}>
                        <Link href={link.href} className="underline underline-offset-4 hover:text-content">
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {socials.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                    Follow
                  </h2>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-content-muted">
                    {socials.map(([key, url]) => (
                      <li key={key}>
                        <a
                          href={url}
                          rel="noreferrer noopener"
                          target="_blank"
                          className="underline underline-offset-4 hover:text-content"
                        >
                          {SOCIAL_LABELS[key]}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {brand.marketing.riskDisclaimer && (
          <section
            aria-labelledby="risk-disclaimer-heading"
            className="rounded-brand border border-surface-border bg-surface px-4 py-4"
          >
            <h2
              id="risk-disclaimer-heading"
              className="text-xs font-semibold uppercase tracking-wide text-content-muted"
            >
              Important information
            </h2>
            <p className="mt-2 max-w-4xl text-xs leading-relaxed text-content-muted">
              {brand.marketing.riskDisclaimer}
            </p>
          </section>
        )}

        <p className="text-xs text-content-muted">
          © {new Date().getFullYear()} {brand.legalName ?? orgName}
        </p>
      </div>
    </footer>
  )
}
