# Vertical Packs

## What this subsystem does
Lets one codebase serve unrelated industries. A pack contributes record types, external
data feeds, navigation and vocabulary to an otherwise generic core. Two ship today:
`forex` (trading academy) and `coaching` (exam-prep institute).

## How it is structured
| File | Responsibility |
|---|---|
| `src/packs/types.ts` | The `VerticalPack` contract |
| `src/packs/registry.ts` | Static registry; `resolvePacks`, `mergePackLabels`, `collectNavItems`, `collectDataAdapters` |
| `src/packs/shared/rest-feed.ts` | Transport and field-probing shared by data adapters |
| `src/packs/forex/` | Trade journal, economic calendar, trading vocabulary |
| `src/packs/coaching/` | Mock test log, exam calendar, classroom vocabulary |
| `scripts/install-packs.ts` | Validates then writes pack contributions to the database |

## The three generic mechanisms
Everything vertical-specific is expressed through one of these, so core never learns an
industry:

| Mechanism | forex | coaching |
|---|---|---|
| `JournalDefinition` — record type with an admin-defined field schema and computed expressions | trade log: entry/stop/target, R-multiple, P&L | mock test log: marks, accuracy, percentile |
| `TrackerDefinition` — counters, gauges, checklists, expiring flags | funded-challenge gauge | syllabus %, tests attempted, test-series expiry |
| `DataWidgetDefinition` + `DataFeedAdapter` | economic calendar | exam and application dates |

Plus `labels`, which relabel core nouns — the same `liveSession.kind.BROADCAST` key
becomes "Live Market Session" or "Live Class".

## Conventions and rules
- **Core never imports a pack.** Only `src/packs/registry.ts`. CI greps for violations
  and `demo-academy` (`packs: []`) is built as the regression target.
- **Packs are data first, code second.** Journals, trackers, widgets, labels, nav and
  templates are declarative and get written to the database, so an admin can adjust them
  without a release. Only `DataFeedAdapter.fetch` and `onInstall` are executable.
- **A pack adds; it never modifies.** No pack changes a core table or overrides
  behaviour beyond display labels. If a pack seems to need more, the feature belongs in
  core behind a flag — that signal is usually right.
- **Data feeds must degrade, never throw.** An unconfigured or failing feed resolves
  successfully with `unavailable` set and retries hourly. The client owns those
  subscriptions; a lapsed key must render a setup notice, not take down a dashboard we
  are accountable for.
- **The installer validates before it writes.** A bad computed expression or an
  unresolvable adapter key aborts the whole run rather than half-installing a pack.

## Known gotchas
- **Computed field expressions reference raw fields only.** Computed values are not in
  scope for one another — `buildScope` only takes entry data. The installer checks this.
- **Label overrides for keys core does not define silently do nothing.**
  `orphanedPackLabels()` reports them, and the installer warns; a test asserts every
  pack's overrides match a real core key.
- **Two packs claiming the same adapter key is a packaging bug**, and
  `collectDataAdapters` throws rather than letting widget behaviour depend on pack order.
- **`enabled` flags are admin-owned.** Re-running the installer deliberately does not
  switch a journal or rule back on if an admin turned it off.

## Adding a vertical
1. `cp -r src/packs/forex src/packs/<key>` and strip it back.
2. Define journals for what students record repeatedly in that industry.
3. Add label overrides for core nouns that read wrong.
4. Write a `DataFeedAdapter` if it needs external data; declare `requiredEnv`.
5. Register in `ALL_PACKS` in `src/packs/registry.ts`.
6. Enable it in a brand config's `packs` array.
7. Confirm `demo-academy` still builds — that is the core/pack coupling regression test.

## How it is tested
`registry.test.ts` applies integrity checks to **every** registered pack rather than to
forex specifically, so a future vertical inherits them: adapter references resolve,
rule templates exist, journal field schemas are valid, computed expressions parse
against real field keys, list columns exist, and label overrides match core keys. It
also asserts the packs are mutually independent and can be enabled together without key
collisions. `labels.test.ts` asserts core vocabulary contains no industry terms.

## Related
[architecture.md](./architecture.md) · [notifications.md](./notifications.md) · `docs/03-vertical-packs.md`
