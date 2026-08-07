# Changelog

## 2026-08-07 — Phase 2: quizzes (server layer + admin console + student taker)
**What**: The quizzes subsystem gets its full surface. Server layer
(`validation`/`access`/`quizzes`/`actions`) with auto-grading for
SINGLE_CHOICE / MULTI_CHOICE / TRUE_FALSE and a pending-grade path for
subjective types; an admin console (`/admin/quizzes`, `/admin/quizzes/new`,
`/admin/quizzes/[id]`, gated by `course:write`) with a question editor; a
student index + taker (`/app/quizzes`, `/app/quizzes/[id]`) with attempt
history; and a "Take quiz" embed link on the lesson page when the lesson has a
PUBLISHED quiz.
**Why**: Fourth Week 9 subsystem (journals, data-widgets and trackers shipped;
quizzes was the remaining one). The schema existed with no routes, no nav, no
editor and no taker.
**Impact**: 5 new routes. Grading is split — objective types auto-grade on
submit, subjective types store `isCorrect: null`/`points: 0` with the attempt's
`passed` left null for a manual-grade cut that is not yet built.
`BrandFeatures.quizzes` defaults **false**, so the feature is opt-in per brand
(unlike journals/trackers/widgets).
**Files Changed**:
- New: `src/server/quizzes/{validation,access,quizzes,actions}.ts` +
  `{validation,access}.test.ts`, `src/components/quizzes/quiz-editor.tsx`,
  `src/components/quizzes/quiz-taker.tsx`,
  `src/app/app/quizzes/page.tsx`, `src/app/app/quizzes/[id]/page.tsx`,
  `src/app/admin/quizzes/page.tsx`, `src/app/admin/quizzes/new/page.tsx`,
  `src/app/admin/quizzes/[id]/page.tsx`, `knowledge-base/quizzes.md`.
- Modified: `src/lib/labels.ts` (`nav.quizzes`), `src/lib/nav.ts` (APP_NAV +
  ADMIN_NAV entries), lesson page (PUBLISHED-quiz embed link).
- No schema change — `Quiz`/`Question`/`QuizAttempt`/`QuizAnswer` were already
  in the original migration.
**Tests**: 926 unit (was 899; +27 — response parsing, objective auto-grading,
subjective pending-grade, `scoreAttempt` pass-boundary and clamping, and the
read/take/start access matrix). Typecheck clean. Production build verified for
`nirlep-forex` and `demo-academy`.
**Decisions**:
- Auto-grade only objective types; subjective answers keep `isCorrect: null`
  and the attempt `passed: null`. MULTI_CHOICE is full-match only — no partial
  credit. Manual grading, partial credit, timer enforcement and explanation
  reveal are documented later cuts in quizzes.md.
- `maxAttempts` counts submitted attempts; an in-flight attempt is resumed,
  not burned. `startAttempt` pre-creates one `QuizAnswer` per question so
  submit is a flat update keyed by the `@@unique([attemptId, questionId])`
  index.
- Student read shapes strip `correct` flags entirely — the taker never has
  access to answers, only the score after submit.
- `scoreAttempt` takes `{ grade, maxPoints }[]` because a failed answer stores
  `points: 0`, so max score cannot be reconstructed from rows.

## 2026-08-05 — Phase 2: trackers UI (student surface + admin console)
**What**: The trackers subsystem gets its surface. New student pages
`/app/trackers` (list) and `/app/trackers/[key]` (per-type editor) render the
three pack-declared trackers (`forex.challenge-progress` GAUGE,
`coaching.syllabus-completion` GAUGE, `coaching.tests-attempted` COUNTER,
`coaching.test-series-access` EXPIRY) with a shared `TrackerEditor` that knows
all five types (COUNTER/BOOLEAN/CHECKLIST/GAUGE weighted-or-simple/EXPIRY). A
new admin console (`/admin/trackers` + `/admin/trackers/[key]`, gated by
`tracker:manage`) renders the full subject universe — GLOBAL single record,
BATCH per-batch, STUDENT per-active-student — with create-on-empty editors so
an admin can grant an EXPIRY (test-series access) the student cannot self-grant.
**Why**: Third Week 9 subsystem (journals and data-widgets shipped; trackers
was the third). The schema, pack declarations, feature flag and
`tracker:manage` permission all existed with no routes, no nav and no editor.
**Impact**: 4 new routes (`/app/trackers`, `/app/trackers/[key]`,
`/admin/trackers`, `/admin/trackers/[key]`). Core learns one per-type value
shape via `normalizeTrackerUpdate`/`parseRecordValue`; the editor is a single
client component shared by the student and admin surfaces. The
`decideCanUpdateRecord` rule keeps EXPIRY/BATCH/GLOBAL staff-only while a
STUDENT-scope non-EXPIRY tracker is owner-writable — the student
"self-log progress" surface.
**Files Changed**:
- New: `src/server/trackers/{validation,access,trackers,actions}.ts` +
  `{validation,access}.test.ts`, `src/components/trackers/tracker-editor.tsx`,
  `src/app/app/trackers/page.tsx`, `src/app/app/trackers/[key]/page.tsx`,
  `src/app/admin/trackers/page.tsx`, `src/app/admin/trackers/[key]/page.tsx`.
- Modified: `src/lib/labels.ts` (`nav.trackers`), `src/lib/nav.ts` (APP_NAV +
  ADMIN_NAV entries).
- No schema change — `TrackerDefinition`/`TrackerRecord` were already in the
  original migration.
**Tests**: 899 unit (was 869; +30 — validation config/normalize/parse/progress/
expiry-logic across all five types, plus the access matrix for read + the four
write scopes). Typecheck clean. Production build verified for `nirlep-forex`
and `demo-academy`.
**Decisions**:
- One action covers every type: the input is tagged by `TrackerUpdate.type`
  and `normalizeTrackerUpdate` is the single source of truth — same posture as
  the data-widget envelope. A type mismatch between the definition row and the
  payload refuses with "Tracker type mismatch".
- Admin detail renders the full subject universe (every batch / every active
  student) with a per-subject editor, so an EXPIRY grant has a path even when
  no record exists yet. Synthetic empty records are produced by the server
  read, not the page, so the editor stays mock-free.
- The editor calls `router.refresh()` on success; no `revalidatePath`. The
  access matrix is the security boundary, not the form.

## 2026-08-05 — Phase 2: data-widget pages (cron refresh + standalone page)
**What**: The data-widget subsystem gets its surface. Adapters now emit a
normalized `DataWidgetSnapshotPayload` envelope (`items`/`generatedAt`/
`unavailable`); a new cron route `/api/cron/widgets` refreshes stale snapshots
off the request path through the pack `dataAdapters` map; and `/app/widgets/[key]`
renders a timezone-grouped timeline with a setup notice on `unavailable`. The
shared `CRON_SECRET` gate was extracted to `src/server/cron/authorize.ts` and
the notifications route refactored onto it.
**Why**: Third Week 9 subsystem (alongside journals and trackers). The
forex/coaching pack nav items link `/app/widgets/forex.economic-calendar` and
`/app/widgets/coaching.exam-calendar`, which 404'd — the declarative widget rows
and adapters existed with no page and no refresh job to fill a snapshot.
**Impact**: 2 new routes (`/app/widgets/[key]`, `/api/cron/widgets`). Core
learns exactly one widget payload shape — the envelope in `src/packs/types.ts`
— so the same page serves an economic calendar and an exam calendar with zero
industry knowledge. Adapter payloads changed shape (events/dates → items);
safe because no snapshots existed in any database yet.
**Files Changed**:
- New: `src/server/widgets/{access,widgets,refresh}.ts`,
  `src/server/widgets/{access,widgets}.test.ts`,
  `src/server/cron/authorize.ts`,
  `src/app/api/cron/widgets/route.ts`,
  `src/app/app/widgets/[key]/page.tsx`,
  `knowledge-base/widgets.md`.
- Modified: `src/packs/types.ts` (envelope contract),
  `src/packs/forex/economic-calendar.ts`, `src/packs/coaching/exam-calendar.ts`
  (emit envelope), `src/app/api/cron/notifications/route.ts` (use shared gate),
  `knowledge-base/{README,testing,active-context}.md`.
- No schema change — `DataWidgetDefinition`/`DataWidgetSnapshot` were already
  in the original migration.
**Tests**: 869 unit (was 853; +16 for widgets — 7 access/standalone matrix + 9
defensive envelope parsing). Typecheck clean. Production build verified for
`nirlep-forex` and `demo-academy`.
**Commit**: `1f77d8f`
- The snapshot envelope is the load-bearing decoupling: adapters own vendor
  normalization, core re-validates the stored Json on read and renders a
  timeline. No `packs/forex` / `packs/coaching` import anywhere in
  `src/server`; the worker reaches adapters only through `@/lib/brand`'s
  `dataAdapters` map.
- Fetching is cron-only and `refresh.ts` is the sole snapshot writer. An
  in-flight map collapses overlapping cron runs into one vendor call; a throw
  is recorded in the snapshot `error` column and retried on the transient
  cadence, so a lapsed API key renders a setup notice instead of breaking a
  page (client owns the subscription per the proposal's exclusions).
- Standalone is opt-in: a widget without the `standalone` surface 404s on
  direct URL access; disabling a widget ices the route and the nav, matching
  the 404-over-403 and "hiding a link is not gating" postures.

## 2026-08-05 — Phase 2: journals UI (server + student UI + review console)
**What**: The journals subsystem — pack-seeded `JournalDefinition` records
(fields plus computed expressions) finally have a UI. Students get a journal
list with sidebar + entry composer rendering every `JournalFieldType`, an entry
detail page with comments and a lifecycle close/reopen, and staff get a review
console that bypasses visibility per the `journal:review` permission.
**Why**: Second Week 9 subsystem (alongside trackers and data widgets). The
forex/coaching packs both ship one journal that was previously a definition row
with no surface; the nav `/app/journal/{trade,mock-test}` linked nowhere.
**Impact**: 5 new routes (`/app/journal/[key]`, `/app/journal/[key]/[entryId]`,
`/admin/journal`, `/admin/journal/[key]`). One new admin nav sector
(`journal-review`, gated by `journal:review`). The pack nav items already
declared in forex/coaching now resolve.
**Files Changed**:
- New: `src/server/journals/{access,validation,journals,actions}.ts`,
  `src/server/journals/{access,validation}.test.ts`,
  `src/app/app/journal/[key]/{page,[entryId]/page}.tsx`,
  `src/app/admin/journal/{page,[key]/page}.tsx`,
  `src/components/journals/{entry-composer,comment-editor,lifecycle-buttons}.tsx`,
  `knowledge-base/journals.md`.
- Modified: `src/lib/nav.ts` (admin `journal-review` sector), focused only.
- No schema change — `JournalDefinition` / `JournalEntry` / `JournalEntryComment`
  were already in the original migration.
**Tests**: 853 unit (was 748; +105 for journals — 76 visibility/comment
matrix + 29 validation of every `JournalFieldType`). Typecheck clean.
Production build verified for `nirlep-forex` and `demo-academy`.
**Commit**: `4cd601a`
- Core owns its own `JournalFieldType` union mirroring the pack contract — the
  pack writes the JSON, core parses it back as data. `core never imports a
  pack` is preserved; verified with `grep -rn "from '@/packs" src/server/journals`
  staying empty.
- Computed fields evaluate on read through `evaluateExpression`, the hand-written
  sandbox (see decisions.md). No computed value is persisted; editing
  `entryPrice` immediately re-flows `pnlAmount`.
- Defensive against a malformed BATCH entry with no `batchId`: closed to
  non-reviewer staff so a data bug cannot widen into a visibility leak.
- Image/file field types are typed as opaque upload-id strings in the validator;
  a richer media picker UI belongs in the resources vault, not journals.

## 2026-08-04 — Phase 2: assignments & grading (server + student UI + grading queue)
**What**: The assignments subsystem — course/batch-scoped assignments, student
submissions with an explicit submit gesture, and a staff grading queue with
score + feedback + return-for-resubmit. Four routes: student list + detail,
admin overview + grading queue.
**Why**: Second Phase 2 Week 8 item (alongside chat). The two pack pair was
already seeded with `assignment:manage` / `assignment:grade` permissions; this
gives them consumers.
**Impact**: 4 new routes (`/app/assignments`, `/app/assignments/[id]`,
`/admin/assignments`, `/admin/assignments/[id]`). Two new permission surfaces
now exercised (`assignment:manage`, `assignment:grade`). Notification anchors
referencing `/app/assignments/[id]` now resolve to a real page.
**Files Changed**:
- New: `src/server/assignments/{access,validation,assignments,actions}.ts`,
  `src/server/assignments/{access,validation}.test.ts`,
  `src/app/app/assignments/{page,[id]/page}.tsx`,
  `src/app/admin/assignments/{page,[id]/page}.tsx`,
  `src/components/assignments/{submission-composer,grading-form}.tsx`,
  `knowledge-base/assignments.md`.
- Modified: `src/app/admin/assignments/page.tsx` (removed a leftover unused
  `ChannelType` import + `void` hack that broke the build), focused only.
- No schema change — `Assignment`/`Submission` were already in the original
  migration.
**Tests**: 748 unit (was 682; +66 for assignments — access + validation),
typecheck clean, production build verified for `nirlep-forex` and
`demo-academy`. Also deleted a build-breaking `ChannelType` cruft import the
parallel prisma-generate race exposed.
**Commit**: `95f2d66`
- `decideCanSubmit` takes `now` as an argument so the late policy is enforced
  at submit time against the server clock — a form that rendered on time can be
  past due when Submit lands.
- The grading queue orders `SUBMITTED` first, FIFO by `submittedAt` — waiting
  work is always on top.
- Two builds in parallel race on `prisma generate` (one clobbers the other's
  `src/generated` mid-typecheck). Run the brand builds sequentially.

## 2026-08-02 — Phase 2: community chat (Part 1 — server + UI)
**What**: Built the community chat subsystem — channels, messages, reactions,
pinning, threading (1-deep), soft delete, membership, moderation, archive, and
the admin moderation console. Six `ChannelType`s cover every audience shape
(GLOBAL/ANNOUNCEMENT/COURSE/BATCH/TOPIC/DIRECT) without an industry-specific
table; pack-seeded rooms (#market-talk, #doubts, etc.) now have a UI to be
opened in.
**Why**: First piece of `docs/05-roadmap.md` Phase 2 Week 8 — the largest
self-contained subsystem with no upstream dependency. Chat also paves the
"server action = endpoint, re-check auth on every write" pattern the rest of
Phase 2 (assignments, journals UI) will follow.
**Impact**: 3 new routes (`/app/community`, `/app/community/[channel]`,
`/admin/community`), 1 new permission surface (`chat:moderate` already existed
in roles.ts but now has a consumer), 1 new admin nav sector. The pack
`onInstall`'s `seedChannel` calls — already shipping #market-talk,
#trade-reviews, #doubts, #study-group — now have a UI surface.
**Files Changed**:
- New: `src/server/chat/{membership,validation,channels,actions}.ts`,
  `src/server/chat/{membership,validation}.test.ts`,
  `src/app/app/community/{page,[channel]/page}.tsx`,
  `src/app/admin/community/page.tsx`,
  `src/components/chat/{composer,message-controls}.tsx`,
  `knowledge-base/chat.md`.
- Modified: `src/lib/nav.ts` (admin `community` sector), focused additions only.
- No schema change — `Channel`/`ChannelMember`/`Message`/`MessageReaction`
  were already in the original migration on purpose.
**Tests**: 682 unit (was 610; +72 for chat — 38 membership, 24 validation, plus
10 supporting the new flag/label). Typecheck clean. Production build verified
for `nirlep-forex` and `demo-academy`. The `demo-academy` build — the
core/pack coupling regression target — caught a real layering bug during this
work: a `'use client'` component had transitively imported `db.ts` via
`@/server/chat/membership`. Removed; build clean.
**Commit**: `4f34b2d`
- The layering rule (core never imports a pack; client never imports a
  server-only module) is enforced by build, not by review. The
  `NEXT_PUBLIC_BRAND=demo-academy` build verified it — without that step the
  bug would have shipped.
- `decideChannelVisibility` is the pure decision the channel list, the channel
  page and the write actions all consult. One implementation, three
  consumers — mirroring `decideSessionVisibility` and `decideAccess`.
- No realtime (SSE/WebSocket) in this cut. The pure decisions and the message
  list are wired for it: a realtime seam can join `feature.chat` without
  touching the write actions or the visibility matrix. See chat.md.

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
