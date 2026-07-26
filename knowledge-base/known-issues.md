# Known Issues

## ISSUE-001: Database-backed tests collide when run in parallel
**Status**: Resolved
**Severity**: Medium
**Discovered**: 2026-07-26
**Resolved**: 2026-07-26
**Symptom**: `npm run test:db` failed 13 of 71 tests with foreign-key violations such as
`Order_userId_fkey` on a user the test had just created. Every file passed in isolation.
**Root Cause**: Four `*.dbtest.ts` files each truncate shared tables (`User`, `Course`,
`Order`, …) in their `before()` hook. `node:test` runs test *files* concurrently by
default, so one file's reset deleted rows another file was mid-way through using.
**Workaround**: Run a single file: `npx tsx --env-file-if-exists=.env.test --test <file>`.
**Fix**: `test:db` now passes `--test-concurrency=1`. These tests share one database by
design, so serial execution makes that constraint explicit rather than incidental.
**Regression Test**: The full `npm run test:db` run is the regression test — it fails
non-deterministically if concurrency is reintroduced.

## ISSUE-002: `Enrollment` compound unique does not constrain self-paced enrollments
**Status**: Accepted Risk
**Severity**: Medium
**Discovered**: 2026-07-26
**Symptom**: `@@unique([userId, courseId, batchId])` reads as "one enrollment per student
per course per batch" but does not prevent duplicates when `batchId` is null, which is
exactly the self-paced case. Separately, Prisma throws
``Argument `batchId` must not be null`` when you try to `upsert` against that unique.
**Root Cause**: Postgres treats NULLs as distinct in a unique index. Postgres 15+ could
fix it with `NULLS NOT DISTINCT`, but Prisma has no syntax for it (verified against 7.9),
so adding it via raw SQL would put `schema.prisma` permanently out of step with the
database and break the CI migration-drift check.
**Workaround**: Never create an `Enrollment` directly. Always use `enrollUser()` in
`src/server/enrollments/enroll.ts`, which checks first and reactivates rather than
duplicating.
**Fix**: Not fixed at the database level by choice — see decisions.md. Revisit if Prisma
gains `nullsNotDistinct` support.
**Regression Test**: `src/server/payments/payments.dbtest.ts` exercises repeat
enrollment through the webhook path.

## ISSUE-003: Placeholder SEO title leaked into the dev database
**Status**: Resolved
**Severity**: Low
**Discovered**: 2026-07-26
**Resolved**: 2026-07-26
**Symptom**: The marketing home page rendered a browser tab title of
"Custom SEO title from the CMS".
**Root Cause**: Not a code defect — the marketing site correctly reads `seoTitle` from
the `Page` CMS record, and a `Page` row with slug `home` in the *dev* database held a
placeholder value left behind during development.
**Workaround**: n/a
**Fix**: The dev row's `seoTitle` was updated to a real brand-appropriate value. Note
that `prisma/seed.ts` deliberately seeds no sample content, so a fresh client database
is unaffected.
**Regression Test**: None — this was data, not logic.

## ISSUE-004: Bunny Stream signature composition is unverified
**Status**: Open
**Severity**: High
**Discovered**: 2026-07-26
**Symptom**: None yet — no Bunny library has been provisioned.
**Root Cause**: `signBunnyToken` and `signBunnyUploadSignature` in
`src/server/media/signing.ts` are implemented from Bunny's published documentation but
have never been exercised against a live library, because credentials are a
client-provisioned dependency.
**Workaround**: Development uses the `LOCAL` provider, whose signing is fully verified
because we own both ends.
**Fix**: Validate against a real library as the first step of Bunny integration. A wrong
hash composition fails closed (every playback 403s), so it will surface immediately
rather than subtly — but budget the check.
**Regression Test**: `src/server/media/signing.test.ts` covers what is verifiable
offline: determinism, URL-safe alphabet, sensitivity to key/path/expiry/IP, and query
assembly. It cannot verify that Bunny's edge accepts the result.

## ISSUE-005: DRM playback is not wired for Chrome and Edge
**Status**: Open
**Severity**: High
**Discovered**: 2026-07-26
**Symptom**: A DRM-protected source on a browser without native support renders an
explanatory message instead of video.
**Root Cause**: Widevine (Chrome) and PlayReady (Edge) require an MSE player such as
shaka-player configured with the license endpoints. This was deliberately not stubbed:
it cannot be exercised without a provisioned Bunny library, and an untested DRM path
that silently falls back to unprotected playback would be worse than an explicit gap.
**Workaround**: Safari plays HLS/FairPlay natively today. The `LOCAL` provider serves
progressive MP4, so all non-DRM development works.
**Fix**: Complete alongside Bunny integration (ISSUE-004) as one verified unit.
**Regression Test**: Pending.

## ISSUE-006: Notification channel adapters other than in-app are unwired
**Status**: Open
**Severity**: Medium
**Discovered**: 2026-07-26
**Symptom**: Email, SMS, WhatsApp and push notifications are recorded and logged but not
delivered.
**Root Cause**: No provider SDKs are installed (Resend, MSG91, Meta WhatsApp Cloud).
Each channel is implemented against the adapter interface with a logging adapter that
records what would be sent.
**Workaround**: In-app notifications work fully; the delivery log in
`/admin/notifications/log` shows what each channel would have sent.
**Fix**: Add the provider SDK, implement the adapter, select it from
`brand.integrations`. The interface and the scheduler do not change.
**Regression Test**: `src/server/notifications/scheduler.dbtest.ts` covers scheduling
and idempotency independently of delivery.

## ISSUE-007: `git add` stalls in some working directories
**Status**: Resolved
**Severity**: Low
**Discovered**: 2026-07-26
**Resolved**: 2026-07-26
**Symptom**: `git add -A` hung for minutes and left a stale `.git/index.lock`, even for
a 120-file change, while the project lived under `~/Desktop/LMS`.
**Root Cause**: Not diagnosed precisely — consistent with a filesystem/indexing
interaction on that path (other scanners were observed running against it). The same
command completed instantly after the project moved to `~/Downloads/LMS`.
**Workaround**: If it recurs, remove the stale `.git/index.lock` after confirming no git
process is running, and stage explicit paths rather than `-A`.
**Fix**: Resolved by the directory move; no code change.
**Regression Test**: n/a
