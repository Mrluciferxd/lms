# LMS Platform
> White-label, cohort-based learning platform. Industry-agnostic core with pluggable vertical packs.

Built from the Nirlep Forex proposal but deliberately not built only for it. Two
unrelated verticals (forex trading academy, exam-prep coaching institute) run on the
same core, differing only by a pack directory and a brand config.

## Tech Stack
| Layer       | Technology                                        |
|-------------|---------------------------------------------------|
| Language    | TypeScript (strict, `noUncheckedIndexedAccess`)   |
| Framework   | Next.js 15 (App Router, server actions)           |
| Database    | PostgreSQL 17                                     |
| ORM         | Prisma 7 with the `pg` driver adapter             |
| Auth        | Auth.js v5 (credentials + optional Google), JWT   |
| Styling     | Tailwind 3, brand colours via CSS custom properties |
| Payments    | Razorpay                                          |
| Video       | Bunny Stream (prod) / local filesystem (dev)      |
| Test Runner | `node:test` via `tsx`                             |
| Hosting     | Not yet provisioned — client-owned, see 04-white-label |

## Directory Structure
```
brands/              per-client config (theme, packs, features, integrations)
docs/                design documents (architecture, data model, roadmap, video security)
knowledge-base/      this directory — operational source of truth
prisma/              schema, migrations, seed
scripts/             pack installer, demo-course seeder
src/app/(marketing)/ public site + course landing pages
src/app/app/         authenticated student area
src/app/admin/       staff operations console
src/app/api/         playback, checkout, webhooks, cron
src/lib/brand/       brand types, active-brand resolution, WCAG theming
src/lib/labels.ts    t() — all user-facing nouns
src/lib/nav.ts       navigation composition (core + pack contributions)
src/packs/           vertical pack contract, registry, forex + coaching packs
src/server/          domain logic, one directory per subsystem
```

## Critical Rules
- **Core must never import a pack or a brand.** Pack output only via
  `src/packs/registry.ts`; brand config only via `src/lib/brand`. CI fails the build
  on a direct import, and `demo-academy` (which runs `packs: []`) is the regression target.
- **Money is integer minor units.** Field names end in `Minor`. No float touches currency.
- **Time is stored UTC, rendered in the org timezone** from `getOrgSettings()`. Never
  format a date without it — drip windows, reminders and fee due dates all straddle
  midnight for somebody, and India has no DST to hide the bug behind.
- **Authorization is re-checked server-side in every action and route handler.** A hidden
  button is not authorization; server actions are directly invocable endpoints.
- **Prefer 404 over 403** for resources a user should not know exist.
- **Do not edit `prisma/schema.prisma` casually.** Migrations are additive only; every
  client has a separate database, so each migration ships N times.
- **Prisma cannot target a compound unique containing a null.** See
  `src/server/enrollments/enroll.ts` and ISSUE-002.
- **`NEXT_PUBLIC_BRAND` selects the deployment's brand** and is read at build time.

## Quick Facts
| Key            | Value                                                      |
|----------------|------------------------------------------------------------|
| Repo           | https://github.com/Mrluciferxd/lms (private)               |
| Staging URL    | none yet                                                   |
| Prod URL       | none yet                                                   |
| Dev DB         | `lms_dev` (local Postgres 17)                              |
| Test DB        | `lms_test`, configured by `.env.test`                      |
| Shadow DB      | `lms_shadow`, used only by the CI drift check              |
| CI/CD          | GitHub Actions — `.github/workflows/ci.yml`                |
| Test Command   | `npm test` (unit) and `npm run test:db` (database-backed)  |

## Reading Order
| File                      | When to Read                              |
|---------------------------|-------------------------------------------|
| README.md                 | Always first                              |
| architecture.md           | Before touching structure or layering     |
| decisions.md              | Before changing an architectural choice   |
| known-issues.md           | Before debugging anything                 |
| active-context.md         | Every session, to pick up where left off  |
| testing.md                | Before writing or changing tests          |
| changelog.md              | When tracing a regression                 |
| vertical-packs.md         | When adding an industry or a pack feature |
| auth.md                   | When touching sign-in, roles, permissions |
| video.md                  | When touching playback, DRM, watermarking |
| payments.md               | When touching checkout, fees, webhooks    |
| notifications.md          | When touching reminders or the scheduler  |
| catalog-and-drip.md       | When touching courses, lessons, release   |
| batches-and-attendance.md | When touching cohorts or sessions         |
| marketing-site.md         | When touching the public site or SEO      |
| chat.md                   | When touching channels, messages, moderation |
| assignments.md            | When touching assignments, submissions, grading |
| journals.md               | When touching journal definitions, entries, computed expressions |
| widgets.md                | When touching data feeds, widget pages, or the widget refresh cron |
| trackers.md               | When touching tracker definitions, per-type value shapes, or the admin record console |
| quizzes.md                | When touching quiz authoring, attempts, auto-grading, or the student taker |

The `docs/` directory holds the original client-facing design documents. This
`knowledge-base/` is the operational record: what exists, why, and what bites.
