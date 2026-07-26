# LMS Platform

A white-label, cohort-based learning platform. Industry-agnostic core with
pluggable **vertical packs** that add industry vocabulary and domain-specific
record types.

Built from the Nirlep Forex proposal, but deliberately not built *only* for it:
of the thirteen feature areas in that proposal, only three are actually
forex-specific, and all three are expressed through generic mechanisms.

Two unrelated verticals now run on the same core, which is what makes the
industry-agnostic claim testable rather than aspirational:

| Vertical pack | Industry | Journal | Data feed | Relabels a broadcast as |
|---|---|---|---|---|
| `forex` | Trading academy | Trade log with R-multiple and P&L | Economic calendar | "Live Market Session" |
| `coaching` | Exam-prep institute | Mock test log with accuracy and percentile | Exam calendar | "Live Class" |

Neither pack required a single change to `src/app`, `src/server` or
`prisma/schema.prisma`.

## Status

Foundation complete and verified. Feature work follows
[`docs/05-roadmap.md`](docs/05-roadmap.md).

| Piece | State |
|---|---|
| Prisma schema — 52 models, 37 enums, 13 domains | migrated, no drift |
| Vertical pack contract + registry | complete |
| Brand / white-label layer, WCAG-derived theming | complete |
| `forex` pack — trade journal, economic calendar, labels | complete |
| `coaching` pack — mock test log, exam calendar, labels | complete |
| Journal expression evaluator (hand-written sandbox) | complete |
| Auth — credentials + optional Google, JWT sessions | complete |
| RBAC — capability matrix, live-status enforcement | complete |
| Seed + idempotent pack installer | complete |
| App/admin shells, pack-driven navigation | complete |
| Test suite | 96 passing |
| Catalog, video, payments, notifications, chat | not started — see roadmap |

## Stack

Next.js 15 (App Router) · TypeScript strict · PostgreSQL · Prisma 7 with the
`pg` driver adapter · Tailwind · Auth.js · Razorpay · Bunny Stream

## Getting started

```bash
npm ci
cp .env.example .env      # then fill in DATABASE_URL and AUTH_SECRET
npx prisma migrate dev
npm run db:seed
npm run dev
```

`NEXT_PUBLIC_BRAND` selects the active brand — one deployment serves exactly one:

| Brand | Packs | Purpose |
|---|---|---|
| `nirlep-forex` | `forex` | Client #1 |
| `sunrise-academy` | `coaching` | Reference deployment for the coaching vertical |
| `demo-academy` | *none* | Neutral core. Demos in any industry, and the CI decoupling guard |

```bash
npm test          # expression evaluator tests
npm run typecheck
npm run db:studio
```

## How the generalization works

Three mechanisms carry everything vertical-specific, so no industry logic reaches
core:

| Generic mechanism | `forex` uses it for | `coaching` uses it for |
|---|---|---|
| `JournalDefinition` — record type with an admin-defined field schema and computed expressions | trade log: entry/stop/target, R-multiple, P&L | mock test log: marks, accuracy, percentile |
| `TrackerDefinition` — counters, gauges, checklists, expiring flags | funded-challenge progress gauge | syllabus completion, tests attempted, test-series expiry |
| `DataWidgetDefinition` + `DataFeedAdapter` — pluggable external feed behind a cache | economic calendar | exam and application dates |
| `LiveSession.kind` + label overrides | "Live Market Session" | "Live Class" |

Adding an industry means one directory under `src/packs/` and one brand config.
Core does not change — enforced in CI by building `demo-academy` with `packs: []`
and by a grep that fails if core imports a pack.

## Layout

```
brands/           per-client configs (theme, packs, features, integrations)
prisma/           schema, migrations, seed
src/lib/brand/    brand types and active-brand resolution
src/packs/        vertical pack contract, registry, and the forex pack
src/server/       domain logic — db, journals, notifications, payments, media
docs/             architecture, data model, packs, deployment, roadmap
```

## Documentation

| Document | Contents |
|---|---|
| [01-architecture.md](docs/01-architecture.md) | Deployment model, layering, the dependency rule |
| [02-data-model.md](docs/02-data-model.md) | Schema walkthrough and the non-obvious modelling calls |
| [03-vertical-packs.md](docs/03-vertical-packs.md) | Pack contract, expression evaluator, building the next pack |
| [04-white-label.md](docs/04-white-label.md) | Onboarding a new client deployment |
| [05-roadmap.md](docs/05-roadmap.md) | Delivery plan and scope assessment |
| [06-video-security.md](docs/06-video-security.md) | What content protection can and cannot do |

## Two things worth knowing up front

**The proposal's timeline does not fit its scope.** The full feature matrix is
≈114 developer-days; one month of calendar time needs 5–6 developers in parallel.
[`docs/05-roadmap.md`](docs/05-roadmap.md) has the breakdown and a staged
alternative that delivers a revenue-capable product in four weeks.

**"Prevent native screen recording" is not achievable on the web** — screen
capture happens below the browser, and no API exposes or blocks it. What *is*
deliverable is DRM, per-viewer forensic watermarking, short-TTL signed playback,
and concurrent-stream limits, which together close every easy path and make any
leak attributable. [`docs/06-video-security.md`](docs/06-video-security.md) covers
this and suggests replacement wording for the contract.
