# Testing

## Test Frameworks in Use
- `node:test` (Node 22+ built-in) executed through `tsx` for TypeScript support.
- No external test framework, no mocking library. See decisions.md for why.

## How to Run Tests
| Command                                   | What it runs                                    |
|-------------------------------------------|-------------------------------------------------|
| `npm test`                                 | All unit tests (`src/**/*.test.ts`), 853 tests  |
| `npm run test:db`                          | Database-backed tests (`src/**/*.dbtest.ts`), 71 |
| `npx tsx --test src/path/to/one.test.ts`   | A single unit test file                         |
| `npm run typecheck`                        | `tsc --noEmit`                                  |

`npm test` pins `NEXT_PUBLIC_BRAND=demo-academy` so the suite always runs against the
packless reference brand. That is deliberate: `src/lib/labels.test.ts` asserts core
vocabulary stays industry-neutral, which only means something with no packs loaded.

`npm run test:db` pins `NEXT_PUBLIC_BRAND=nirlep-forex` (it needs a brand with a
concurrent-stream limit of 1) and runs with `--test-concurrency=1`.

## Test File Conventions
- Tests live next to the code: `foo.ts` → `foo.test.ts`.
- Database-backed tests use the `.dbtest.ts` suffix so they are excluded from `npm test`
  and can be run serially against a throwaway database.
- Test names read as sentences describing the behaviour, not the function
  (`'releases exactly at the boundary, not a moment after'`).
- Where a test encodes a non-obvious reason, a short comment above it explains why the
  case matters — these are the tests most likely to be deleted by someone who does not
  see the point.

## Database-Backed Tests
`.env.test` points `DATABASE_URL` at `lms_test`, a throwaway database. **Every table
these tests touch is truncated in `before()`.** Never point `DATABASE_URL` in
`.env.test` at a database with data you care about.

Setup for a fresh machine:
```
createdb lms_test
DATABASE_URL="postgresql://<user>@localhost:5432/lms_test?schema=public" npx prisma migrate deploy
```

Use a `.dbtest.ts` only when the behaviour under test lives in query semantics —
`distinct` on a nullable column, unique-constraint conflict handling, cascade behaviour,
transaction ordering. A mocked client would test the mock.

## What Must Be Tested
- **Every authorization decision** needs both an allowed and a denied case. `access.test.ts`
  and `visibility.test.ts` are the models to follow.
- **Every pure decision function** (release, access, visibility, pricing, scheduling
  windows) needs exhaustive coverage of its enum, including a case that asserts it
  handles every variant without throwing.
- **Money maths** needs rounding and boundary cases, including a discount that would
  drive a total below zero.
- **Webhooks** need a forged-signature case and a replay case.
- **Anything with a clock** takes `now` as a parameter and is tested at the boundary
  (exactly at expiry, one second before, one second after).
- **Sandboxes and parsers** need containment tests, not just behaviour tests. The
  expression evaluator has 13 escape attempts covering property access, prototype
  pollution, host globals and module loading.

## Mocks, Fakes, and Fixtures
There is no mocking library and that is intentional. The pattern instead is a pure
function taking its inputs explicitly, with a thin database wrapper around it:

```
decideAccess(input)          pure, exhaustively tested
loadLessonAccess(id, viewer) fetches, delegates to decideAccess
getLessonAccess              React cache() wrapper for server components
```

Clocks are injected as a `now: Date` parameter, never read inside the function.
Fixtures are built inline per test file with small factory helpers (`rule()`, `ctx()`,
`enrollment()`) that take partial overrides.

## Known Flaky Tests
None. `test:db` was non-deterministic until ISSUE-001 was fixed; if flakiness returns
there, check that `--test-concurrency=1` is still in the script.

## Deliberately Not Covered
- Bunny Stream signature acceptance — cannot be verified without a live library
  (ISSUE-004). What is verifiable offline is covered in `signing.test.ts`.
- DRM playback paths (ISSUE-005).
- External notification channel delivery (ISSUE-006) — scheduling and idempotency are
  covered independently of delivery.
- End-to-end browser tests. Route-level verification is currently done with an
  authenticated curl smoke sweep; a Playwright suite is worth adding before launch.
