# Decisions

## Decision: White-label per-client deployment instead of multi-tenant SaaS
**Date**: 2026-07-26
**Status**: Accepted
**Context**: The platform must serve many client academies. A single multi-tenant
deployment (shared database, `tenantId` on every row) was the obvious alternative.
**Decision**: One codebase, one deployment and one Postgres database per client. There
is no `tenantId` anywhere in the schema.
**Alternatives Considered**: Multi-tenant with row-level security — rejected because a
single missing `where: { tenantId }` leaks one academy's students, revenue or private
journals into another's dashboard, and that class of bug is unbounded liability.
Hybrid (multi-tenant schema, single-tenant deploy) — rejected as carrying the cost of
both without the safety of either.
**Consequences**: Cross-tenant leakage is structurally impossible. Client data is
physically separable for export or exit. The standing cost is that every migration and
security patch ships N times, which is why `docs/04-white-label.md` exists as a
checklist. If N grows large enough to hurt, adding `tenantId` is a designed migration —
the generalization work makes it mechanical rather than a rewrite.

## Decision: Hand-written expression evaluator instead of `expr-eval`
**Date**: 2026-07-26
**Status**: Accepted
**Context**: Journal computed fields (e.g. a trade's R-multiple) are expressions
authored by admins and stored in the database, then evaluated server-side on every read.
That makes the evaluator a trust boundary.
**Decision**: A ~200-line recursive-descent parser in
`src/server/journals/expression.ts`.
**Alternatives Considered**: `expr-eval` — rejected: two unfixed high-severity
advisories against every published version (GHSA-8gw3-rxh4-v6jx prototype pollution,
GHSA-jc85-fpwf-qm7x arbitrary code execution via unrestricted function references), with
`npm audit` reporting no fix available. Other general-purpose evaluators share the
problem because their goal is expressiveness and ours is containment.
**Consequences**: Containment is structural rather than a denylist — there is no `.` or
`[]` in the grammar, so `__proto__`/`constructor` are unreachable; callables exist only
as a fixed table; identifiers resolve only from entry data via `Object.hasOwn` against a
null-prototype scope. We own the maintenance, but the grammar is deliberately small.
13 of its tests are escape attempts.

## Decision: Drip release is computed, never materialised
**Date**: 2026-07-26
**Status**: Accepted
**Context**: Lessons unlock on schedules anchored to enrollment dates, batch start
dates, fixed dates or a live session ending.
**Decision**: Availability is computed at read time from the lesson's rule plus the
student's enrollment and batch. There is no per-student unlock table.
**Alternatives Considered**: A materialised `LessonUnlock` table — rejected because
batch start dates move (cohorts slip, classes reschedule) and every such edit would need
a backfill, with a stale row for every one missed.
**Consequences**: A rescheduled cohort re-locks content immediately with no migration.
The cost is that release must be resolved on every access check, which is why
`resolveRelease` is pure and cheap and the outline resolves a whole course in three
queries rather than three per lesson.

## Decision: Enrollment uniqueness enforced in code, not by a database constraint
**Date**: 2026-07-26
**Status**: Accepted
**Context**: `Enrollment` declares `@@unique([userId, courseId, batchId])`, but
`batchId` is nullable and Postgres treats NULLs as distinct, so self-paced enrollments
are not actually constrained. Prisma additionally cannot target a compound unique
containing a null.
**Decision**: All enrollment creation goes through `enrollUser()` in
`src/server/enrollments/enroll.ts`, which checks before writing.
**Alternatives Considered**: `NULLS NOT DISTINCT` (Postgres 15+) — rejected because
Prisma has no syntax for it (verified against 7.9), so adding it via raw SQL would leave
`schema.prisma` permanently out of step with the database and break the CI drift check.
A sentinel non-null `batchId` — rejected as making every query lie about its meaning.
**Consequences**: The guarantee is only as good as the discipline of using the helper.
The check-then-write is not atomic, which is acceptable because the paths that create
enrollments are idempotent upstream (the Razorpay webhook dedupes on `WebhookEvent`
before reaching it). Documented as ISSUE-002 so it is not rediscovered.

## Decision: Lazy Prisma client initialisation
**Date**: 2026-07-26
**Status**: Accepted
**Context**: `src/server/db.ts` originally constructed the client at module import.
Any module transitively importing it — including modules whose logic under test was
pure — required a live `DATABASE_URL`.
**Decision**: The exported `db` is a `Proxy` that constructs the client on first
property access.
**Consequences**: Pure logic co-located with database code is unit-testable without
environment setup. Slight indirection on every call, which is immaterial next to query
latency.

## Decision: Database-backed tests run serially
**Date**: 2026-07-26
**Status**: Accepted
**Context**: Four `*.dbtest.ts` files each truncate shared tables in `before()`, and
`node:test` runs files concurrently by default. 13 tests failed with foreign-key
violations on rows another file had just deleted.
**Decision**: `test:db` runs with `--test-concurrency=1`.
**Alternatives Considered**: A schema or database per test file — more isolation but
significant setup cost and slower. Scoping each file's cleanup to only its own rows —
fragile, since cascades cross file boundaries.
**Consequences**: DB tests are slower but deterministic. The constraint (they share one
database) is now explicit in how they are invoked rather than an invisible landmine.

## Decision: A local video provider exists for development
**Date**: 2026-07-26
**Status**: Accepted
**Context**: Bunny Stream credentials are client-provisioned and were unavailable during
the build.
**Decision**: A `LOCAL` `MediaProvider` serving from the filesystem with our own HMAC
signed URLs, selected automatically in development when the configured provider's
credentials are absent. It refuses to run in production.
**Consequences**: The entire video pipeline — upload, authorization, signed playback,
concurrency ledger, watermark, player — is exercisable and testable without waiting on
the client. Bunny's signature composition remains the one unverified piece; see
known-issues ISSUE-004.

## Decision: Test runner is `node:test` via `tsx`
**Date**: 2026-07-26
**Status**: Accepted
**Context**: Needed a test runner with no build step for a TypeScript Next.js project.
**Alternatives Considered**: Vitest — capable and popular, but an extra dependency and
config surface for what `node:test` already does natively on Node 22+.
**Consequences**: Zero test-framework dependencies. No built-in mocking library, which
has pushed the codebase toward pure functions with injected inputs — a net benefit.
