# Data Widgets

## What this subsystem does
The generalization of the proposal's "Economic Calendar Dashboard". A pack
registers a `DataFeedAdapter` (executable code) plus a declarative
`DataWidgetDefinition` (name, config, refresh cadence, surfaces). A cron route
calls the adapters off the request path and caches each result as a
`DataWidgetSnapshot`; a standalone page (`/app/widgets/[key]`) renders whatever
snapshot exists. The client owns the feed subscription (see
`docs/03-vertical-packs.md` and the proposal's exclusions), so an unconfigured
or failing feed must render a setup notice, never take down a dashboard.

The same generic page serves the forex economic calendar and the coaching exam
calendar — that is the working proof that core renders a feed without knowing
an industry.
calendar — that is the working proof that core renders a feed without knowing
an industry.

## How it is structured
| File | Responsibility |
|---|---|
| `src/packs/types.ts` | **The contract.** `DataFeedAdapter`, `PackDataWidget`, and the normalized snapshot envelope `DataWidgetSnapshotPayload` / `DataWidgetItem` that core renders |
| `src/packs/shared/rest-feed.ts` | Transport shared by adapters (fetch, field probing, `unavailable` degradation) — pack-side, never imported by core |
| `src/packs/forex/economic-calendar.ts` | Adapter: macro releases → envelope items |
| `src/packs/coaching/exam-calendar.ts` | Adapter: application / admit-card / exam / result dates → envelope items |
| `src/server/widgets/access.ts` | **Pure** `decideWidgetVisibility` + `isStandaloneWidget` + `loadWidgetViewer` |
| `src/server/widgets/widgets.ts` | DB reads: list / load standalone widgets with their latest snapshot; defensive envelope parsing |
| `src/server/widgets/refresh.ts` | The **only** snapshot writer: `refreshWidget` (one widget), `refreshDueWidgets` (cron) |
| `src/server/cron/authorize.ts` | Shared `CRON_SECRET` gate for cron routes (constant-time, 401/503 refusal) |
| `src/app/api/cron/widgets/route.ts` | GET/POST cron entrypoint → `refreshDueWidgets` (supports `?force=true`) |
| `src/app/app/widgets/[key]/page.tsx` | Standalone timeline page with sidebar of all standalone widgets |
| `src/server/widgets/access.test.ts` | Visibility + standalone-surface matrix |
| `src/server/widgets/widgets.test.ts` | Envelope parsing: malformed Json degrades to an empty timeline |

## The snapshot envelope
Adapters own all vendor normalization; core knows exactly one payload shape:

```ts
interface DataWidgetSnapshotPayload {
  items: DataWidgetItem[]        // { id, at, title, badge?, detail?, url? }
  generatedAt: string            // ISO 8601 UTC
  unavailable?: { reason: string }
}
```

`items` are ISO-8601-`at` timeline rows — time localizes to the org timezone,
`badge` renders as an opaque chip ("HIGH", "EXAM", ...), `detail` as a muted
second line, `url` as an external link. Core never probes for `events`, `dates`
or any industry key; if an adapter stopped emitting the envelope, the page
degrades to an empty timeline instead of misreading data.

## Conventions and rules
- **Core never imports a pack.** The widget server layer imports `@/packs/types`
  (the shared contract — same file `DataFeedAdapter` itself lives in) and
  `@/lib/brand` (for the `dataAdapters` map). No `packs/forex` / `packs/coaching`
  import anywhere in `src/server`.
- **Fetching is cron-only.** `refresh.ts` is the sole snapshot writer and it runs
  on the cron route, never in a page render. A slow or flaky vendor costs a cron
  run, not a page load.
- **Adapters degrade, never throw.** Missing env or a failed fetch resolves with
  `unavailable` and a longer `ttlSec`. The worker still catches defensively: a
  throw is recorded in the snapshot's `error` column and retried on the transient
  cadence instead of turning into a retry storm.
- **Snapshots are history, reads take the latest.** Each refresh inserts a new
  `DataWidgetSnapshot` (indexed by `[definitionId, fetchedAt]`); the reader picks
  `findFirst` ordered by `fetchedAt desc`. Retry-forever never happens — every
  snapshot carries `expiresAt` and the worker skips widgets whose newest snapshot
  is still fresh.
- **The payload is untrusted Json.** `parseSnapshotPayload` re-validates every
  row against the envelope on read; a hand-corrupted or future-adapter payload
  renders nothing rather than throwing or emitting attacker-shaped HTML.
- **Standalone is opt-in.** A widget must declare the `standalone` surface to get
  a page; a dashboard-only feed 404s on direct URL access, matching the
  404-over-403 posture. `enabled` is checked too — disabling hides the nav and
  ices the route.
- **Cron concurrency collapses.** An in-flight map per widget id means an
  overlapping cron run or a manual `?force=true` trigger costs one fetch, not
  two (vendor rate limits are the client's money).
- **Credentials travel in env only.** The worker passes `process.env` filtered to
  the adapter's `requiredEnv` — never arbitrary env, never the request.
- **The UI renders a generic timeline.** Today / Tomorrow / full-date day
  headings group items by their org-timezone day; item times use `timeStyle:
  'short'`. Day grouping is timezone-aware, so a midnight release never lands on
  the wrong day.

## How it is tested
`access.test.ts` covers the visibility and standalone-surface decisions.
`widgets.test.ts` corrupts the envelope deliberately — null payload, missing
title/timestamp, bad dates, non-string badges, malformed `unavailable` — and
asserts each degrades to an empty timeline or a sensible fallback. The refresh
worker itself is integration-shaped (it performs a real fetch), so it is covered
by the `.dbtest.ts` follow-up below rather than unit tests.

## Known follow-ups
- A `widgets.dbtest.ts` proving refresh lifecycle against the database (fresh
  snapshot skipped, expired refreshed, throw recorded as `error` with a bounded
  retry cadence) — the worker is currently the one untested query-bearing module.
- An admin console (`/admin/widgets`): the installer already reports adapters
  whose `requiredEnv` is unset; a page with the setup checklist and a
  refresh-now button would close the loop.
- Dashboard surfaces (`student-dashboard`, `admin-dashboard`) render on the app /
  admin dashboards, not just standalone pages.

## Related
[vertical-packs.md](./vertical-packs.md) · [journals.md](./journals.md) ·
`docs/03-vertical-packs.md` · `docs/01-architecture.md`
