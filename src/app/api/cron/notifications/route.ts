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
import { timingSafeEqual } from 'node:crypto'

import { runScheduler } from '@/server/notifications/scheduler'
import { requeueStalledSends, runDeliveryWorker } from '@/server/notifications/worker'
import { MAX_LOOKBACK_MINUTES } from '@/server/notifications/schedule'

/** Never cached, never prerendered: it mutates on every call. */
export const dynamic = 'force-dynamic'

type Phase = 'schedule' | 'deliver' | 'both'

/**
 * Constant-time comparison. A cron endpoint that mutates state is worth
 * protecting from a timing oracle even though the window is narrow — the secret
 * is long-lived and the endpoint is unauthenticated by design.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function presentedSecret(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7)
  return request.headers.get('x-cron-secret')
}

function parsePhase(value: string | null): Phase {
  return value === 'schedule' || value === 'deliver' ? value : 'both'
}

function parseInteger(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : fallback
}

async function handle(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET

  if (!expected) {
    // Refusing is the only safe answer. An unset secret must not degrade into an
    // open endpoint that anyone can use to drain the queue or spam a cohort.
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on this deployment.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const presented = presentedSecret(request)
  if (!presented || !secretMatches(presented, expected)) {
    return NextResponse.json(
      { error: 'Not authorized.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

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
