## Current Status
**Last Updated**: 2026-07-26
**Last Agent Session**: Integrated four parallel subsystems (batches/attendance,
payments, marketing site, notifications), fixed the DB-test concurrency collision, added
the missing nav entries and label keys, verified the production build and every route,
and created this knowledge base.
**Test Suite Status**: **Passing.** 610 unit (`npm test`) + 71 database-backed
(`npm run test:db`). `npx tsc --noEmit` clean. Production build succeeds for
`nirlep-forex` and `demo-academy`.

## What exists now
43 routes build. Phase 1 of `docs/05-roadmap.md` is functionally complete:
- Foundation: auth, RBAC, brand theming, labels, org settings, pack installer
- Catalog + secure video: drip release, access authorization, signed playback with a
  grant ledger and concurrency limits, forensic watermarking, admin CRUD, student player
- Batches, live sessions, attendance
- Payments: checkout, signed webhooks, fee installments, invoices, coupons, reconciliation
- Marketing site: hub, landing pages, previews, lead capture, SEO
- Notifications: rendering, idempotent scheduling, delivery worker, in-app inbox

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
5. Phase 2 items not yet started: chat/community, assignments and grading, quizzes,
   certificates, journals UI, trackers UI, data-widget pages
   (`/app/widgets/[key]` currently 404s and is linked from pack nav).

## Do Not Touch
- `src/server/journals/expression.ts` — hand-written sandbox; do not replace with a
  library. See decisions.md.
- `prisma/migrations/**` — never edit an applied migration. Additive only.
- `.env`, `.env.test` — gitignored, hold local secrets.
- `.env.test`'s `DATABASE_URL` points at `lms_test`, which `npm run test:db`
  **truncates**. Never point it at a database with data you care about.
