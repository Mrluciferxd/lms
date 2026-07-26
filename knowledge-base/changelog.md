# Changelog

## 2026-07-26 — Phase 1 build-out: batches, payments, marketing, notifications
**What**: Four parallel subsystems added — cohort/attendance management, Razorpay
payments with fee installments, the public marketing site, and the multi-channel
notification engine.
**Why**: Completes the Phase 1 scope in `docs/05-roadmap.md` so feature work can begin.
**Impact**: 43 routes now build. New admin surfaces, a public site replacing the
placeholder home page, and a cron-driven notification scheduler.
**Files Changed**: ~135 new files across `src/server/{batches,sessions,enrollments,
payments,marketing,notifications}`, `src/app/{(marketing),admin,app,api}`,
`src/components/marketing`. Central integration: `src/lib/nav.ts`, `src/lib/labels.ts`,
`package.json`.
**Tests**: 610 unit + 71 database-backed, all passing. Typecheck clean. Production
build verified for `nirlep-forex` and `demo-academy`.
**Commit**: pending

- Built by four parallel agents on disjoint file territories; shared files
  (`schema.prisma`, `nav.ts`, `labels.ts`, `package.json`, `roles.ts`) were fenced and
  integrated centrally to avoid merge conflicts.
- No schema change was required — the existing 52 models covered all four subsystems.
- Added nav entries for `/admin/coupons`, `/admin/notifications`, `/app/notifications`
  and the `nav.coupons` / `nav.notifications` label keys.
- Fixed `test:db` to run with `--test-concurrency=1`. See ISSUE-001.
- Corrected a placeholder `seoTitle` left in the dev `Page` row. See ISSUE-003.
- Verified all 22 primary routes return 200 under an authenticated staff session, 404
  for students on admin routes, and 307 to sign-in when anonymous.

## 2026-07-26 — Week 2: catalog authoring and secure video
**What**: Video provider abstraction, signed short-TTL playback with a grant ledger and
concurrency limits, forensic watermarking, drip release resolution, lesson access
authorization, catalog admin CRUD, student course view and protected player.
**Why**: Week 2 of the delivery roadmap; the content-protection posture the client
proposal depends on.
**Impact**: Video cannot be played without an authorization check that also enforces
drip and concurrent-stream limits. Playback URLs expire in 180s.
**Files Changed**: `src/server/media/*`, `src/server/catalog/*`, `src/server/batches/release.ts`,
`src/app/api/{playback,progress,media,webhooks/bunny}`, `src/app/admin/courses/**`,
`src/app/app/courses/**`, `src/components/player/*`.
**Tests**: Drip matrix (27), access matrix (26), signing (28), watermark (19),
playback DB tests (20).
**Commit**: `25263c8`

- Drip release pulled forward from Week 3: a playback endpoint without a drip check
  would hand out locked lessons via the API.
- Made the Prisma client lazily initialised — it was constructed at import time, which
  forced every test touching a module that imported `db` to need a live DATABASE_URL.
- Discovered and worked around the nullable-compound-unique limitation. See ISSUE-002.

## 2026-07-26 — Week 1: foundation
**What**: Auth (credentials + optional Google), capability-based RBAC, brand theming,
label system, org settings, seed and idempotent pack installer, app/admin shells, CI.
**Why**: Everything else depends on identity, authorization and the brand layer.
**Impact**: Establishes the patterns all later code follows.
**Files Changed**: `src/server/auth/*`, `src/lib/{brand,labels,nav,utils}`,
`src/app/{(auth),app,admin}`, `prisma/seed.ts`, `scripts/install-packs.ts`,
`.github/workflows/ci.yml`.
**Tests**: 96 passing at the time (expression evaluator, theme contrast, labels, packs).
**Commit**: `25263c8`

- Replaced `expr-eval` with a hand-written sandboxed evaluator. See decisions.md.
- Added a second vertical pack (`coaching`) and a third brand (`sunrise-academy`) to
  make the industry-agnostic claim testable rather than asserted.
