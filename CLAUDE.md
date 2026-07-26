# Working in this repo

White-label cohort learning platform. Industry-agnostic core + vertical packs.
One deployment and one database per client — there is no `tenantId`.

Read [`docs/01-architecture.md`](docs/01-architecture.md) before making
structural changes.

## Commands

```bash
npm run dev              # Next dev server
npm test                 # node:test via tsx
npm run typecheck        # tsc --noEmit
npm run db:migrate       # prisma migrate dev
npm run db:seed
npm run packs:install    # write enabled packs into the DB (idempotent)
```

`NEXT_PUBLIC_BRAND` selects the brand. Default to `demo-academy` locally.

## The rule that matters most

**Core must never depend on a pack or a brand.**

- Import pack output only through `src/packs/registry.ts`
- Import brand config only through `src/lib/brand`
- `grep -r "packs/forex" src --include=*.ts | grep -v "^src/packs/"` must be empty
- Any feature that breaks under `NEXT_PUBLIC_BRAND=demo-academy` (which runs
  `packs: []`) is in the wrong layer

Before adding something industry-specific, check whether it fits one of the three
generic mechanisms — `JournalDefinition`, `TrackerDefinition`, or
`DataWidgetDefinition` + adapter. It usually does. If a pack seems to need more
than the contract in `src/packs/types.ts` allows, the feature belongs in core
behind a feature flag.

Two packs ship: `forex` (trading academy) and `coaching` (exam-prep institute).
They exist as a pair on purpose — if a change only makes sense for one of them,
it belongs in that pack, not in core. Useful test: would a music school or a
fitness studio want this? If yes it is core; if no it is a pack.

## Conventions

**Money** — integer minor units, always. Field names end in `Minor`. No floats
touch currency.

**Time** — store UTC, render in `OrgSettings.timezone`. Never format a date
without going through the org timezone helper; drip windows, reminders and fee due
dates all straddle midnight for someone.

**Labels** — user-facing nouns a vertical might rename go through `t()` in
`src/lib/labels.ts`, never hardcoded. That is what lets a pack turn "Live Session"
into "Live Market Session".

**Feature flags** — `hasFeature('chat')` gates routes, navigation *and* scheduled
jobs. Hiding a link is not gating a feature.

**Prisma 7 specifics** — the datasource URL lives in `prisma.config.ts`, not
`schema.prisma`. The client is generated to `src/generated/prisma` (gitignored)
and needs a driver adapter; use the singleton in `src/server/db.ts`. Enums import
from `@/generated/prisma/enums`, not `@prisma/client`.

**Access control** — every student-facing read checks enrollment *and* drip
release. A locked lesson must 404 on direct URL access, not merely be hidden in
the navigation.

**Webhooks** — insert into `WebhookEvent` first and no-op on unique conflict.
Razorpay retries; double-crediting an enrollment is not an acceptable failure.

**Migrations** — additive only. Never edit an applied migration. Client databases
are separate, so every migration ships N times (see `docs/04-white-label.md`).

## Journal expressions

`src/server/journals/expression.ts` is a hand-written sandboxed evaluator, not a
library. Do not replace it with `expr-eval` or similar — that package has two
unfixed high-severity advisories, including arbitrary code execution, and these
expressions are admin-authored data stored in the database.

If you extend the grammar, keep the invariants: no property access, no function
values, identifiers resolve only from entry data via `Object.hasOwn` against a
null-prototype scope, bounded length and depth. Add sandbox-containment tests
alongside behaviour tests.

## Client context

Nirlep Forex is client #1. Values marked `TODO(client)` in
`brands/nirlep-forex/brand.config.ts` are placeholders awaiting brand assets and
credentials — do not treat them as final.

Two known contract issues, both documented: the 1-month timeline does not fit the
scope ([`docs/05-roadmap.md`](docs/05-roadmap.md)), and the "prevent native screen
recording" clause is not technically deliverable
([`docs/06-video-security.md`](docs/06-video-security.md)).
