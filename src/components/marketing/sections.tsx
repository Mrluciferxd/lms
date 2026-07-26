import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { t } from '@/lib/labels'
import { initials } from '@/lib/utils'
import type { BlockOf } from '@/server/marketing/blocks'

/**
 * Renderers for the CMS block types.
 *
 * ── Colour discipline ────────────────────────────────────────────────────────
 * A white-label marketing page renders under a brand colour we do not choose.
 * `text-primary` on the page background is unreadable for a pale or bright
 * primary — a client picking cyan gets roughly 2.5:1, well under WCAG AA — so
 * brand colour appears here only as `bg-primary` paired with its computed
 * `text-primary-foreground`, or as a low-alpha tint behind normal `text-content`.
 * Never `text-white`: the foreground is computed per brand in
 * src/lib/brand/theme.ts precisely so nobody has to guess.
 *
 * ── Headings ─────────────────────────────────────────────────────────────────
 * Every section heading is CMS-authored. The fallbacks below use `t()` wherever
 * the word is a noun a vertical renames ("Instructor" -> "Faculty" -> "Mentor");
 * structural English like "Testimonials" is not one of those and stays literal.
 */

/** Blank-line-separated paragraphs. No markup is parsed — the input is untrusted copy. */
function Paragraphs({ text: body, className }: { text: string; className?: string }) {
  return (
    <>
      {body
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index} className={className}>
            {paragraph}
          </p>
        ))}
    </>
  )
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
      {children}
    </h2>
  )
}

export function ValuePropsSection({ block }: { block: BlockOf<'valueProps'> }) {
  return (
    <section aria-labelledby="value-props-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <SectionHeading id="value-props-heading">{block.heading ?? 'What you get'}</SectionHeading>

      <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {block.items.map((item, index) => (
          <li
            key={index}
            className="rounded-brand border border-surface-border bg-surface p-5"
          >
            <h3 className="text-base font-semibold text-content">{item.title}</h3>
            {item.body && <p className="mt-2 text-sm leading-relaxed text-content-muted">{item.body}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function InstructorsSection({ block }: { block: BlockOf<'instructors'> }) {
  return (
    <section aria-labelledby="instructors-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <SectionHeading id="instructors-heading">
        {block.heading ?? t('instructor.plural')}
      </SectionHeading>

      <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {block.items.map((person, index) => (
          <li key={index} className="rounded-brand border border-surface-border bg-surface p-5">
            <div className="flex items-center gap-3">
              {person.avatarUrl ? (
                // Client-supplied URLs of unknown host and intrinsic size, so
                // next/image would need per-client remotePattern config.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={person.avatarUrl}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="h-12 w-12 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                >
                  {initials(person.name)}
                </span>
              )}

              <span className="min-w-0">
                <span className="block truncate font-semibold text-content">{person.name}</span>
                {person.title && (
                  <span className="block truncate text-sm text-content-muted">{person.title}</span>
                )}
              </span>
            </div>

            {person.bio && (
              <div className="mt-3 space-y-2 text-sm leading-relaxed text-content-muted">
                <Paragraphs text={person.bio} />
              </div>
            )}

            {person.credentials && person.credentials.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {person.credentials.map((credential) => (
                  <li
                    key={credential}
                    className="rounded-brand bg-primary/10 px-2 py-0.5 text-xs font-medium text-content"
                  >
                    {credential}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function TestimonialsSection({ block }: { block: BlockOf<'testimonials'> }) {
  return (
    <section
      aria-labelledby="testimonials-heading"
      className="border-y border-surface-border bg-surface-muted"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <SectionHeading id="testimonials-heading">
          {block.heading ?? 'What people say'}
        </SectionHeading>

        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {block.items.map((testimonial, index) => (
            <li key={index} className="rounded-brand border border-surface-border bg-surface p-5">
              <figure className="space-y-4">
                <blockquote className="text-sm leading-relaxed text-content">
                  <Paragraphs text={testimonial.quote} />
                </blockquote>
                <figcaption className="text-sm">
                  <span className="block font-medium text-content">{testimonial.name}</span>
                  {testimonial.role && (
                    <span className="block text-content-muted">{testimonial.role}</span>
                  )}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/**
 * Native `<details>` rather than a JS accordion: keyboard behaviour, focus order
 * and the browser's own find-in-page all work without shipping a byte of script,
 * and a crawler reads the answers whether or not they are expanded.
 */
export function FaqSection({ block, id = 'faq' }: { block: BlockOf<'faq'>; id?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <SectionHeading id={`${id}-heading`}>
        {block.heading ?? 'Frequently asked questions'}
      </SectionHeading>

      <ul className="mt-8 divide-y divide-surface-border border-y border-surface-border">
        {block.items.map((item, index) => (
          <li key={index}>
            <details className="group py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-brand px-1 py-3 text-left text-base font-medium text-content [&::-webkit-details-marker]:hidden">
                {item.question}
                <span
                  aria-hidden
                  className="shrink-0 text-lg font-normal text-content-muted transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <div className="space-y-2 px-1 pb-4 text-sm leading-relaxed text-content-muted">
                <Paragraphs text={item.answer} />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function RichTextSection({ block, index }: { block: BlockOf<'richText'>; index: number }) {
  const headingId = `rich-text-${index}-heading`

  return (
    <section
      aria-labelledby={block.heading ? headingId : undefined}
      aria-label={block.heading ? undefined : 'Additional information'}
      className="mx-auto max-w-3xl px-4 py-12 sm:px-6"
    >
      {block.heading && <SectionHeading id={headingId}>{block.heading}</SectionHeading>}
      <div className="mt-4 space-y-4 text-base leading-relaxed text-content-muted">
        <Paragraphs text={block.body} />
      </div>
    </section>
  )
}

export function CtaSection({
  block,
  fallbackHref,
  fallbackLabel,
}: {
  block: BlockOf<'cta'> | null
  fallbackHref: string
  fallbackLabel: string
}) {
  const href = block?.ctaHref ?? fallbackHref
  const label = block?.ctaLabel ?? fallbackLabel

  return (
    <section aria-labelledby="cta-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="rounded-brand bg-primary px-6 py-12 text-center sm:px-12">
        <h2
          id="cta-heading"
          className="text-2xl font-semibold tracking-tight text-primary-foreground sm:text-3xl"
        >
          {block?.heading ?? 'Ready to start?'}
        </h2>

        {block?.body && (
          <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-primary-foreground/90">
            {block.body}
          </p>
        )}

        <div className="mt-8 flex justify-center">
          <Link href={href}>
            {/*
              Inverted on purpose: a `bg-primary` button on a `bg-primary` panel
              is invisible. The surface pair is brand-independent, so this holds
              for any client colour.
            */}
            <Button size="lg" variant="secondary">
              {label}
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
