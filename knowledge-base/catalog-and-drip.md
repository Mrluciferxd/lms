# Catalog & Drip Release

## What this subsystem does
Courses, sections and lessons; when each lesson becomes available to each student; and
the single authorization decision that both the UI and the playback API consult.

## How it is structured
| File | Responsibility |
|---|---|
| `src/server/batches/release.ts` | **Pure**: `resolveRelease` for all six `ReleaseMode`s, `describeRelease` |
| `src/server/catalog/access.ts` | **Pure** `decideAccess` + `loadLessonAccess` + cached `getLessonAccess` |
| `src/server/catalog/outline.ts` | Whole-course outline with per-lesson access, in three queries |
| `src/server/catalog/progress.ts` | Lesson progress and the rollup onto `Enrollment.percentComplete` |
| `src/server/catalog/actions.ts` | Admin CRUD for courses, sections, lessons, reorder, manual release |

## Conventions and rules
- **Release is computed, never stored.** See decisions.md. A rescheduled batch re-locks
  content with no backfill.
- **Enrollment is the security boundary; drip is pacing.** `decideAccess` checks publish
  state → staff bypass → preview → authentication → enrollment status → expiry → drip,
  in that order. Ordering matters: an expired enrollment must report expiry, not "not
  released", or the message tells a lapsed student to wait rather than to renew.
- **One decision function, two consumers.** The page and `/api/playback` both call it.
  A page that renders a lock while the API still issues a token is precisely the bug this
  prevents.
- **The outline resolves in-memory.** Calling `loadLessonAccess` per lesson would be
  three queries per lesson — 180 round trips for a 60-lesson course.
- **Locked lessons render no href.** The lesson page also 404s on direct access rather
  than showing a "locked" page, which would confirm the lesson's existence and title.

## The six release modes
| Mode | Anchor | Notes |
|---|---|---|
| `IMMEDIATE` | — | Self-paced |
| `DAYS_AFTER_ENROLLMENT` | `startsAt ?? enrolledAt` | Evergreen drip |
| `DAYS_AFTER_BATCH_START` | `batch.startDate` | Falls back to the enrollment anchor with a warning when the student has no batch |
| `FIXED_DATE` | `releaseAt` | Locked and flagged `MISCONFIGURED` if the date is unset |
| `AFTER_SESSION` | gate session ended | A cancelled gate is flagged, not left pending forever |
| `MANUAL` | `manuallyReleasedAt` | Separate column from `releaseAt` so "scheduled for" and "was released at" never share meaning |

## Known gotchas
- **The batch fallback is deliberate, not a hole.** A student who bought a course
  self-paced while its lessons are configured for cohort pacing would otherwise be
  locked out of content they paid for. Drip is pacing, so falling back preserves intent;
  the enrollment check above it is what actually protects the content. Admin sees a
  warning; students never see configuration problems.
- **`COMPLETED` enrollments retain access.** Finishing a course does not revoke the
  library — time limits go through `expiresAt`.
- **Expiry is checked independently of status**, because the nightly job that flips
  `ACTIVE` to `EXPIRED` may not have run.
- **Progress re-checks access.** A student could otherwise POST progress for a locked
  lesson and, since completion drives certificates and the next-lesson pointer, march
  through a course they cannot open.
- **`watchedSec` is the furthest point reached**, not the latest position — scrubbing
  backwards must not reduce recorded watch time.
- **Deleting a lesson with student progress is refused**, because the cascade would
  destroy watch history irrecoverably.

## How it is tested
`release.test.ts` (27) — every mode, boundaries, the reschedule case, the batch
fallback, cancelled and deleted gates, and that students are never shown a
misconfiguration. `access.test.ts` (26) — publish state, staff bypass per role, preview,
every enrollment status, expiry independent of status, and the ordering rule above.

## Related
[video.md](./video.md) · [batches-and-attendance.md](./batches-and-attendance.md) · [auth.md](./auth.md)
