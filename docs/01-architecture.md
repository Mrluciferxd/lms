# Architecture

## The product decision

The Nirlep Forex proposal describes a forex trading academy. Building exactly
that yields one ₹60,000 project. Building it as a **generic cohort-learning
platform with a forex pack on top** yields a product you can resell to a coding
bootcamp, a CA-coaching institute, a fitness academy or a music school with no
code changes — only a new brand config.

This is now demonstrated rather than asserted: two unrelated verticals — a
trading academy and an exam-prep coaching institute — run on the same core, the
same schema and the same UI, differing only in a pack directory and a brand
config. See `docs/03-vertical-packs.md`.

Auditing the proposal's feature list, only three items are actually
industry-specific:

| Proposal feature | Generalized as | Where it lives |
|---|---|---|
| Live Trades Journal | `JournalDefinition` — a record type with an admin-defined field schema | core tables, forex pack seeds the `trade` definition |
| Economic Calendar Dashboard | `DataWidgetDefinition` over a pluggable `DataFeedAdapter` | core tables, forex pack supplies the adapter |
| Live Market Sessions | `LiveSession` with `kind = BROADCAST` | core, forex pack only relabels it |

Everything else — courses, batches, drip scheduling, secure video, attendance,
assignments, resources, notifications, payments, fee installments, chat,
dashboards — is generic LMS surface that any vertical needs.

## Deployment model: one deployment per client

Decided: **white-label per-client deploy.** One codebase, one deployment and one
Postgres database per client.

```
                    ┌─────────────────────────────┐
                    │   lms-platform (this repo)   │
                    │   core + all vertical packs  │
                    └──────────────┬──────────────┘
                                   │  BRAND=<key> at build time
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  nirlep-forex    │    │  demo-academy    │    │   client-three   │
│  packs: [forex]  │    │  packs: []       │    │  packs: [fitness]│
│  own Postgres    │    │  own Postgres    │    │  own Postgres    │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

**Why this over multi-tenant SaaS.** There is no `tenantId` anywhere in the
schema, which removes the single largest source of catastrophic bugs in a
multi-tenant LMS: one missing `where: { tenantId }` leaking one academy's
students, revenue or private journals into another's dashboard. With a database
per client that class of bug cannot exist. Client data is also physically
separable, which matters when a client asks for an export or leaves.

**What it costs.** Each new client needs a deployment and infra setup, and a
security patch must be rolled out N times. That is a deliberate trade: the
per-client setup is a repeatable checklist (see `docs/04-white-label.md`), while
tenant-isolation bugs are unbounded liability. Once N gets large enough to hurt,
the migration path is to add `tenantId` and row-level security — but the
generalization work in this repo is what makes that migration mechanical rather
than a rewrite.

## Layers

```
┌───────────────────────────────────────────────────────────────────┐
│  brands/<key>/brand.config.ts        client-specific, no logic     │
│  theme · logos · packs · features · integrations · security posture │
└─────────────────────────────┬─────────────────────────────────────┘
                              │ read once at build
┌─────────────────────────────▼─────────────────────────────────────┐
│  src/packs/*                         industry vocabulary + records │
│  labels · journals · trackers · data adapters · nav · templates     │
└─────────────────────────────┬─────────────────────────────────────┘
                              │ registered via src/packs/registry.ts
┌─────────────────────────────▼─────────────────────────────────────┐
│  src/app · src/server · src/lib     industry-agnostic core          │
│  auth · catalog · batches · drip · media · payments · notify · chat │
└─────────────────────────────┬─────────────────────────────────────┘
                              │ Prisma 7 + driver adapter
┌─────────────────────────────▼─────────────────────────────────────┐
│  Postgres                                                          │
└───────────────────────────────────────────────────────────────────┘
```

**The dependency rule, and it is the only one that really matters:**
core never imports from `src/packs/*` except through `src/packs/registry.ts`,
and never imports from `brands/*` except through `src/lib/brand`. A grep for
`from '@/packs/forex` outside `src/packs/` should return nothing. `demo-academy`
exists to enforce this — it runs with `packs: []`, so any feature that silently
depends on the forex pack breaks there first.

## Planned directory layout

```
├── brands/
│   ├── index.ts                    static brand registry
│   ├── nirlep-forex/brand.config.ts    client #1 — forex pack
│   ├── sunrise-academy/brand.config.ts reference — coaching pack
│   └── demo-academy/brand.config.ts    neutral reference, packs: []
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── prisma.config.ts                Prisma 7 config (datasource URL lives here)
├── src/
│   ├── app/
│   │   ├── (marketing)/            public site + landing pages
│   │   ├── (auth)/                 sign in, invite acceptance
│   │   ├── app/                    authenticated student + instructor area
│   │   ├── admin/                  staff operations console
│   │   └── api/
│   │       ├── webhooks/razorpay/
│   │       ├── playback/           short-TTL signed token issuance
│   │       └── cron/               scheduler entrypoints
│   ├── generated/prisma/           build output, gitignored
│   ├── lib/
│   │   ├── brand/                  brand types + active-brand resolution
│   │   └── labels.ts               t() with pack overrides
│   ├── packs/
│   │   ├── types.ts                the pack contract
│   │   ├── registry.ts             static pack registry
│   │   ├── shared/                 adapter plumbing reused across packs
│   │   ├── forex/                  trading academy
│   │   └── coaching/               exam-prep institute
│   └── server/
│       ├── db.ts                   Prisma singleton + driver adapter
│       ├── auth/                   session, RBAC helpers
│       ├── catalog/                courses, sections, lessons
│       ├── batches/                cohorts, drip release resolution
│       ├── media/                  provider adapters, signing, watermarks
│       ├── journals/               dynamic schemas + expression evaluator
│       ├── notifications/          templates, rules, channel adapters
│       ├── payments/               Razorpay, orders, fee installments
│       └── org/                    OrgSettings, feature resolution
└── docs/
```

## Cross-cutting decisions

**Feature flags are structural, not cosmetic.** `hasFeature('chat')` returning
false removes the routes, the navigation and the scheduled jobs — it does not
merely hide a link. Build-time flags come from `brand.config.ts`; the
runtime-adjustable subset is mirrored into `OrgSettings.featureFlags` so an admin
can switch something off without a deploy.

**Money is integer minor units.** Every amount is an `Int` of paise/cents named
`*Minor`. No floats touch currency anywhere.

**Time is stored UTC, rendered in the org timezone.** `OrgSettings.timezone` is
the single display authority. This is load-bearing for a batch-scheduling product:
drip windows, class reminders and fee due dates all straddle midnight for
somebody, and India has no DST to hide the bug behind.

**Labels go through `t()`.** Any user-facing noun a vertical might rename reads
from `src/lib/labels.ts`, which layers pack overrides over core defaults. This is
how "Live Session" becomes "Live Market Session" without a fork.

**Webhooks are idempotent by construction.** `WebhookEvent` has a unique
`(gateway, eventId)`; handlers insert first and no-op on conflict. Razorpay
retries, and double-crediting an enrollment is not an acceptable failure mode.

## Related documents

- `docs/02-data-model.md` — schema walkthrough and the non-obvious modelling calls
- `docs/03-vertical-packs.md` — the pack contract and how to build the next one
- `docs/04-white-label.md` — onboarding a new client deployment
- `docs/05-roadmap.md` — delivery plan and an honest scope assessment
- `docs/06-video-security.md` — what content protection can and cannot do
