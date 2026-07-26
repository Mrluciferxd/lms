# Architecture

## System Overview
A cohort-based learning platform delivered white-label: one codebase, one deployment
and one Postgres database per client. There is no `tenantId` anywhere. Industry-specific
behaviour is confined to *vertical packs*, which contribute record types, external data
feeds, navigation and vocabulary to an otherwise generic core.

The central claim — that the core carries no industry assumptions — is enforced rather
than asserted: `demo-academy` runs with `packs: []` and is built in CI, and a grep gate
fails the build if core imports a pack or a brand directly.

## Architecture Diagram
```
                    ┌─────────────────────────────┐
                    │   lms-platform (this repo)  │
                    │   core + all vertical packs │
                    └──────────────┬──────────────┘
                                   │  NEXT_PUBLIC_BRAND=<key> at build time
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  nirlep-forex    │    │ sunrise-academy  │    │  demo-academy    │
│  packs:[forex]   │    │ packs:[coaching] │    │  packs:[]        │
│  own Postgres    │    │  own Postgres    │    │  own Postgres    │
└──────────────────┘    └──────────────────┘    └──────────────────┘

Layering inside one deployment:

  brands/<key>/brand.config.ts     client config, no logic
            │ read once at build
  src/packs/*                      industry vocabulary + record types
            │ registered via src/packs/registry.ts
  src/app · src/server · src/lib   industry-agnostic core
            │ Prisma 7 + pg driver adapter
  Postgres
```

## Layers & Responsibilities
| Layer        | Technology                | Responsibility                                        |
|--------------|---------------------------|-------------------------------------------------------|
| Marketing    | Next.js RSC, `(marketing)`| Public site, landing pages, lead capture, SEO         |
| Student app  | Next.js RSC, `/app`       | Courses, player, live sessions, billing, notifications |
| Admin        | Next.js RSC, `/admin`     | Catalog, batches, students, payments, notifications    |
| API          | Route handlers, `/api`    | Playback tokens, checkout, webhooks, cron              |
| Domain       | `src/server/*`            | One directory per subsystem; pure logic + db wrappers  |
| Auth         | Auth.js v5, JWT sessions  | Identity; RBAC enforced per-request against live rows  |
| Database     | Postgres 17 via Prisma 7  | 52 models, additive migrations only                    |
| Video        | Bunny Stream / local      | DRM, signed playback, watermarking                     |
| Jobs         | `/api/cron/*` + CRON_SECRET | Notification scheduling and delivery                 |

## Data Flow

**Watching a protected lesson**
1. Page calls `getLessonAccess()` → publish state, enrollment, expiry, drip.
2. Player POSTs `/api/playback` with a device id.
3. `issuePlayback()` re-runs authorization, enforces concurrent-stream limits against
   `PlaybackGrant`, records a grant, renders the watermark, signs a short-TTL URL.
4. Player renews before expiry; releases the grant on unmount.

The page check and the API check call the *same* decision function, so a lock the UI
renders and a lock the API enforces cannot disagree.

**Buying a course**
1. `/api/checkout` creates `Order` + `OrderItem`s, applies a coupon, creates a gateway order.
2. Razorpay posts to `/api/webhooks/razorpay`.
3. Handler verifies the HMAC signature, inserts `WebhookEvent` (unique on
   `gateway,eventId`) and no-ops on conflict, then records `Payment`, marks the order
   paid and calls `enrollUser()`.

**A class reminder**
1. `/api/cron/notifications` (CRON_SECRET) evaluates enabled `NotificationRule`s against
   their anchors at time T using a pure, clock-injected window function.
2. Each due notification gets a deterministic `dedupeKey`; the unique index makes a
   re-run a no-op insert rather than a second WhatsApp message.
3. A worker delivers via the channel adapter with bounded retries.

## Key Design Patterns
- **Pure decision + thin db wrapper.** Anything that decides access, pacing, money or
  scheduling is a pure function with injected inputs and a clock, wrapped by a small
  loader. This is why the drip matrix, session visibility, pricing and scheduling
  windows are exhaustively testable without fixtures.
- **White-label per-client deploy over multi-tenant.** Chosen to make cross-tenant data
  leakage structurally impossible. See decisions.md.
- **Computed drip, never materialised.** Batch dates move; a materialised unlock table
  would need backfilling on every reschedule.
- **Provider adapters** for video, payment gateway and notification channels, resolved
  from brand config so no calling code names a vendor.

## External Dependencies
| Service            | Purpose                  | If it goes down                                    |
|--------------------|--------------------------|----------------------------------------------------|
| Bunny Stream       | Video hosting, DRM       | Playback fails; catalog and everything else fine   |
| Razorpay           | Payments                 | Checkout fails; existing enrollments unaffected    |
| Economic/exam feed | Pack data widgets        | Widget shows a setup notice — never breaks a page  |
| Email/SMS/WhatsApp | Notifications            | Delivery retries; in-app notifications still work  |

Pack data feeds degrade to `unavailable` by design because the client owns those
subscriptions; a lapsed key must not present as our outage.

## Scalability & Limits
- One database per client keeps per-tenant volume low; the ceiling is a single academy.
- `Enrollment.percentComplete` is denormalised because it appears on every dashboard,
  roster and reminder query.
- Indexes target observed query paths (rosters, timetables, the scheduler's
  `status,scheduledFor` scan, chat pagination, dues).
- The standing cost of this model is that a patch ships N times. That is the deliberate
  trade against unbounded tenant-isolation risk.

## What NOT to Do
- Do not add a `tenantId`. If multi-tenancy is ever needed it is a designed migration,
  not a field.
- Do not put industry vocabulary in core. If a string reads as forex or as exam-prep,
  it belongs in a pack's `labels`.
- Do not check authorization only in the page. Server actions are endpoints.
- Do not materialise drip release.
- Do not use a general-purpose expression evaluator for journal computed fields
  (see decisions.md — the obvious library has unfixed RCE advisories).
