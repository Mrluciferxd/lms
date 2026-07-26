# Notifications

## What this subsystem does
Turns scheduled facts (a class starting, a fee falling due, a lesson unlocking) into
messages on the right channel at the right local time, exactly once.

## How it is structured
| File | Responsibility |
|---|---|
| `schedule.ts` | **Pure**: `schedulingWindow`, `resolveFireAt`, `isDue`, `selectDue` with an injected `SchedulingClock` |
| `anchors.ts` | Collects the anchor rows (sessions, installments, enrollments) a rule fires against |
| `time.ts` | **Pure**: `localDayKey`, `localTimeToUtc`, `localDayDiff` — org-timezone arithmetic |
| `dedupe.ts` | **Pure**: deterministic `dedupeKey` |
| `variables.ts` | Typed template context; `sanitizeValue`, `sanitizeUrl` |
| `render.ts` | `renderForChannel` — per-channel rendering, `unknownVariables` |
| `preferences.ts` | Opt-outs, `MANDATORY_TRIGGERS` |
| `retry.ts` | **Pure**: `backoffMs`, `planRetry`, `MAX_ATTEMPTS` |
| `scheduler.ts` | `runScheduler` — evaluates rules, queues notifications |
| `worker.ts` | `runDeliveryWorker`, `requeueStalledSends` |
| `channels/` | `ChannelAdapter` implementations: `in-app.ts` (real), `log.ts` (stand-in) |
| `inbox.ts` | Student-facing list and unread count |

## Conventions and rules
- **Idempotency is the whole game.** The scheduler will re-run, overlap and retry. Every
  notification carries a deterministic `dedupeKey` (rule + anchor + user) and
  `Notification.dedupeKey` is unique, so a second insert is a no-op rather than a second
  WhatsApp message to a paying student.
- **Scheduling is pure and clock-injected.** `schedulingWindow` decides which rules fire
  for which anchors at time T, given a lookback. It never reads the clock itself, which
  is why the whole matrix is testable.
- **A lookback window, not an instant.** `DEFAULT_LOOKBACK_MINUTES` covers the case where
  cron was late or a run was missed; dedupe makes the overlap safe.
- **Local time means local.** A 9am reminder means 9am in `OrgSettings.timezone`. Use
  `localTimeToUtc` / `localDayKey` — never construct the instant in UTC.
- **Templates and rules come from packs.** The forex and coaching packs each ship their
  own; the installer writes them and deliberately does not overwrite an admin's
  `enabled` flag on reinstall.

## Known gotchas
- **Fee reminders are in `MANDATORY_TRIGGERS`.** A student can mute most categories, but
  not the reminder about money they owe — the person who owes the fee should not be able
  to switch off the reminder.
- **Only in-app delivery is real** — ISSUE-006. Email, SMS, WhatsApp and push are
  implemented against `ChannelAdapter` with a logging stand-in, because no provider SDK
  is installed. The delivery log shows what each would have sent. Adding a real provider
  changes only the adapter.
- **The cron endpoint requires `CRON_SECRET`** and returns 401 without it (verified).
- **`sanitizeUrl` exists because templates interpolate links.** Do not bypass it.

## How it is tested
- `schedule.test.ts` — the window matrix: due, not due, boundary, lookback, every
  scheduled trigger, precision handling.
- `time.test.ts` coverage lives inside `schedule.test.ts` fixtures — day keys and local
  conversions across a timezone that shifts the calendar day.
- `dedupe.test.ts` — key determinism and distinctness across rule/anchor/user.
- `render.test.ts`, `variables.test.ts` — per-channel rendering, sanitisation, unknown
  variable reporting.
- `preferences.test.ts` — opt-out honoured, mandatory triggers not mutable.
- `retry.test.ts` — backoff growth and the attempt cap.
- `scheduler.dbtest.ts` — **runs the same evaluation twice and asserts one row**, which
  is the property the whole design exists to guarantee.

## Related
[payments.md](./payments.md) (fee anchors) · [batches-and-attendance.md](./batches-and-attendance.md) (session anchors) · [vertical-packs.md](./vertical-packs.md)
