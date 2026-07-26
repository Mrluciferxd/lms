# Data model

Schema: [`prisma/schema.prisma`](../prisma/schema.prisma). Validated against
Prisma 7.9. This document covers the reasoning, not the field lists — read the
schema for those; its comments carry the per-field detail.

## Domains

| Domain | Models |
|---|---|
| Org | `OrgSettings` (singleton) |
| Identity | `User`, `Account`, `Session`, `VerificationToken`, `Device`, `AuditLog` |
| Catalog | `Course`, `Section`, `Lesson` |
| Cohorts | `Batch`, `Enrollment` |
| Delivery | `LiveSession`, `Attendance`, `LessonProgress` |
| Media | `MediaAsset`, `PlaybackGrant` |
| Coursework | `Assignment`, `Submission`, `Resource` |
| Notifications | `NotificationTemplate`, `NotificationRule`, `Notification`, `NotificationPreference` |
| Calendar | `CalendarEvent` |
| Payments | `Order`, `OrderItem`, `Payment`, `Coupon`, `Invoice`, `FeeSchedule`, `FeeInstallment`, `WebhookEvent` |
| Community | `Channel`, `ChannelMember`, `Message`, `MessageReaction` |
| Generic verticals | `JournalDefinition`, `JournalEntry`, `JournalEntryComment`, `TrackerDefinition`, `TrackerRecord`, `DataWidgetDefinition`, `DataWidgetSnapshot` |
| Assessments (phase 2) | `Quiz`, `Question`, `QuizAttempt`, `QuizAnswer` |
| Certificates (phase 2) | `CertificateTemplate`, `Certificate` |
| Marketing | `Page`, `Lead` |

Phase-2 models ship in the initial migration on purpose. Adding tables later is
easy; the reason to define them now is that it forces the relationships to be
right while the schema is still cheap to change.

## Decisions worth explaining

### `Section`, not `Module`

Course chapters are `Section`. "Module" is reserved for application feature
modules — the proposal itself uses "module" that way ("Operational & Automation
Feature Matrix"), and having both meanings in one codebase guarantees confusion
in every conversation and variable name thereafter.

### One `LiveSession` for classes and broadcasts

The proposal treats batch classes and "Live Market Sessions" as separate
features. They differ in three properties, not in kind: whether a batch owns
them, whether attendance is tracked, and who can see them. So there is one table
with `kind`, `tracksAttendance` and `visibility`.

A separate `MarketSession` table would have duplicated recordings, reminders,
attendance and calendar integration — and would have been forex-specific, forcing
the next vertical to duplicate it again.

### Drip release is resolved, not stored

`Lesson` carries a `releaseMode` and one of `releaseOffsetDays` /
`releaseAt` / `releaseAfterSessionId`. There is no per-student unlock table.

Availability is computed at read time from the lesson's rule plus the student's
enrollment and batch. This is the right call because batch start dates move — a
class gets rescheduled, a cohort slips a week — and a materialized unlock table
would need backfilling on every such edit, with a stale-row bug for every one you
miss. Computing it means the rule is the only truth.

`ReleaseMode` covers all four cases the proposal implies plus `MANUAL`:

- `IMMEDIATE` — self-paced content
- `DAYS_AFTER_ENROLLMENT` — evergreen drip, per student
- `DAYS_AFTER_BATCH_START` — the proposal's "in accordance with the student's assigned Class/Batch Schedule"
- `FIXED_DATE` — a launch or exam date
- `AFTER_SESSION` — unlocks once a specific live class has happened
- `MANUAL` — instructor releases it by hand

### Enrollment is the access record

`Enrollment` is the join between a student, a course and optionally a batch, and
it is what every access check consults. `batchId` is nullable so the same course
can be sold both cohort-based and self-paced.

`percentComplete` and `lastActivityAt` are denormalized onto it, recomputed on
lesson completion. Progress appears on every dashboard, roster and reminder
query; recomputing it by aggregating `LessonProgress` each time is the query that
degrades first as a cohort grows.

The unique constraint is `(userId, courseId, batchId)` — a student can legitimately
re-enroll in a later batch of the same course, which is common for students who
repeat a cohort.

### Fee installments are first-class

The proposal asks for "Fees Reminders: automated notifications tracking pending
dues", which only means something if the system knows what is owed and when. So
`FeeSchedule` hangs off an enrollment and owns dated `FeeInstallment` rows.

This is separate from `Order` deliberately: an order is a payment attempt, a
schedule is an obligation. One installment may take several order attempts, and a
schedule exists whether or not anything has been paid. The `FEE_DUE` and
`FEE_OVERDUE` notification triggers read installments, not orders.

### Notifications: template, rule, instance

Three models, because they change on different clocks:

- `NotificationTemplate` — the wording. Edited often, by non-developers.
- `NotificationRule` — when and to whom. Edited occasionally, by admins.
- `Notification` — one queued or delivered message. Written constantly.

`Notification.dedupeKey` is unique. The scheduler is expected to re-run and
overlap — a cron that fires twice, a deploy mid-run, a retry after a timeout —
and a deterministic key (`rule:<id>:session:<id>:user:<id>`) makes a double send
a no-op insert instead of a duplicate WhatsApp message to a paying student.

`NotificationPreference` with a nullable `trigger` lets a student mute one
category on one channel, or a whole channel. Fee reminders should generally not
be mutable by the person who owes the fee; that is enforced in policy, not schema.

### Media protection lives on the asset

`MediaAsset` carries `drmEnabled`, `watermarkEnabled`, `downloadable` and
`maxConcurrentStreams` per asset, defaulting from brand config. Lecture videos
and worksheets have opposite requirements and both are `MediaAsset` rows — a
worksheet the student is meant to print must be downloadable while the lecture it
accompanies must not be.

`PlaybackGrant` records every issued playback token. It enforces concurrent-stream
limits and, when a recording leaks, maps the watermark back to the account,
device, IP and minute that requested it. See `docs/06-video-security.md`.

### The three generic vertical mechanisms

This is where the industry-agnostic claim is actually cashed out.

**`JournalDefinition` / `JournalEntry`** — a record type defined as data.
`fieldSchema` is an array of field definitions (see `PackJournalField` in
[`src/packs/types.ts`](../src/packs/types.ts)); `JournalEntry.data` is a JSON
object validated against it on write. `computedFields` holds expressions
evaluated server-side by
[`src/server/journals/expression.ts`](../src/server/journals/expression.ts).

The forex pack seeds a `trade` definition with entry/stop/target/lot fields and
R-multiple and P&L expressions. A fitness academy would seed `workout` with
sets/reps/load. Same tables, same UI, same API.

`subjectUserId` is separate from `authorId` so an instructor can log an entry on
a student's behalf without the record appearing to be the instructor's own —
which is how mentor-led review actually works in practice.

**`TrackerDefinition` / `TrackerRecord`** — named counters, checklists, gauges and
expiring flags. This absorbs the proposal's "PC Completion Tracker" (a `COUNTER`
scoped to a student) and its "Facilities & Progress List ... with custom expiring
reminders" (an `EXPIRY` with `remindBeforeDays`) without either concept appearing
in the schema by name. Both are core, not forex: every vertical counts something
per student and expires some entitlement.

**`DataWidgetDefinition` / `DataWidgetSnapshot`** — external data behind a cache.
A pack registers a `DataFeedAdapter`; the platform schedules refreshes and stores
snapshots. Widgets read the snapshot, never the upstream API, so a rate limit or
outage at a vendor the *client* pays for cannot take down the dashboard we are
responsible for.

## Indexing

Indexes target the queries the product actually runs, not every foreign key:

- Rosters and progress: `Enrollment(courseId, status)`, `(batchId, status)`, `(userId, status)`
- Timetables: `LiveSession(batchId, scheduledStart)`, `(kind, status, scheduledStart)`
- The scheduler's hot path: `Notification(status, scheduledFor)`
- Collections: `Attendance(userId, markedAt)`, `LessonProgress(lessonId, status)`
- Chat pagination: `Message(channelId, createdAt)`
- Dues: `FeeInstallment(status, dueDate)`
- Reconciliation: `Order(gatewayOrderId)`, `Payment(gatewayPaymentId)` unique

Add indexes from observed slow queries after launch, not from speculation.

## Migration policy

- Migrations are additive. No destructive change reaches a client database
  without an explicit, reviewed, backed-up step.
- `prisma migrate dev` locally; `prisma migrate deploy` in CI.
- Because every client has their own database, a migration ships N times. The
  deployment checklist in `docs/04-white-label.md` covers the ordering.
- Never edit a migration that has been applied anywhere. Write a new one.
