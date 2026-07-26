import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EnquirySection } from '@/components/marketing/enquiry-section'
import { JsonLd } from '@/components/marketing/json-ld'
import {
  FaqSection,
  InstructorsSection,
  RichTextSection,
  TestimonialsSection,
  ValuePropsSection,
} from '@/components/marketing/sections'
import { Button } from '@/components/ui/button'
import { brand } from '@/lib/brand'
import { t } from '@/lib/labels'
import { formatDate, formatDuration, formatMoney } from '@/lib/utils'
import {
  landingSource,
  sanitizeAttribution,
  type RawParams,
} from '@/server/marketing/attribution'
import { blocksOfType, findBlock } from '@/server/marketing/blocks'
import { getLandingPage } from '@/server/marketing/content'
import { checkoutHref, enquiryHref, previewHref } from '@/server/marketing/links'
import { absoluteUrl, courseJsonLd, faqJsonLd, isIndexable, summarize } from '@/server/marketing/seo'
import { getOrgDisplay, getOrgSettings, isFeatureEnabled } from '@/server/org/settings'

/**
 * A course landing page, driven by `brand.marketing.landingPages[]`.
 *
 * The brand config decides which courses get a sales page and supplies the
 * headline; everything else — curriculum, pricing, cohort dates, free previews —
 * is the course row, so the page cannot drift from what is actually being sold.
 *
 * The route is bounded by configuration rather than by the database:
 * `getLandingPage` resolves the slug against `brand.marketing.landingPages`
 * first and returns null before any query runs, so this dynamic segment cannot
 * be used to probe for course slugs.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const landing = await getLandingPage(slug)
  if (!landing) return {}

  const { config, course, page } = landing

  // CMS first, then the course row, then the brand config — most-editable wins,
  // so a marketer can retitle a page without an admin touching the course.
  const title = page.seoTitle ?? course.seoTitle ?? config.headline
  const description =
    page.seoDescription ??
    course.seoDescription ??
    config.subheadline ??
    course.subtitle ??
    course.description
  const image = page.ogImageUrl ?? course.ogImageUrl
  const url = absoluteUrl(`/${slug}`)

  return {
    title,
    description: summarize(description),
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      title,
      description: summarize(description),
      images: image ? [image] : undefined,
    },
    robots: { index: isIndexable(), follow: isIndexable() },
  }
}

export default async function LandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const landing = await getLandingPage(slug)

  // Covers an unconfigured slug, a deleted course and a course pulled back to
  // draft. A landing page for unpublished content would advertise something
  // nobody can buy and disclose its title early.
  if (!landing) notFound()

  const { config, course, curriculum, previewLessons, totals, openBatches } = landing
  const blocks = landing.page.blocks

  const [org, settings, leadCapture, selfServeCheckout] = await Promise.all([
    getOrgDisplay(),
    getOrgSettings(),
    isFeatureEnabled('leadCapture'),
    isFeatureEnabled('selfServeCheckout'),
  ])

  const valueProps = findBlock(blocks, 'valueProps')
  const instructors = findBlock(blocks, 'instructors')
  const testimonials = findBlock(blocks, 'testimonials')
  const faq = findBlock(blocks, 'faq')
  const richTextBlocks = blocksOfType(blocks, 'richText')

  const purchasable = selfServeCheckout && course.priceMinor !== null
  const ctaHref = purchasable ? checkoutHref(course.slug) : enquiryHref(slug)
  const ctaLabel = purchasable ? 'Enroll now' : 'Request a call back'
  const hours = Math.round(totals.durationSec / 3600)

  return (
    <>
      <JsonLd
        data={courseJsonLd({
          name: course.title,
          description: course.description ?? config.subheadline ?? course.subtitle,
          url: absoluteUrl(`/${slug}`),
          provider: { name: org.name, url: absoluteUrl('/') },
          imageUrl: course.ogImageUrl ?? course.thumbnailUrl,
          priceMinor: course.priceMinor,
          currency: course.currency,
          inLanguage: course.language,
          instances: openBatches,
        })}
      />
      {faq && <JsonLd data={faqJsonLd(faq.items)} />}

      <section aria-labelledby="landing-heading" className="border-b border-surface-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-content-muted">
                {course.title}
              </p>

              <h1
                id="landing-heading"
                className="mt-4 text-4xl font-semibold tracking-tight text-content sm:text-5xl"
              >
                {config.headline}
              </h1>

              {(config.subheadline ?? course.subtitle) && (
                <p className="mt-5 max-w-2xl text-lg leading-relaxed text-content-muted">
                  {config.subheadline ?? course.subtitle}
                </p>
              )}

              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-content-muted">
                {totals.sections > 0 && (
                  <li>
                    {totals.sections} {t('section.plural')}
                  </li>
                )}
                {totals.lessons > 0 && (
                  <li>
                    {totals.lessons} {t('lesson.plural')}
                  </li>
                )}
                {hours > 0 && <li>{hours}h of content</li>}
                {course.level && <li>{course.level}</li>}
                {course.accessDurationDays && <li>{course.accessDurationDays} days of access</li>}
              </ul>
            </div>

            <aside
              aria-labelledby="enrol-panel-heading"
              className="h-fit rounded-brand border border-surface-border bg-surface-muted p-6"
            >
              <h2 id="enrol-panel-heading" className="sr-only">
                Pricing and enrolment
              </h2>

              {course.priceMinor !== null ? (
                <p className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold text-content">
                    {formatMoney(course.priceMinor, course.currency, settings.locale)}
                  </span>
                  {course.compareAtPriceMinor !== null &&
                    course.compareAtPriceMinor > course.priceMinor && (
                      <span className="text-base text-content-muted line-through">
                        {formatMoney(course.compareAtPriceMinor, course.currency, settings.locale)}
                      </span>
                    )}
                </p>
              ) : (
                <p className="text-lg font-medium text-content">Enquire for pricing</p>
              )}

              {openBatches.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                    Upcoming {t('batch.plural')}
                  </h3>
                  <ul className="mt-2 space-y-1 text-sm text-content">
                    {openBatches.map((batch) => (
                      <li key={batch.id}>
                        {batch.name}
                        <span className="text-content-muted">
                          {' · '}
                          {formatDate(batch.startDate, settings.timezone, settings.locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-6 space-y-2">
                <Link href={ctaHref} className="block">
                  <Button size="lg" className="w-full">
                    {ctaLabel}
                  </Button>
                </Link>
                {purchasable && leadCapture && (
                  <Link href={enquiryHref(slug)} className="block">
                    <Button size="lg" variant="secondary" className="w-full">
                      Ask a question
                    </Button>
                  </Link>
                )}
              </div>

              {brand.legal?.refundUrl && (
                <p className="mt-4 text-xs text-content-muted">
                  <Link
                    href={brand.legal.refundUrl}
                    className="underline underline-offset-4 hover:text-content"
                  >
                    Refund policy
                  </Link>
                </p>
              )}
            </aside>
          </div>
        </div>
      </section>

      {valueProps && <ValuePropsSection block={valueProps} />}

      {course.description && (
        <section
          aria-labelledby="about-heading"
          className="mx-auto max-w-3xl px-4 py-16 sm:px-6"
        >
          <h2
            id="about-heading"
            className="text-2xl font-semibold tracking-tight text-content sm:text-3xl"
          >
            About this {t('course.singular')}
          </h2>
          <div className="mt-4 space-y-4 text-base leading-relaxed text-content-muted">
            {course.description
              .split(/\n{2,}/)
              .map((paragraph) => paragraph.trim())
              .filter(Boolean)
              .map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
          </div>
        </section>
      )}

      {previewLessons.length > 0 && (
        <section
          aria-labelledby="previews-heading"
          className="border-y border-surface-border bg-surface-muted"
        >
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
            <h2
              id="previews-heading"
              className="text-2xl font-semibold tracking-tight text-content sm:text-3xl"
            >
              Try it first
            </h2>
            <p className="mt-2 text-content-muted">
              These {t('lesson.plural')} are open to everyone — no account needed.
            </p>

            <ul className="mt-6 divide-y divide-surface-border overflow-hidden rounded-brand border border-surface-border bg-surface">
              {previewLessons.map((lesson) => (
                <li key={lesson.id}>
                  <Link
                    href={previewHref(slug, lesson.id)}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-content">
                        {lesson.title}
                      </span>
                      <span className="block truncate text-xs text-content-muted">
                        {lesson.sectionTitle}
                      </span>
                    </span>
                    {lesson.durationSec !== null && (
                      <span className="shrink-0 text-xs tabular-nums text-content-muted">
                        {formatDuration(lesson.durationSec)}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {curriculum.length > 0 && (
        <section aria-labelledby="curriculum-heading" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2
            id="curriculum-heading"
            className="text-2xl font-semibold tracking-tight text-content sm:text-3xl"
          >
            Curriculum
          </h2>

          <ol className="mt-8 space-y-6">
            {curriculum.map((section, index) => (
              <li key={section.id}>
                <h3 className="text-base font-semibold text-content">
                  <span className="text-content-muted">{index + 1}.</span> {section.title}
                </h3>
                {section.summary && (
                  <p className="mt-1 text-sm text-content-muted">{section.summary}</p>
                )}

                <ul className="mt-3 divide-y divide-surface-border overflow-hidden rounded-brand border border-surface-border">
                  {section.lessons.map((lesson) => (
                    <li key={lesson.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm text-content">
                        {lesson.title}
                      </span>
                      {lesson.isPreview && (
                        <Link
                          href={previewHref(slug, lesson.id)}
                          className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground"
                        >
                          Free
                        </Link>
                      )}
                      {lesson.durationSec !== null && (
                        <span className="shrink-0 text-xs tabular-nums text-content-muted">
                          {formatDuration(lesson.durationSec)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}

      {instructors && <InstructorsSection block={instructors} />}
      {testimonials && <TestimonialsSection block={testimonials} />}

      {richTextBlocks.map((block, index) => (
        <RichTextSection key={index} block={block} index={index} />
      ))}

      {faq && <FaqSection block={faq} />}

      {leadCapture && (
        <EnquirySection
          source={landingSource(slug)}
          attribution={sanitizeAttribution(query as RawParams)}
          heading={`Questions about ${course.title}?`}
          body="Leave your details and we will get back to you."
          submitLabel="Send enquiry"
        />
      )}
    </>
  )
}
