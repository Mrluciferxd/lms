/**
 * Marketing page content blocks.
 *
 * `Page.blocks` is admin-authored JSON — the schema calls it "block-based
 * content rendered by the marketing renderer", and packs seed it through
 * `seedPage`. This module is that renderer's contract.
 *
 * Putting testimonials, FAQ, value props and instructor bios here rather than in
 * `brand.config.ts` is the difference between a client editing their own site and
 * filing a ticket for every comma. Brand config stays build-time identity;
 * everything a marketer changes weekly is a row.
 *
 * Two properties matter more than the field list:
 *
 *  1. A malformed block never takes down a public page. Blocks parse one at a
 *     time and anything invalid is dropped, so a bad edit costs one section
 *     rather than the site — and an unrecognised `type` from a newer pack is a
 *     no-op instead of a 500.
 *  2. Every href and image URL is constrained to an internal path or https.
 *     "Authored by an admin" is not "trusted": a `javascript:` URL in a CTA is
 *     stored XSS on the highest-traffic page this product serves.
 */

import { z } from 'zod'

const safeUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => (value.startsWith('/') && !value.startsWith('//')) || value.startsWith('https://'),
    'Must be an internal path or an https:// URL',
  )

/** Non-empty after trimming. Blank strings are omissions, not content. */
const text = (max: number) => z.string().trim().min(1).max(max)

const heroBlock = z.object({
  type: z.literal('hero'),
  headline: text(160).optional(),
  subheadline: text(400).optional(),
  ctaLabel: text(60).optional(),
  ctaHref: safeUrl.optional(),
})

const valuePropsBlock = z.object({
  type: z.literal('valueProps'),
  heading: text(120).optional(),
  items: z
    .array(z.object({ title: text(120), body: text(400).optional() }))
    .min(1)
    .max(12),
})

const instructorsBlock = z.object({
  type: z.literal('instructors'),
  heading: text(120).optional(),
  items: z
    .array(
      z.object({
        name: text(120),
        title: text(160).optional(),
        bio: text(1200).optional(),
        avatarUrl: safeUrl.optional(),
        /** Qualifications, years of experience, prior institutions. */
        credentials: z.array(text(120)).max(8).optional(),
      }),
    )
    .min(1)
    .max(24),
})

const testimonialsBlock = z.object({
  type: z.literal('testimonials'),
  heading: text(120).optional(),
  items: z
    .array(
      z.object({
        quote: text(800),
        name: text(120),
        role: text(160).optional(),
      }),
    )
    .min(1)
    .max(24),
})

const faqBlock = z.object({
  type: z.literal('faq'),
  heading: text(120).optional(),
  items: z.array(z.object({ question: text(300), answer: text(2000) })).min(1).max(30),
})

const ctaBlock = z.object({
  type: z.literal('cta'),
  heading: text(160).optional(),
  body: text(600).optional(),
  ctaLabel: text(60).optional(),
  ctaHref: safeUrl.optional(),
})

/** Plain paragraphs. Split on blank lines by the renderer; no markup is parsed. */
const richTextBlock = z.object({
  type: z.literal('richText'),
  heading: text(120).optional(),
  body: text(5000),
})

const marketingBlockSchema = z.discriminatedUnion('type', [
  heroBlock,
  valuePropsBlock,
  instructorsBlock,
  testimonialsBlock,
  faqBlock,
  ctaBlock,
  richTextBlock,
])

export type MarketingBlock = z.infer<typeof marketingBlockSchema>
export type MarketingBlockType = MarketingBlock['type']
export type BlockOf<T extends MarketingBlockType> = Extract<MarketingBlock, { type: T }>

/**
 * Reads a `Page.blocks` value. Never throws: this runs on the public site, where
 * the correct response to bad content is a missing section, not an error page.
 */
export function parseBlocks(raw: unknown): MarketingBlock[] {
  if (!Array.isArray(raw)) return []

  const blocks: MarketingBlock[] = []
  for (const entry of raw) {
    const parsed = marketingBlockSchema.safeParse(entry)
    if (parsed.success) blocks.push(parsed.data)
  }
  return blocks
}

/** First block of a type. Most blocks are singletons on a page. */
export function findBlock<T extends MarketingBlockType>(
  blocks: readonly MarketingBlock[],
  type: T,
): BlockOf<T> | null {
  return (blocks.find((block) => block.type === type) as BlockOf<T> | undefined) ?? null
}

/** Every block of a type, in authored order. Used by repeatable sections. */
export function blocksOfType<T extends MarketingBlockType>(
  blocks: readonly MarketingBlock[],
  type: T,
): BlockOf<T>[] {
  return blocks.filter((block): block is BlockOf<T> => block.type === type)
}

/**
 * Blocks that failed to parse, reported by index. Surfaced to staff in admin so
 * a typo in the CMS is visible to whoever made it rather than silently costing
 * them a section they think is live.
 */
export function invalidBlockIndexes(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw.reduce<number[]>((indexes, entry, index) => {
    if (!marketingBlockSchema.safeParse(entry).success) indexes.push(index)
    return indexes
  }, [])
}
