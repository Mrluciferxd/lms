## Current Status
**Last Updated**: 2026-08-05
**Last Agent Session**: Built the trackers UI (Phase 2 Week 9 item): student
pages `/app/trackers` (list) + `/app/trackers/[key]` (per-type editor) and an
admin console `/admin/trackers` + `/admin/trackers/[key]` (gated by
`tracker:manage`). A shared `TrackerEditor` client component renders all five
types (COUNTER/BOOLEAN/CHECKLIST/GAUGE weighted-or-simple/EXPIRY) against the
pack-declared `trackerDefinitions`; the admin detail renders the full subject
universe (GLOBAL/BATCH/STUDENT) with create-on-empty editors. One `'use server'`
`updateTracker` action is the only writer, re-checking `decideCanUpdateRecord`
on every upsert. `nav.trackers` label + APP_NAV/ADMIN_NAV entries added. No
schema changes (`TrackerDefinition`/`TrackerRecord` were already migrated).
Verified `demo-academy` and `nirlep-forex` production builds (sequential —
parallel builds race on `prisma generate`).
**Test Suite Status**: **Passing.** 899 unit tests (`npm test`).
`npx tsc --noEmit` clean. Production build succeeds for `nirlep-forex` and
`demo-academy`.

## What exists now
58 routes build (was 54; added `/app/trackers`, `/app/trackers/[key]`,
`/admin/trackers`, `/admin/trackers/[key]`). Phase 1 of `docs/05-roadmap.md`
is functionally complete; Phase 2 in progress:
- Foundation: auth, RBAC, brand theming, labels, org settings, pack installer
- Catalog + secure video: drip release, access authorization, signed playback with a
  grant ledger and concurrency limits, forensic watermarking, admin CRUD, student player
- Batches, live sessions, attendance
- Payments: checkout, signed webhooks, fee installments, invoices, coupons, reconciliation
- Marketing site: hub, landing pages, previews, lead capture, SEO
- Notifications: rendering, idempotent scheduling, delivery worker, in-app inbox
- **Community chat: channels, messages, reactions, pinning, threads, soft
  delete, membership, moderation, archive** *(no realtime yet — see chat.md)*
- **Assignments & grading: course/batch scope, explicit submit, grading queue
  with score + feedback + return-for-resubmit** *(no DB-backed tests yet)*
- **Journals: pack-seeded `JournalDefinition` + entry composer for every
  `JournalFieldType` + comment thread + lifecycle close/reopen + staff review
  console** *(no DB-backed tests yet — see journals.md)*
- **Data widgets: normalized snapshot envelope + cron refresh worker +
  standalone `/app/widgets/[key]` timeline page** *(refresh worker has no
  DB-backed tests yet — see widgets.md)*
- **Trackers: student `/app/trackers` list + `/app/trackers/[key]` editor for
  COUNTER/BOOLEAN/CHECKLIST/GAUGE/EXPIRY; admin `/admin/trackers` console
  rendering the full subject universe** *(no DB-backed tests yet — see
  trackers.md)*

## Verified this session
- All 22 primary routes return 200 under an authenticated staff session.
- All 11 admin routes return 404 for a student — not 403, so route existence is not
  disclosed.
- Anonymous requests 307 to `/sign-in` with `next` preserved.
- `POST /api/playback` unauthenticated returns 404; `/api/cron/notifications` without
  `CRON_SECRET` returns 401.
- Protected playback end to end: token issued → renewed → media served `206` (Range) →
  grant released on unmount, with the watermark rendering live viewer identity.

## Deployed
**Production**: https://lms-techgeekz3.vercel.app (Vercel project `lms`, team
`techgeekz3`, Hobby plan, region `iad1`).

Database is Neon `neon-aquamarine-lens` in `us-east-1`, connected through the Vercel
storage integration. Migrations applied, `OrgSettings` seeded, owner account created,
forex pack installed. Previews stay behind Vercel SSO; production is public.

Verified against production: all 22 primary routes 200 for staff, anonymous requests
307 to sign-in with `next` preserved, `/api/cron/notifications` 401s without its secret.
`/app/courses/demo-programme` correctly 404s — that demo course exists only in the local
dev database, since `prisma/seed.ts` seeds no sample content into a client deployment.

See [deployment.md](./deployment.md) for the hosting decisions and the gotchas that cost
time (env-pull redaction, deployment protection, git-author blocking).

## Blocked On
- **Bunny Stream credentials** — blocks ISSUE-004 (signature verification) and ISSUE-005
  (DRM playback for Chrome/Edge). Client-provisioned; see `docs/04-white-label.md`.
- **Razorpay account** — payments are implemented and unit-tested but have never run
  against the live gateway.
- **Notification provider accounts** (Resend / MSG91 / WhatsApp Cloud) — ISSUE-006.
- **A deployment target.** Nothing is hosted. There is no Dockerfile, no platform config
  and no managed Postgres. `npm start` against a local build is the current "deploy".

## Decisions Needed
1. Where should this be hosted? (Vercel is the path of least resistance for Next.js;
   the client owns the account per the proposal's exclusions.)
2. Should the "prevent native screen recording" clause be reworded before sign-off?
   Suggested replacement text is in `docs/06-video-security.md`.
3. The 1-month timeline still does not fit the full scope — see `docs/05-roadmap.md`.

## Next Steps
1. Add a Playwright smoke suite covering sign-in, a locked lesson, playback, and one
   admin write — route-level curl checks are currently doing that job.
2. Wire one real notification channel (email is the cheapest) to prove the adapter seam.
3. Provision hosting + managed Postgres, add a deploy workflow, run migrations there.
4. Complete Bunny integration as one verified unit: signature, TUS upload, DRM player.
5. Chat follow-ups: a `chat.dbtest.ts` (pagination, markChannelRead upsert,
   mute expiry, deleteMessage idempotency); a realtime seam (SSE/WebSocket)
   behind `feature.chat` — the pure decisions are already wired for it; see
   `knowledge-base/chat.md`.
6. Assignments follow-ups: an `assignments.dbtest.ts` (queue ordering, late
   flag, grade idempotency, reopen/re-grade transitions); a per-submission
   notification on grade; student score release gating if scores ever need to
   hide before a window — the `SCORE_NOT_RELEASED` denial reason is reserved.
7. Journals follow-ups: a `journals.dbtest.ts` (queue ordering, computed-field
   null-propagation in `buildScope`, comment cascade on entry delete); a
   `router.refresh()` in the comment editor instead of `window.location.reload()`;
   per-field client hints exported from validation.ts so a student can retry
   without round-tripping.
8. Phase 2 items not yet started: quizzes, certificates.
9. Trackers follow-ups: a `trackers.dbtest.ts` (record upsert by partial-nullable
   composite unique; reminder firing against `remindBeforeDays`; admin
   subject-universe merges existing records); dashboard surfaces rendering
   relevant tracker cards on the app/admin dashboards.
10. Widgets follow-ups: a `widgets.dbtest.ts` (fresh snapshot skipped, expired
    refreshed, throw recorded as `error` with bounded retry cadence); an
    `/admin/widgets` console with the setup checklist + refresh-now button;
    dashboard surfaces rendering on the app / admin dashboards.

## Do Not Touch
- `src/server/journals/expression.ts` — hand-written sandbox; do not replace with a
  library. See decisions.md.
- `prisma/migrations/**` — never edit an applied migration. Additive only.
- `.env`, `.env.test` — gitignored, hold local secrets.
- `.env.test`'s `DATABASE_URL` points at `lms_test`, which `npm run test:db`
  **truncates**. Never point it at a database with data you care about.
