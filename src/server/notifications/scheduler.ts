/**
 * The scheduler.
 *
 * Evaluates every enabled rule against the anchors in a time window and queues
 * the resulting messages. Rendering happens here, at enqueue time, not at send
 * time: the rendered body is what the student sees in their in-app inbox, and a
 * message that re-renders on delivery would say something different after a
 * retry than the copy already sitting in the inbox.
 *
 * ── IDEMPOTENCY ──────────────────────────────────────────────────────────────
 * This will be run twice. The cron overlaps itself, a deploy restarts a run
 * mid-batch, an operator hits the endpoint by hand to check something. Every row
 * carries a dedupe key that is a pure function of (rule, anchor, recipient,
 * channel), the column is unique, and the insert is `skipDuplicates` — so the
 * second run inserts nothing and reports it, rather than sending a paying
 * student a second WhatsApp message. Insert-and-ignore, the same construction
 * the payment webhooks use, for the same reason.
 */

import { recordAudit } from '@/server/audit'
import { db } from '@/server/db'
import { collectAnchors, enabledTriggers, type CollectedAnchor } from './anchors'
import { availableChannels } from './channels'
import { buildOrgContext, dailySendHour } from './context'
import { dedupeKey } from './dedupe'
import { renderForChannel } from './render'
import {
  DEFAULT_LOOKBACK_MINUTES,
  anchorScanRanges,
  isScheduledTrigger,
  schedulingWindow,
  selectDue,
  type ScheduleRule,
  type SchedulingClock,
} from './schedule'
import { isChannelAllowed, loadPreferences } from './preferences'
import { buildVariables, type TemplateContext } from './variables'
import type { NotificationChannelType } from '@/generated/prisma/enums'

/** Postgres parameter limits make one enormous insert a worse bet than four. */
const INSERT_CHUNK_SIZE = 500

export interface SchedulerReport {
  window: { after: string; until: string }
  timezone: string
  dailySendHour: number
  rulesEvaluated: number
  anchorsCollected: number
  /** Rule × anchor pairs whose fire time landed inside the window. */
  fires: number
  /** Rows the run wanted to write, before dedupe. */
  candidates: number
  created: number
  /** Already queued by an earlier run — the property this design exists for. */
  duplicates: number
  /** Suppressed by a recipient's notification preferences. */
  optedOut: number
  /** Dropped because this deployment has no provider for the channel. */
  unavailableChannel: number
  dryRun: boolean
}

interface PendingRow {
  userId: string
  ruleId: string
  templateId: string
  channel: NotificationChannelType
  subject: string | null
  body: string
  actionUrl: string | null
  scheduledFor: Date
  dedupeKey: string
  payload: { trigger: string; anchorKind: string; anchorId: string; missing?: string[] }
}

export interface RunSchedulerOptions {
  /** Injected for tests; production passes nothing and gets the real clock. */
  now?: Date
  lookbackMinutes?: number
  /** Evaluate and report without writing. Used by the admin "what would fire" view. */
  dryRun?: boolean
}

export async function runScheduler(options: RunSchedulerOptions = {}): Promise<SchedulerReport> {
  const now = options.now ?? new Date()
  const window = schedulingWindow(now, options.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES)
  const org = await buildOrgContext()

  const clock: SchedulingClock = {
    timezone: org.timezone,
    dailySendHour: dailySendHour(),
    ...window,
  }

  const report: SchedulerReport = {
    window: { after: window.after.toISOString(), until: window.until.toISOString() },
    timezone: clock.timezone,
    dailySendHour: clock.dailySendHour,
    rulesEvaluated: 0,
    anchorsCollected: 0,
    fires: 0,
    candidates: 0,
    created: 0,
    duplicates: 0,
    optedOut: 0,
    unavailableChannel: 0,
    dryRun: options.dryRun ?? false,
  }

  const ruleRows = await db.notificationRule.findMany({
    where: { enabled: true },
    select: {
      id: true,
      key: true,
      trigger: true,
      offsetMinutes: true,
      channels: true,
      template: { select: { id: true, subject: true, body: true, channels: true } },
    },
  })

  // CUSTOM belongs to whichever pack declared it and ENROLLMENT_CREATED fires
  // from the enrollment path; neither is ours to evaluate on a clock.
  const scheduled = ruleRows.flatMap((rule) =>
    isScheduledTrigger(rule.trigger) ? [{ ...rule, trigger: rule.trigger }] : [],
  )

  const triggers = await enabledTriggers(new Set(scheduled.map((rule) => rule.trigger)))

  const active = scheduled.filter((rule) => triggers.has(rule.trigger))
  report.rulesEvaluated = active.length
  if (active.length === 0) return report

  const rules: ScheduleRule[] = active.map((rule) => ({
    id: rule.id,
    key: rule.key,
    trigger: rule.trigger,
    offsetMinutes: rule.offsetMinutes,
  }))

  const anchors = await collectAnchors({ ranges: anchorScanRanges(rules, clock), org })
  report.anchorsCollected = anchors.length

  const fires = selectDue<CollectedAnchor>(rules, anchors, clock)
  report.fires = fires.length
  if (fires.length === 0) return report

  const preferences = await loadPreferences(
    fires.flatMap((fire) => fire.anchor.recipients.map((recipient) => recipient.userId)),
  )

  const usable = new Set(availableChannels())
  const templatesByRule = new Map(active.map((rule) => [rule.id, rule.template]))
  const channelsByRule = new Map(active.map((rule) => [rule.id, rule.channels]))

  const rows: PendingRow[] = []

  for (const fire of fires) {
    const template = templatesByRule.get(fire.rule.id)
    if (!template) continue

    /**
     * The rule's channel list wins over the template's. A template declares what
     * it *can* render; the rule declares what this academy actually sends on, and
     * an admin narrowing a rule to email must not be overridden by a pack default.
     */
    const ruleChannels = channelsByRule.get(fire.rule.id) ?? []
    // Deduplicated: a channel listed twice would otherwise produce two rows with
    // one dedupe key, which the insert would silently collapse anyway.
    const channels = [...new Set(ruleChannels.length > 0 ? ruleChannels : template.channels)]

    for (const recipient of fire.anchor.recipients) {
      const context: TemplateContext = {
        ...fire.anchor.context,
        ...recipient.context,
        org,
        student: {
          name: recipient.name,
          email: recipient.email,
          phone: recipient.phone,
        },
      }

      // Rendered against the moment it is scheduled for, so "starts in 15
      // minutes" is true when it arrives rather than when it was queued.
      const variables = buildVariables(context, fire.fireAt)

      for (const channel of channels) {
        report.candidates += 1

        if (!usable.has(channel)) {
          report.unavailableChannel += 1
          continue
        }

        if (
          !isChannelAllowed(fire.rule.trigger, channel, preferences.get(recipient.userId) ?? [])
        ) {
          report.optedOut += 1
          continue
        }

        const rendered = renderForChannel(template, channel, variables)

        rows.push({
          userId: recipient.userId,
          ruleId: fire.rule.id,
          templateId: template.id,
          channel,
          subject: rendered.subject,
          body: rendered.body,
          actionUrl: fire.anchor.actionUrl,
          scheduledFor: fire.fireAt,
          dedupeKey: dedupeKey({
            ruleId: fire.rule.id,
            anchorKind: fire.anchor.kind,
            anchorId: fire.anchor.id,
            userId: recipient.userId,
            channel,
          }),
          payload: {
            trigger: fire.rule.trigger,
            anchorKind: fire.anchor.kind,
            anchorId: fire.anchor.id,
            // Recorded rather than discarded: a template referencing a variable
            // its trigger cannot supply is a content bug, and this is where the
            // evidence lives when someone asks why the message had a hole in it.
            ...(rendered.missing.length > 0 ? { missing: rendered.missing } : {}),
          },
        })
      }
    }
  }

  if (options.dryRun) return report

  for (let index = 0; index < rows.length; index += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + INSERT_CHUNK_SIZE)
    const result = await db.notification.createMany({
      data: chunk.map((row) => ({
        userId: row.userId,
        ruleId: row.ruleId,
        templateId: row.templateId,
        channel: row.channel,
        status: 'QUEUED' as const,
        subject: row.subject,
        body: row.body,
        actionUrl: row.actionUrl,
        scheduledFor: row.scheduledFor,
        dedupeKey: row.dedupeKey,
        payload: row.payload as never,
      })),
      // The whole design in one option: a re-run is a no-op insert.
      skipDuplicates: true,
    })

    report.created += result.count
    report.duplicates += chunk.length - result.count
  }

  if (report.created > 0) {
    await recordAudit({
      action: 'notifications.scheduled',
      entityType: 'Notification',
      meta: {
        created: report.created,
        duplicates: report.duplicates,
        window: report.window,
      },
    })
  }

  return report
}
