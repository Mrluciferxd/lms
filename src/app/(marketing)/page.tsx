import type { Metadata } from 'next'
import Link from 'next/link'

import { EnquirySection } from '@/components/marketing/enquiry-section'
import { JsonLd } from '@/components/marketing/json-ld'
import { ProgrammeCard } from '@/components/marketing/programme-card'
import {
  CtaSection,
  FaqSection,
  InstructorsSection,
  RichTextSection,
  TestimonialsSection,
  ValuePropsSection,
} from '@/components/marketing/sections'
import { Button } from '@/components/ui/button'
import { brand } from '@/lib/brand'
import { t } from '@/lib/labels'
import { sanitizeAttribution, LEAD_SOURCE_HUB, type RawParams } from '@/server/marketing/attribution'
import { blocksOfType, findBlock } from '@/server/marketing/blocks'
import {
  HUB_PAGE_SLUG,
  getMarketingPage,
  listAvailableLandingPages,
  listProgrammes,
} from '@/server/marketing/content'
import { checkoutHref, enquiryHref, landingHref } from '@/server/marketing/links'
import {
  absoluteUrl,
  faqJsonLd,
  isIndexable,
  organizationJsonLd,
  summarize,
} from '@/server/marketing/seo'
import { getOrgDisplay, getOrgSettings, isFeatureEnabled } from '@/server/org/settings'

/**
 * The marketing hub.
 *
 * Nothing on this page is written in this file. Copy comes from the brand config
 * (identity: name, tagline, description) or from the database — published
 * courses for the programme grid, and `Page("home").blocks` for value props,
 * instructor credibility, testimonials and FAQ. That is what lets one build
 * serve a trading academy and a coaching institute without a fork: swap the
 * brand and the rows, and the page reads as theirs.
 *
 * Sections whose content is absent do not render. A fresh deployment with no CMS
 * content shows a hero, its catalogue and an enquiry form — thin, but coherent
 * and never a placeholder promising copy that does not exist.
 */

export async function generateMetadata(): Promise<Metadata> {
  const [org, page] = await Promise.all([getOrgDisplay(), getMarketingPage(HUB_PAGE_SLUG)])
  const description = page.seoDescription ?? brand.marketing.description
  const url = absoluteUrl('/')

  return {
    // `absolute` so the root layout's "%s · Brand" template does not repeat the
    // brand name twice on the one page that is already all about it.
    title: { absolute: page.seoTitle ?? `${org.name} — ${brand.marketing.tagline}` },
    description: summarize(description),
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: org.name,
      title: page.seoTitle ?? org.name,
      description: summarize(description),
      images: page.ogImageUrl ? [page.ogImageUrl] : undefined,
    },
    robots: { index: isIndexable(), follow: isIndexable() },
  }
}

export default async function MarketingHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [params, org, settings, page, available, publicCatalog, leadCapture, selfServeCheckout] =
    await Promise.all([
      searchParams,
      getOrgDisplay(),
      getOrgSettings(),
      getMarketingPage(HUB_PAGE_SLUG),
      listAvailableLandingPages(),
      isFeatureEnabled('publicCatalog'),
      isFeatureEnabled('leadCapture'),
      isFeatureEnabled('selfServeCheckout'),
    ])

  const programmes = publicCatalog ? await listProgrammes() : []
  const blocks = page.blocks

  const hero = findBlock(blocks, 'hero')
  const valueProps = findBlock(blocks, 'valueProps')
  const instructors = findBlock(blocks, 'instructors')
  const testimonials = findBlock(blocks, 'testimonials')
  const faq = findBlock(blocks, 'faq')
  const cta = findBlock(blocks, 'cta')
  const richTextBlocks = blocksOfType(blocks, 'richText')

  const featured = available[0] ?? null
  const primaryCtaHref =
    hero?.ctaHref ??
    (featured ? landingHref(featured.slug) : leadCapture ? enquiryHref() : '/sign-in')

  return (
    <>
      <JsonLd
        data={organizationJsonLd({
          name: org.name,
          url: absoluteUrl('/'),
          description: brand.marketing.description,
          logoUrl: org.logoLightUrl ? absoluteUrl(org.logoLightUrl) : null,
          email: org.supportEmail,
          telephone: org.supportPhone,
          sameAs: Object.values(brand.marketing.social ?? {}).filter(
            (url): url is string => typeof url === 'string' && url.startsWith('https://'),
          ),
        })}
      />
      {faq && <JsonLd data={faqJsonLd(faq.items)} />}

      <section aria-labelledby="hero-heading" className="border-b border-surface-border">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <p className="text-sm font-medium uppercase tracking-wide text-content-muted">
            {brand.marketing.tagline}
          </p>

          <h1
            id="hero-heading"
            className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-content sm:text-5xl"
          >
            {hero?.headline ?? org.name}
          </h1>

          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-content-muted">
            {hero?.subheadline ?? brand.marketing.description}
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link href={primaryCtaHref}>
              <Button size="lg">{hero?.ctaLabel ?? `Explore ${t('course.plural')}`}</Button>
            </Link>
            <Link href="/sign-in">
              <Button size="lg" variant="secondary">
                {t('action.signIn')}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {valueProps && <ValuePropsSection block={valueProps} />}

      {publicCatalog && programmes.length > 0 && (
        <section
          id="programmes"
          aria-labelledby="programmes-heading"
          className="border-t border-surface-border bg-surface-muted"
        >
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2
              id="programmes-heading"
              className="text-2xl font-semibold tracking-tight text-content sm:text-3xl"
            >
              {t('course.plural')}
            </h2>

            <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {programmes.map((programme) => (
                <ProgrammeCard
                  key={programme.id}
                  programme={programme}
                  timezone={settings.timezone}
                  locale={settings.locale}
                  selfServeCheckout={selfServeCheckout}
                />
              ))}
            </ul>
          </div>
        </section>
      )}

      {instructors && <InstructorsSection block={instructors} />}
      {testimonials && <TestimonialsSection block={testimonials} />}

      {richTextBlocks.map((block, index) => (
        <RichTextSection key={index} block={block} index={index} />
      ))}

      {faq && <FaqSection block={faq} />}

      {(cta || featured) && (
        <CtaSection
          block={cta}
          fallbackHref={
            featured
              ? landingHref(featured.slug)
              : selfServeCheckout && programmes[0]
                ? checkoutHref(programmes[0].slug)
                : enquiryHref()
          }
          fallbackLabel={`See the ${t('course.singular')}`}
        />
      )}

      {leadCapture && (
        <EnquirySection
          source={LEAD_SOURCE_HUB}
          attribution={sanitizeAttribution(params as RawParams)}
          heading="Talk to us"
          body="Tell us what you are looking for and we will point you at the right place to start."
        />
      )}
    </>
  )
}
