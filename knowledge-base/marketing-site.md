# Marketing Site

## What this subsystem does
The public, unauthenticated surface: a hub page, course landing pages, free preview
lessons, lead capture and SEO. Section 2.1 of the client proposal.

## How it is structured
| File | Responsibility |
|---|---|
| `src/app/(marketing)/page.tsx` | Hub page |
| `src/app/(marketing)/[slug]/page.tsx` | Course landing pages |
| `src/app/(marketing)/[slug]/preview/[lessonId]/page.tsx` | Free preview lesson |
| `src/server/marketing/content.ts` | Reads brand landing config + published courses |
| `src/server/marketing/blocks.ts` | **Pure**: CMS block parsing and validation |
| `src/server/marketing/seo.ts` | **Pure**: JSON-LD builders, `isIndexable`, absolute URLs |
| `src/server/marketing/attribution.ts` | **Pure**: UTM whitelist, honeypot, lead source |
| `src/server/marketing/rate-limit.ts` | **Pure**: windowed rate limiting |
| `src/server/marketing/leads.ts` | `submitLead` server action |
| `src/app/{sitemap,robots,opengraph-image}.ts(x)` | SEO endpoints |

## Conventions and rules
- **Nothing is hardcoded to an industry.** Every string comes from `brand.marketing` or
  the database. The page must read correctly for `sunrise-academy` (coaching) as well as
  `nirlep-forex`, which is the test to apply to any copy change.
- **Landing pages are driven by `brand.marketing.landingPages[]`**, each mapping a slug
  to a `courseSlug`. A landing page whose course is unpublished resolves to nothing
  rather than leaking a draft.
- **Preview lessons are the only content visible without an account**, and only on a
  published course — `decideAccess` enforces this, the marketing layer does not
  reimplement it.
- **UTM parameters are whitelisted, never trusted.** `sanitizeAttribution` keeps only
  `ATTRIBUTION_KEYS` and drops everything else; a forged `source` records as
  `LEAD_SOURCE_UNKNOWN` and attaches no course.
- **`riskDisclaimer` renders in the footer when the brand sets it.** This is a
  regulatory expectation for financial-education clients, not decoration.
- **Staging must not be indexed** — `isIndexable` gates `robots` and page metadata on
  `NODE_ENV`.

## Known gotchas
- **`seoTitle` on a `Page` row overrides the brand title.** That is intended CMS
  behaviour, and it is how a placeholder leaked into the dev site once (ISSUE-003).
  `prisma/seed.ts` seeds no sample content, so client databases start clean.
- **Rate limiting is in-process.** `rate-limit.ts` holds windows in memory, which is
  correct for a single-instance deployment but will not hold across replicas. If the
  deployment scales horizontally, move it to the database or a shared store.
- **The honeypot field silently discards** rather than erroring — telling a bot it was
  detected teaches it to adapt.
- **Colour contrast must hold for any brand.** Use `primary` / `primary-foreground`
  tokens; never hardcode `text-white` on a brand-coloured surface. See
  `src/lib/brand/theme.ts` for why (a bright cyan or yellow primary needs dark text).

## How it is tested
- `seo.test.ts` — JSON-LD shape, indexability, absolute URL building, price formatting.
- `attribution.test.ts` — whitelist behaviour, forged source, landing-slug resolution.
- `blocks.test.ts` — block parsing and invalid-block reporting.
- `rate-limit.test.ts` — window boundaries and key derivation.
- `leads.dbtest.ts` — storage, email lowercasing, audit entry, honeypot discard,
  duplicate suppression within a window, and that a submission without an email does not
  suppress every other enquiry.

## Related
[vertical-packs.md](./vertical-packs.md) · [catalog-and-drip.md](./catalog-and-drip.md) (preview lessons)
