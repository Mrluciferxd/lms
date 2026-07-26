import Link from 'next/link'

import { t } from '@/lib/labels'
import { formatDate, formatMoney } from '@/lib/utils'
import { checkoutHref, enquiryHref, landingHref } from '@/server/marketing/links'
import type { ProgrammeCard as Programme } from '@/server/marketing/content'

/**
 * One published course, as it appears on the hub.
 *
 * Everything on the card is a database value or a `t()` label — no vertical
 * knows what a "programme" is, so the noun comes from `course.singular` and the
 * copy comes from the course row the client wrote.
 */
export function ProgrammeCard({
  programme,
  timezone,
  locale,
  selfServeCheckout,
}: {
  programme: Programme
  timezone: string
  locale: string
  selfServeCheckout: boolean
}) {
  /**
   * A landing page is the better destination when the brand configured one: it
   * is the page with the pitch, the curriculum and the preview lessons. Without
   * one, the card sends people to whichever conversion path this deployment has.
   */
  const href = programme.landingSlug
    ? landingHref(programme.landingSlug)
    : selfServeCheckout
      ? checkoutHref(programme.slug)
      : enquiryHref()

  const hours = Math.round(programme.totalDurationSec / 3600)

  return (
    <li className="relative flex flex-col overflow-hidden rounded-brand border border-surface-border bg-surface transition-colors hover:border-primary/40">
      {programme.thumbnailUrl && (
        // Client-supplied artwork of unknown host and intrinsic size.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={programme.thumbnailUrl}
          alt=""
          aria-hidden
          loading="lazy"
          className="aspect-[16/9] w-full object-cover"
        />
      )}

      <div className="flex flex-1 flex-col p-5">
        {programme.level && (
          <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
            {programme.level}
          </p>
        )}

        <h3 className="mt-1 text-lg font-semibold text-content">
          <Link href={href} className="after:absolute after:inset-0">
            {programme.title}
          </Link>
        </h3>

        {programme.subtitle && (
          <p className="mt-1 text-sm leading-relaxed text-content-muted">{programme.subtitle}</p>
        )}

        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-muted">
          {programme.sectionCount > 0 && (
            <li>
              {programme.sectionCount} {t('section.plural')}
            </li>
          )}
          {programme.lessonCount > 0 && (
            <li>
              {programme.lessonCount} {t('lesson.plural')}
            </li>
          )}
          {hours > 0 && <li>{hours}h of content</li>}
          {programme.previewCount > 0 && <li>{programme.previewCount} free to preview</li>}
        </ul>

        {programme.nextBatchStartDate && (
          <p className="mt-3 text-sm text-content">
            <span className="text-content-muted">Next {t('batch.singular')}: </span>
            {formatDate(programme.nextBatchStartDate, timezone, locale)}
          </p>
        )}

        <div className="mt-auto flex items-baseline gap-2 pt-5">
          {programme.priceMinor !== null ? (
            <>
              <span className="text-lg font-semibold text-content">
                {formatMoney(programme.priceMinor, programme.currency, locale)}
              </span>
              {programme.compareAtPriceMinor !== null &&
                programme.compareAtPriceMinor > programme.priceMinor && (
                  <span className="text-sm text-content-muted line-through">
                    {formatMoney(programme.compareAtPriceMinor, programme.currency, locale)}
                  </span>
                )}
            </>
          ) : (
            <span className="text-sm text-content-muted">Enquire for pricing</span>
          )}
        </div>
      </div>
    </li>
  )
}
