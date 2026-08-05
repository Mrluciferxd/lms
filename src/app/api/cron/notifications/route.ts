/**
 * Notification scheduler entrypoint.
 *
 * GET and POST both run it: Vercel Cron issues a GET with
 * `Authorization: Bearer $CRON_SECRET`, while an external scheduler or an
 * operator checking something by hand will POST. Same work either way.
 *
 * Running it more often than necessary is safe and is the intended operating
 * mode — every message carries a deterministic dedupe key and the insert is
 * `skipDuplicates`, so an overlapping run reports duplicates rather than sending
 * anything twice. A five-minute cron against the default sixty-minute lookback
 * means eleven consecutive runs can fail before a single reminder is missed.
 */

import { NextResponse } from 'next/server'

import { authorizeCron } from '@/server/cron/authorize'
import { runScheduler } from '@/server/notifications/scheduler'
import { requeueStalledSends, runDeliveryWorker } from '@/server/notifications/worker'
import { MAX_LOOKBACK_MINUTES } from '@/server/notifications/schedule'

/** Never cached, never prerendered: it mutates on every call. */
export const dynamic = 'force-dynamic'

type Phase = 'schedule' | 'deliver' | 'both'

function parsePhase(value: string | null): Phase {
  return value === 'schedule' || value === 'deliver' ? value : 'both'
}

function parseInteger(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : fallback
}

async function handle(request: Request): Promise<NextResponse> {
  const unauthorized = authorizeCron(request)
  if (unauthorized) return unauthorized

  const params = new URL(request.url).searchParams
  const phase = parsePhase(params.get('phase'))
  const dryRun = params.get('dryRun') === 'true'

  const started = Date.now()

  try {
    const scheduled =
      phase === 'deliver'
        ? null
        : await runScheduler({
            lookbackMinutes: parseInteger(params.get('lookbackMinutes'), 60),
            dryRun,
          })

    // Recovered before the drain so a message a dead worker abandoned goes out in
    // this run rather than the next one.
    const requeued = phase === 'schedule' || dryRun ? 0 : await requeueStalledSends()

    const delivered =
      phase === 'schedule' || dryRun
        ? null
        : await runDeliveryWorker({ limit: parseInteger(params.get('limit'), 100) })

    return NextResponse.json(
      {
        ok: true,
        phase,
        durationMs: Date.now() - started,
        maxLookbackMinutes: MAX_LOOKBACK_MINUTES,
        requeued,
        scheduled,
        delivered,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    // A 500 makes most cron providers retry, which is what we want: the run is
    // idempotent, so a retry costs a duplicate-count and nothing else.
    console.error('[cron:notifications] run failed', error)
    return NextResponse.json(
      { error: 'Notification run failed.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request)
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request)
}
