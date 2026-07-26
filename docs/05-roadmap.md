# Delivery roadmap

## Scope assessment — read this first

The proposal guarantees deployment "at 1 Month from initial kickoff" for the full
feature matrix. Estimated bottom-up, that matrix is **≈114 developer-days**:

| Area | Days |
|---|---:|
| Foundation — tooling, auth, RBAC, brand layer, schema, seeding, CI/deploy | 11 |
| Marketing site + 2 landing pages + lead capture + SEO | 7 |
| Catalog authoring — courses, sections, lessons, media management | 8 |
| Secure video — Bunny/DRM, signed tokens, watermarking, concurrency, player | 8 |
| Cohorts & learning — batches, enrollment, drip engine, course player, resources | 13 |
| Live sessions + attendance tracking and reports | 7 |
| Payments — Razorpay, orders, webhooks, invoices, coupons, fee installments | 9 |
| Notifications engine + email/WhatsApp/SMS/push adapters + admin UI | 11 |
| Community chat — channels, realtime, moderation, attachments | 7 |
| Journals — dynamic forms, entries, computed fields, review | 7 |
| Trackers, data widgets, economic calendar, dashboards | 9 |
| Assignments and grading | 4 |
| Ops console, hardening, accessibility, security review, handover | 13 |
| **Total** | **114** |

**114 developer-days is ~23 developer-weeks.** One month of calendar time
therefore requires 5–6 developers working in parallel, which is not realistic to
coordinate on a greenfield codebase — the integration overhead would eat the gain.
Concretely:

- 1 developer → ~23 weeks
- 2 developers → ~11–12 weeks
- 4 developers → ~6–7 weeks, with meaningful coordination cost

**On the commercial side**, ₹60,000 against 114 developer-days works out to roughly
₹525 per developer-day. That is well below cost at any staffing level, and it is
worth naming before kickoff rather than discovering it in week six.

Two things make this recoverable, and they are the reason for the architecture in
this repo:

1. **Resale amortizes it.** The generalization work means client #2 costs a brand
   config plus a deployment — a few days, not 114. The first build funds the
   product; the product earns on every client after.
2. **Staging protects the relationship.** A Phase 1 that genuinely takes money and
   teaches students inside 4 weeks is a real, demonstrable delivery. Promising all
   thirteen areas in 4 weeks is not, and missing it costs more than scoping it
   honestly now.

**Recommendation:** go to the client with Plan A below before sign-off. Present
Phase 1 as the 1-month deliverable, Phase 2 as a scheduled follow-on, and either
reprice or stage payments across the two. If the client holds firm on the full
matrix in one month, that is their call to make with the numbers in front of
them — Plan B is what it would take.

---

## Plan A — staged delivery (recommended)

Assumes **2 developers**. Phase 1 is the revenue-capable product: a student can
buy a course, be placed in a batch, and consume drip-released protected video.

### Phase 1 — weeks 1–4 (≈43 dev-days)

**Week 1 — foundation**
- Repo, CI, staging deploy, environment wiring
- Prisma migrations, seed, packs installer
- Auth: email/password + Google, invites, password reset
- RBAC middleware, brand layer, label system, feature gating
- Verify `demo-academy` builds with `packs: []`

**Week 2 — catalog and video**
- Admin: course, section, lesson CRUD
- Media upload pipeline to Bunny Stream
- Signed playback token endpoint + `PlaybackGrant` ledger
- DRM configuration, forensic watermark overlay, concurrency enforcement
- Player integrated into the lesson view

**Week 3 — cohorts and learning**
- Batch and enrollment admin
- Drip release engine and access checks (including direct-URL denial)
- Student course player, progress tracking, resources vault
- Student dashboard v1

**Week 4 — payments and marketing**
- Razorpay checkout, order lifecycle, idempotent webhooks, auto-enrollment
- Invoices, coupons
- Marketing hub page, 2 course landing pages, lead capture, SEO/OG
- Hardening pass, deploy to production, owner training

**End of Phase 1:** courses can be sold and delivered. Content is protected.
Students are enrolled automatically on payment.

**Deliberately not in Phase 1:** notifications, live sessions, attendance, chat,
journals, trackers, dashboards, assignments, fee installments. Each is listed in
the proposal and each is scheduled below — none is being dropped.

### Phase 2 — weeks 5–10 (≈65 dev-days)

**Week 5–6 — operations**
- Notification engine: templates, rules, scheduler, dedupe
- Email + WhatsApp adapters, then SMS + push
- Class reminders, fee reminders, event notifications
- Fee schedules and installment tracking with dues reporting

**Week 7 — live delivery**
- Live sessions: scheduling, stream links, recording archive
- Attendance marking, per-student and per-batch reports
- Calendar events with reminder offsets

**Week 8 — community and coursework**
- Chat: channels, realtime, moderation, attachments
- Assignments and grading

**Week 9 — verticals and dashboards**
- Journal framework: dynamic forms, entries, computed fields, mentor review
- Forex trade journal live
- Trackers, data widget framework, economic calendar
- Admin dashboards, facilities/progress trackers

**Week 10 — hardening and handover**
- Ops console, reporting, audit log UI
- Accessibility, responsive, cross-browser
- Security review, rate limiting, backup verification
- Documentation and training

### Phase 3 — post-launch (within the free-support year)
- Quizzes and assessments (schema already in place)
- Certificates (schema already in place)
- Second vertical pack — the resale proof
- Mobile-optimized player, offline-safe progress sync

---

## Plan B — full matrix in 4 weeks

Requires **5–6 developers** plus a lead who writes no feature code, split along
the seams the architecture already provides:

| Dev | Track |
|---|---|
| Lead | Foundation, schema, brand/pack layers, review, integration |
| 1 | Catalog authoring + secure video pipeline |
| 2 | Cohorts, drip engine, student learning experience |
| 3 | Payments, fee installments, invoicing |
| 4 | Notification engine + all four channel adapters |
| 5 | Chat, journals, trackers, dashboards |
| 6 | Marketing site, landing pages, admin console, QA |

Week 1 is largely serial regardless — tracks 1–6 need auth, schema and the brand
layer before they can move independently, so expect real parallelism only from
week 2. Even staffed this way, 4 weeks leaves almost no margin for the hardening
in Plan A's week 10, and hardening is what acceptance testing actually probes.

---

## Assumptions and dependencies

Estimates assume the following. Each one that slips moves the dates.

**From the client** (the proposal's "Asset Assembly" step, all currently
`TODO(client)` in `brands/nirlep-forex/brand.config.ts`):
- Brand guidelines, logos, final domain
- Curriculum structure and the two programme definitions
- Recorded lecture content, or a schedule for it
- Razorpay account with KYC complete — this gates payment testing and often takes
  a week on its own
- Hosting, video library and storage accounts provisioned in their name
- Economic calendar API subscription and token
- WhatsApp Business sender approval, if that channel is wanted
- Approved copy for landing pages, and the legal/refund policies

**Contractual:** the "prevent native screen recording" line needs rewording before
sign-off — see [`docs/06-video-security.md`](./06-video-security.md) for why and
for suggested replacement wording. We will build the strongest achievable posture
either way, but that sentence as written cannot be honestly signed off at
acceptance.

**Excluded from the fee** per proposal section 3, and correctly so: cloud hosting,
databases, file hosting, streaming services, and third-party API subscriptions.
The economic calendar widget is built to degrade to a setup notice when its key is
absent, so a lapsed client subscription never presents as our outage.
