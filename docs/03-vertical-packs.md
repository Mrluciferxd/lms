# Vertical packs

A pack is how an industry gets its vocabulary and its domain records onto a
generic LMS. The contract is [`src/packs/types.ts`](../src/packs/types.ts); the
worked example is [`src/packs/forex/`](../src/packs/forex/).

## Design rules

**Packs are data first, code second.** Journals, trackers, widgets, labels,
navigation and notification templates are all declarative — the installer writes
them into the database. Only two things in a pack are executable: a
`DataFeedAdapter`'s `fetch`, and the optional `onInstall` hook. Everything a pack
declares is therefore admin-editable afterwards, which means a client can adjust
their trade-journal fields without waiting on a release.

**Core never imports a pack.** Core reads pack output through
[`src/packs/registry.ts`](../src/packs/registry.ts) only. The `demo-academy`
brand runs with `packs: []` specifically so that a hidden dependency fails there.

**A pack adds; it does not modify.** No pack changes a core table, alters a
migration or overrides core behaviour beyond display labels. If a pack seems to
need more than the contract allows, the feature belongs in core with a
configuration switch — that is the signal, and it is usually right.

## What a pack can contribute

| Field | Purpose |
|---|---|
| `labels` | Override core UI strings. `liveSession.kind.BROADCAST` → "Live Market Session". Unknown keys are ignored, so a core rename degrades to the default rather than crashing. |
| `journals` | Structured record types with field schemas and computed fields. |
| `trackers` | Counters, checklists, gauges, expiring flags. |
| `dataAdapters` | Fetch implementations for external feeds. |
| `dataWidgets` | Dashboard widgets bound to an adapter. |
| `navItems` | Navigation entries, role-filtered and ordered. |
| `notificationTemplates` / `notificationRules` | Vertical-specific messaging. |
| `onInstall` | Seeding that the declarative fields cannot express — chat channels, starter pages. |

## Computed fields and the expression evaluator

Computed fields are expressions over an entry's own field values, evaluated
server-side:

```ts
computed: [
  { key: 'rMultiple', label: 'R multiple',
    expr: '(exitPrice - entryPrice) / (entryPrice - stopLoss)' },
  { key: 'pnlAmount', label: 'P&L', type: 'currency',
    expr: '(exitPrice - entryPrice) * lotSize * contractSize * (direction == "LONG" ? 1 : -1)' },
]
```

The evaluator is
[`src/server/journals/expression.ts`](../src/server/journals/expression.ts) — a
purpose-built recursive-descent parser, not a library.

**Why hand-written.** These expressions are admin-authored and stored in the
database, which makes the evaluator a trust boundary. The obvious dependency,
`expr-eval`, carries two unfixed high-severity advisories against every published
version — GHSA-8gw3-rxh4-v6jx (prototype pollution) and GHSA-jc85-fpwf-qm7x
(arbitrary code execution through unrestricted function references) — with no fix
available. Its purpose is expressiveness; ours is containment.

The grammar we need is small enough that containment is structural:

- No `.` or `[]` in the grammar, so `__proto__`, `constructor` and `prototype`
  are unreachable rather than denylisted.
- Callables exist only as a fixed name→implementation table consulted at call
  sites; an identifier can never resolve to a function.
- Identifiers resolve solely from the entry's own data via `Object.hasOwn` against
  a null-prototype scope, so inherited properties are invisible.
- No assignment, no `new`, no globals, bounded length and recursion depth.

Supported: `+ - * / %`, comparisons, `&& || !`, ternary, parentheses, and
`abs floor ceil round sqrt min max`.

**Null semantics matter here.** Partially-filled entries are the normal case — an
open position has no exit price. Any arithmetic touching an absent value yields
null, as does division by zero, so the UI shows an em dash instead of `NaN` or
`Infinity`. Equality still works against absent values (`direction == "LONG"` is
`false`, not null) so ternaries behave sensibly.

`validateExpression()` runs when a definition is saved and reports syntax errors
and unknown field references. Without it, a typo like `entryPirce` would evaluate
to null forever and look like a data problem rather than a config problem.

Behaviour is covered by 35 tests in
[`expression.test.ts`](../src/server/journals/expression.test.ts), including the
sandbox-escape cases above. Run with `npm test`.

## Building a new pack

1. `cp -r src/packs/forex src/packs/<key>` and strip it back.
2. Define journals for the records that vertical keeps. Ask what a student
   *records repeatedly* — trades, workouts, patient notes, practice sessions.
3. Add label overrides for core nouns that read wrong in the industry.
4. If it needs external data, write a `DataFeedAdapter`. Declare `requiredEnv`
   and **always degrade gracefully** when unset: return a payload with
   `unavailable` set, never throw. Third-party subscriptions are the client's
   cost and may lapse; that must not break a dashboard we are accountable for.
5. Register it in the `ALL_PACKS` array in `src/packs/registry.ts`.
6. Enable it in a brand config's `packs` array.
7. Verify `demo-academy` still builds and behaves — that is the regression test
   for core/pack coupling.

## Shared adapter plumbing

[`src/packs/shared/rest-feed.ts`](../src/packs/shared/rest-feed.ts) carries the
transport, error mapping and field-probing that every REST-backed data adapter
needs. Each pack keeps only its own payload shape and normalization.

This is why the second vertical's adapter is roughly a third the length of the
first's, and it is what makes "adding a vertical is cheap" true in practice rather
than only on a diagram. Two invariants it enforces:

- Credentials travel in headers, never query strings.
- A missing key or a failing upstream resolves *successfully* with `unavailable`
  set, and retries hourly rather than every tick. Auth failures (401/403) get the
  long backoff too, since a fast retry cannot fix a wrong key.

## The two shipped packs

### `forex` — trading academy

| Contribution | Detail |
|---|---|
| Labels | `BROADCAST` → "Live Market Session"; course levels → Foundation / Intermediate / Advanced-Funded |
| Journal | `trade` — 20 fields, 4 computed (planned R:R, R-multiple, P&L, price move), open/closed lifecycle |
| Tracker | `forex.challenge-progress` — weighted gauge for prop-firm evaluations |
| Adapter | `forex.economic-calendar` — provider-agnostic REST |
| Nav | Live Market, Trade Journal, Economic Calendar |
| Notifications | Session starting (−15 min), recording ready |
| `onInstall` | `#market-talk`, `#trade-reviews` |

### `coaching` — exam-prep institute

| Contribution | Detail |
|---|---|
| Labels | `BROADCAST` → "Live Class"; `DOUBT_CLEARING` → "Doubt Session"; levels → Foundation / Target / Crash Course |
| Journal | `mock-test` — 18 fields, 6 computed (score %, accuracy, attempt rate, negative marks, marks/min, percentile), no lifecycle |
| Trackers | syllabus completion (gauge), tests attempted (counter), test-series access (expiry, 7-day reminder) |
| Adapter | `coaching.exam-calendar` — application windows, admit cards, exam and result dates |
| Nav | Live Classes, Mock Tests, Exam Calendar |
| Notifications | Class reminder (−30 min), result published |
| `onInstall` | `#doubts`, `#study-group` |

The pair is the working proof of the architecture. They override the *same* core
label key with different words, define journals with no overlapping fields, and
neither imports the other. Enabling both together is tested for key collisions.

Both calendar adapters are written against a configurable base URL and probe the
field names common providers use, rather than binding to one vendor — these
subscriptions are the client's cost, so vendor choice is theirs to change without
waiting on a release from us.
