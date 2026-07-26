# Batches, Live Sessions & Attendance

## What this subsystem does
Cohorts (`Batch`), the sessions that happen within and outside them (`LiveSession`), who
may see each session, and attendance records and reports.

## How it is structured
| File | Responsibility |
|---|---|
| `batches/actions.ts` | Batch CRUD, `generateBatchSessions` from a recurrence |
| `batches/schedule.ts` | **Pure**: `parseSchedule`, `generateOccurrences`, `describeRecurrence` |
| `batches/capacity.ts` | **Pure**: `seatState`, `describeSeats` |
| `batches/roster.ts` | Roster, occupied seats, enrollable students, sibling batches |
| `sessions/visibility.ts` | **Pure** `decideSessionVisibility` + loaders |
| `sessions/timing.ts` | **Pure**: `sessionPhase`, `canJoin`, `attendanceOpen` |
| `sessions/attendance.ts` | Attendance sheet, marking, batch and student reports |
| `sessions/attendance-stats.ts` | **Pure**: `tallyAttendance`, `isBelowThreshold` |
| `enrollments/enroll.ts` | The only path to creating an enrollment |

## Conventions and rules
- **One `LiveSession` model covers classes and broadcasts.** They differ in three
  properties — whether a batch owns them, whether attendance is tracked, and who can see
  them — not in kind. A separate table would have duplicated recordings, reminders and
  calendar integration, and would have been forex-specific.
- **Session vocabulary goes through `liveSessionKindLabel()`.** The forex pack relabels
  `BROADCAST` as "Live Market Session"; coaching relabels it "Live Class". Never
  hardcode either.
- **`streamKey` never reaches the client.** It is excluded from every select that feeds
  a component.
- **Visibility is a pure decision**, mirroring lesson access, with allowed and denied
  cases per role and per `SessionVisibility` mode.
- **Enrollment always goes through `enrollUser()`** — ISSUE-002.

## Known gotchas
- **Moving a student between batches changes their drip anchors.** Lessons on
  `DAYS_AFTER_BATCH_START` re-resolve immediately against the new batch's start date,
  which can lock content the student could previously see. The admin UI says so; keep
  that copy if you touch it.
- **`generateOccurrences` is bounded by `MAX_OCCURRENCES`.** An open-ended weekly
  recurrence would otherwise generate rows forever.
- **`effectiveEnd` assumes a duration when `scheduledEnd` is null** (`ASSUMED_DURATION_MIN`),
  so a session with no end time still transitions out of "live".
- **Joining opens before the scheduled start** (`JOIN_OPENS_MIN_BEFORE`) — students
  arriving early should not see a dead link.
- **Attendance percentages need a denominator decision.** `tallyAttendance` counts
  `EXCUSED` separately from `ABSENT`; check it before reporting a number as "attendance".

## How it is tested
- `schedule.test.ts` — recurrence parsing, occurrence generation, bounds.
- `capacity.test.ts` — seat states including over-capacity.
- `visibility.test.ts` — every visibility mode × role, plus an exhaustiveness case
  asserting no mode throws.
- `timing.test.ts` — phase transitions, join window, attendance window boundaries.
- `attendance-stats.test.ts` — tallies, percentage formatting, threshold.
- `form-datetime.test.ts` — `datetime-local` round-tripping, which is where timezone
  bugs enter admin forms.

## Related
[catalog-and-drip.md](./catalog-and-drip.md) (batch start is a drip anchor) · [notifications.md](./notifications.md) (sessions are reminder anchors)
