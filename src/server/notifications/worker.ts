/**
 * Delivery worker.
 *
 * Drains queued notifications through their channel adapters, with bounded
 * retries and exponential backoff. The retry state lives on the row itself:
 * `attempts` counts failures and `scheduledFor` doubles as "not before", which is
 * what the `(status, scheduledFor)` index was put there for. No separate queue,
 * no second store to keep consistent with the first.
 *
 * Claiming is a compare-and-set per row — `updateMany` from QUEUED to SENDING,
 * checking that exactly one row moved. It costs an extra statement per message
 * and buys the property that two workers overlapping (a slow run, a manual
 * trigger during a cron) cannot both send the same message. `updateMany` on the
 * whole batch would be one statement but would not say *which* rows it won.
 *
 * `scheduledFor` carries one meaning per state, which is what lets a single
 * column serve both the queue and the stall sweep: on a QUEUED row it is "not
 * before", and on a SENDING row it is when the worker claimed it. There is no
 * `claimedAt` column to put the latter in — see the note on
 * `requeueStalledSends` for why that matters and what it costs.
 */

import { db } from '@/server/db'
import { resolveChannelAdapter } from './channels'
import { planRetry } from './retry'
import type { DeliveryOutcome, OutboundMessage } from './types'

/** One run's worth. Keeps a cron invocation inside a serverless time limit. */
const DEFAULT_BATCH_SIZE = 100
const MAX_BATCH_SIZE = 500

export interface DeliveryReport {
  claimed: number
  sent: number
  retrying: number
  failed: number
  /** Rows whose channel has no adapter on this deployment. */
  undeliverable: number
  /** Rows another worker had already claimed. */
  contended: number
}

export interface RunDeliveryOptions {
  now?: Date
  limit?: number
}

export async function runDeliveryWorker(
  options: RunDeliveryOptions = {},
): Promise<DeliveryReport> {
  const now = options.now ?? new Date()
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE)

  const report: DeliveryReport = {
    claimed: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    undeliverable: 0,
    contended: 0,
  }

  const due = await db.notification.findMany({
    where: {
      status: 'QUEUED',
      // A null scheduledFor means "as soon as possible"; the scheduler always
      // sets one, but an ad-hoc send need not.
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    // Oldest first: a backlog should drain in the order it was queued, so a
    // delayed class reminder still goes out before tomorrow's fee notice.
    orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: {
      id: true,
      userId: true,
      channel: true,
      subject: true,
      body: true,
      actionUrl: true,
      attempts: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  })

  if (due.length === 0) return report

  for (const notification of due) {
    const claimed = await db.notification.updateMany({
      where: { id: notification.id, status: 'QUEUED' },
      // Stamping the claim time into scheduledFor is what makes the stall sweep
      // safe; without it there is no record of when a SENDING row was picked up.
      data: { status: 'SENDING', scheduledFor: now },
    })

    if (claimed.count !== 1) {
      report.contended += 1
      continue
    }
    report.claimed += 1

    const adapter = resolveChannelAdapter(notification.channel)

    if (!adapter) {
      // The brand stopped declaring a provider after this row was queued. There
      // is nothing to retry into, so record it and move on.
      report.undeliverable += 1
      await db.notification.update({
        where: { id: notification.id },
        data: {
          status: 'FAILED',
          failedAt: now,
          attempts: notification.attempts + 1,
          error: `No adapter for channel ${notification.channel} on this deployment.`,
        },
      })
      continue
    }

    const message: OutboundMessage = {
      notificationId: notification.id,
      channel: notification.channel,
      recipient: {
        userId: notification.user.id,
        name: notification.user.name,
        email: notification.user.email,
        phone: notification.user.phone,
      },
      subject: notification.subject,
      body: notification.body,
      actionUrl: notification.actionUrl,
    }

    let outcome: DeliveryOutcome
    try {
      outcome = await adapter.send(message)
    } catch (error) {
      // An adapter that throws is treated as a transient fault: a provider
      // client raising on a socket error is the common case, and the attempt
      // cap stops a genuinely broken one from retrying forever.
      outcome = {
        ok: false,
        retryable: true,
        error: error instanceof Error ? error.message : 'Adapter threw a non-Error value.',
      }
    }

    const attempts = notification.attempts + 1

    if (outcome.ok) {
      report.sent += 1
      await db.notification.update({
        where: { id: notification.id },
        data: { status: 'SENT', sentAt: now, attempts, error: null },
      })
      continue
    }

    const plan = planRetry({ attempts, retryable: outcome.retryable, now })

    if (plan.retry) {
      report.retrying += 1
      await db.notification.update({
        where: { id: notification.id },
        data: {
          // Back to QUEUED with the next attempt time in scheduledFor, which is
          // the same predicate the claim query already uses.
          status: 'QUEUED',
          scheduledFor: plan.retryAt,
          attempts,
          error: outcome.error,
        },
      })
      continue
    }

    report.failed += 1
    await db.notification.update({
      where: { id: notification.id },
      data: {
        status: 'FAILED',
        failedAt: now,
        attempts,
        // The reason is kept on the row rather than only in a log line: the
        // delivery log is where an operator answers "why did this student not
        // get their reminder", months later.
        error:
          plan.reason === 'PERMANENT'
            ? outcome.error
            : `${outcome.error} (gave up after ${attempts} attempts)`,
      },
    })
  }

  return report
}

/**
 * Rows stuck in SENDING because a worker died between the claim and the result.
 *
 * Without this they sit there forever and a student's reminder is silently lost.
 * With it, a send that did in fact reach the provider before the crash can go
 * out twice — the dedupe key protects against re-*scheduling*, not against a
 * provider call whose outcome was never recorded. The cutoff is therefore long
 * enough that no live send is reclaimed underneath a running worker, and the
 * default is deliberately conservative.
 *
 * This is the one place a dedicated `claimedAt` column would pay for itself: the
 * claim time currently rides in `scheduledFor`, which works but conflates two
 * meanings on one column and loses the queued-versus-sent drift an operator
 * would like to see. Worth adding when the schema next opens.
 */
export async function requeueStalledSends(
  options: { now?: Date; olderThanMinutes?: number } = {},
): Promise<number> {
  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - (options.olderThanMinutes ?? 15) * 60_000)

  const result = await db.notification.updateMany({
    where: { status: 'SENDING', scheduledFor: { lte: cutoff } },
    data: { status: 'QUEUED' },
  })

  return result.count
}
