# Trackers

## What this subsystem does
The generalization of the proposal's "Facilities & Progress List" and
"PC Completion Tracker". A pack declares `trackerDefinitions`; a core editor
renders each one by type. Five types share one client component:

- **COUNTER** — `value = { count }`, progress = `count / config.target`.
- **BOOLEAN** — `value = { on }`.
- **CHECKLIST** — `value = { checked: [ids] }`, ids matched against `config.items`.
- **GAUGE** — simple `value = { value 0..100 }`, OR weighted
  `value = { segments: { key: 0..100 } }` when `config.segments` is non-empty;
  overall = clamp(Σ `value[key] * weight`).
- **EXPIRY** — `value = { active }` plus the `expiresAt` column; status is
  ACTIVE / EXPIRED / INACTIVE decided against the injected clock.

Scope decides whose record a tracker belongs to: STUDENT (per-user), BATCH
(per-batch), or GLOBAL (one org row). The write split:

- `tracker:manage` (ADMIN/OWNER) may update anything — the only path for
  BATCH, GLOBAL and any EXPIRY record.
- A student may update their own STUDENT-scope record for a non-EXPIRY type
  (the "self-log progress" surface).

## How it is structured
| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | `TrackerType`/`TrackerScope` enums, `TrackerDefinition` (config Json, `remindBeforeDays`), `TrackerRecord` (value Json, `expiresAt`, `updatedById`), `@@unique([definitionId, userId, batchId])` |
| `src/server/trackers/validation.ts` | **Pure** `parseTrackerConfig`, `normalizeTrackerUpdate`, `parseRecordValue`, `trackerProgress`, `decideExpiryStatus` — the single source of truth for the five value shapes |
| `src/server/trackers/access.ts` | **Pure** `decideTrackerRead` + `decideCanUpdateRecord`; `loadTrackerViewer` (user row + batch memberships + `tracker:manage`) |
| `src/server/trackers/trackers.ts` | DB reads: `listTrackers`/`loadTracker` (viewer-relevant records), `listAllTrackerDefinitions`/`loadTrackerForAdmin` (full subject universe) |
| `src/server/trackers/actions.ts` | **`'use server'`** `updateTracker` — the only writer. Re-checks `decideCanUpdateRecord` against the live user row on every upsert; one action for all five types via the tagged `TrackerUpdate` union |
| `src/components/trackers/tracker-editor.tsx` | Client component; renders one editor per (definition, record). Per-type form; read-only variant when `canUpdate` is false; `router.refresh()` on success |
| `src/app/app/trackers/page.tsx` | Student index — lists every enabled tracker with a one-line state summary |
| `src/app/app/trackers/[key]/page.tsx` | Student detail — sidebar of trackers + a `TrackerEditor` per relevant record; STUDENT scope synthesizes an empty record so a student can create their first entry |
| `src/app/admin/trackers/page.tsx` | Admin index — every definition (enabled or not), `tracker:manage`-gated |
| `src/app/admin/trackers/[key]/page.tsx` | Admin detail — the full subject universe (GLOBAL one, BATCH every batch, STUDENT every active student) with a create-on-empty editor per subject |
| `src/lib/nav.ts`, `src/lib/labels.ts` | `/app/trackers` nav (order 50, feature `trackers`), `/admin/trackers` nav (order 82, `tracker:manage`); `nav.trackers` label |

## Rules that matter
- **404 over 403.** A disabled tracker `notFound()`s on a direct URL; the admin
  console is the only place disabled definitions appear. `requirePermission`
  is the gate for `/admin/trackers`.
- **Re-check on every write.** The action resolves the type from the definition
  row, not the payload; `decideCanUpdateRecord` runs against the live viewer,
  not the client's `record.canUpdate` hint. A `TrackerUpdate` whose `type` does
  not match the definition's type refuses with "Tracker type mismatch".
- **Stored Json is untrusted.** `parseRecordValue` coerces garbage/old-shape
  rows to safe defaults (count 0, on false, checked [], value 0, segments {}).
  `normalizeTrackerUpdate` clamps gauges to 0..100 and drops unknown checklist
  ids and unknown segment keys rather than rejecting — so a definition edited
  after a record was saved keeps rendering.
- **Composite unique is partial-nullable.** `@@unique([definitionId, userId,
  batchId])` cannot be used as a Prisma `findUnique`/`upsert` key because the
  columns are nullable. The action uses `findFirst` + create/update.
- **Money/time conventions unaffected.** Trackers carry no money; `expiresAt`
  is UTC and rendered via the org timezone helper on the page.

## Pack contributions (declarations)
- `forex` — `forex.challenge-progress` GAUGE STUDENT (weighted prop-firm eval
  gauge with `trading` / `rules` segments).
- `coaching` — `coaching.syllabus-completion` GAUGE STUDENT (target 100, unit %),
  `coaching.tests-attempted` COUNTER STUDENT (target 50, unit tests),
  `coaching.test-series-access` EXPIRY STUDENT (`remindBeforeDays: 7`).

A deployment with `packs: []` (`demo-academy`) has no tracker rows — the pages
render empty states; nothing in `src/server/trackers` or `src/app/*/trackers`
imports a pack.

## Verification — what to run after touching this
```bash
npm run typecheck
npm test                       # 899 unit; trackers contribute +30
NEXT_PUBLIC_BRAND=demo-academy npm run build   # 4 tracker routes built
NEXT_PUBLIC_BRAND=nirlep-forex npm run build   # sequential — prisma generate races
```
