# Journals

## What this subsystem does
A generic structured-record table on top of which any vertical can build its
"repeatedly logged thing" — a forex trade log for one client, a mock test log
for another. A pack contributes a `JournalDefinition` (fields + computed
expressions) the installer writes into the database, and core renders the entry
list, the entry form, the comment thread, and a staff review console against it.
The expression evaluator (`src/server/journals/expression.ts`) computes the
derived columns (R-multiple, P&L, percentile) on read; no computed value is
ever persisted, so editing `entryPrice` immediately re-flows `pnlAmount`.

## How it is structured
| File | Responsibility |
|---|---|
| `src/server/journals/access.ts` | **Pure** `decideJournalVisibility`, `decideCanAuthor`, `decideEntryVisibility`, `decideCanComment` + `loadJournalViewer` |
| `src/server/journals/validation.ts` | **Pure** journal entry / comment / tag validation; **owns the `JournalFieldSchema` type** (mirror of the pack contract) |
| `src/server/journals/expression.ts` | **Pure** hand-written sandbox evaluator (pre-existing; see decisions.md). Used for computed fields |
| `src/server/journals/journals.ts` | DB reads: list / load definitions (viewer + staff), list / load entries (viewer + staff), entry shaping with computed-field evaluation, comments |
| `src/server/journals/actions.ts` | `'use server'` writes: create / update / close / reopen / delete entry, add comment, set definition enabled |
| `src/server/journals/access.test.ts` | Visibility matrix, canAuthor, entry visibility (PRIVATE/INSTRUCTORS/BATCH/PUBLIC), comment eligibility |
| `src/server/journals/validation.test.ts` | Every `JournalFieldType` boundary, length caps, enum bounds, URL safety, unknown field-type guard |
| `src/app/app/journal/[key]/page.tsx` | Student journal list with sidebar + entry composer + entries table |
| `src/app/app/journal/[key]/[entryId]/page.tsx` | Entry detail + comments + lifecycle close/reopen |
| `src/components/journals/entry-composer.tsx` | Client component: per-`JournalFieldType` input rendering + create via `createJournalEntry` |
| `src/components/journals/comment-editor.tsx` | Client component: comment via `addJournalEntryComment` |
| `src/components/journals/lifecycle-buttons.tsx` | Client component: close/reopen via `closeJournalEntry` / `reopenJournalEntry` |
| `src/app/admin/journal/page.tsx` | Staff review console: list all journals, link to per-journal |
| `src/app/admin/journal/[key]/page.tsx` | Staff review: every entry in a journal (reviewer bypasses visibility) |

## Conventions and rules
- **Core owns its own `JournalFieldType` union.** Mirrors `PackJournalField['type']`
  in `src/packs/types.ts`, but core does not import the pack contract — the pack
  writes the JSON, core parses it back as data. A `grep -rn "from '@/packs"`
  src/server/journals` should stay empty; this is the layering rule.
- **Pure decision + thin db wrapper.** The access module decides; the
  DB reads apply the coarse prefilter then run every row through the same
  decision. Same shape as `chat/membership.ts` and `assignments/access.ts`.
- **`enabled` is admin-owned.** `setJournalDefinitionEnabled` only flips the
  flag; the pack installer deliberately does not re-enable a journal the admin
  turned off (see vertical-packs.md). Disabling a definition makes it invisible
  to the list and the visibility check.
- **Visibility starts from the entry's own `visibility` field.** PRIVATE =
  author + reviewer; INSTRUCTORS = author + any staff; BATCH = author + batch
  members + staff; PUBLIC = any signed-in member. Reviewers (
  `journal:review`) bypass — the review console must see private work.
- **Defensive against malformed BATCH.** A BATCH entry with no `batchId` is
  closed to non-reviewer staff. The reviewer bypass still reaches it; that is
  the only path a data bug should not silently widen into a visibility leak.
- **The author cannot grade the self** is the assignment rule; journals do not
  carry a grade. The authoring split lives between `studentAuthored: true` (any
  signed-in member) and `false` (needs `journal:define`) — instructors can log
  on a student's behalf. The student as author sees their own entry; the
  `subjectUser` (when an instructor logs for them) is named separately but does
  not get an independent read path.
- **Computed fields evaluate on read.** `evaluateExpression` is the only path
  — see decisions.md (it is a hand-written sandbox, not `expr-eval`, because the
  library has unfixed RCE advisories and these expressions are admin-authored).
  A throw on a malformed expression is caught and stored as null; a partial
  entry's missing fields null-propagate to null results.
- **Server actions are endpoints.** Every write re-resolves `getCurrentUser`,
  `loadJournalViewer`, the definition, the entry and the relevant decision. A
  stale page (post-enable-flag-off, post-author-removed) cannot get a write in.
- **Delete is destructive, close is not.** A closed entry stays visible under
  its visibility rule and surfaces with a CLOSED badge; the review console sees
  it forever. Delete (author + reviewer) throws away the review history, so the
  default is *close*, not *delete*.

## Field types
`text` · `textarea` · `number` · `currency` · `percent` · `select` ·
`multiselect` · `boolean` · `date` · `datetime` · `image` · `file` · `url`

The entry composer renders one input per type. `image` and `file` are typed as
upload-id text inputs for now — the upload API lives at `/api/media/upload` and
a richer media picker belongs in the resources vault, not journals. The
validator accepts an opaque string id.

## Known gotchas
- **No DB-backed tests yet.** The pure functions are exhaustively covered, but
  `journals.ts` computed-field shaping (`shapeEntry` calling
  `evaluateExpression` for each computed field per row) and `actions.ts` writes
  need a `journals.dbtest.ts` to pin: queue ordering, computed-field null-
  propagation in the buildScope, comment-cascade on entry delete.
- **Computed fields are re-evaluated on every read.** An N-row entry list runs
  `N × |computed|` evaluations; the evaluator is cheap and the sandbox invariants
  are the cost of safety, but a definition with dozens of computed fields and
  thousands of rows would be worth caching.
- **`extraForStaff` in the admin overview page** is a defensive second query
  catching the instructor-only journals `listJournalDefinitions` already
  returns under the viewer rule. Keeping it explicit costs one indexed query;
  if the visibility rule tightens later it stays correct.
- **Comment editor reloads the page on post.** The comment list lives in the
  server component; a `router.refresh()` would be cleaner. Used
  `window.location.reload()` to avoid coupling to the router — same crude but
  safe posture as the rest of the first cut. Improves with realtime.
- **No form validation client-side.** The entry composer is optimistic — server
  actions are the verifier and the surface. A per-field hint would let a
  student retry without round-tripping; the bounds are all exported from
  validation.ts for that.

## How it is tested
- `access.test.ts` — every `Role` × every `JournalVisibility` × the
  author/non-author/batch-member/non-member combinations, the reviewer bypass
  on each visibility, the disabled-journal denial, the canAuthor split, the
  comment eligibility per visibility, and an exhaustiveness case.
- `validation.test.ts` — boundary lengths both sides for `text`, `textarea`,
  `url`; `number` min/max/NaN; `currency` non-negative; `percent` {0, 100}
  bounds; `select`/`multiselect` enum membership; `boolean` required; `date` /
  `datetime` parse; `image`/`file` string-or-undef; the extra-data guard; the
  unknown-type guard; `isJournalEntryValid` shortcut; comment, tags, and
  attachment-id bounds.

## Related
[architecture.md](./architecture.md) · [decisions.md](./decisions.md) (the
expression-evaluator decision) · [vertical-packs.md](./vertical-packs.md)
(packs seed journal definitions) · [chat.md](./chat.md) (same server-action
posture and feature-flag gate)
