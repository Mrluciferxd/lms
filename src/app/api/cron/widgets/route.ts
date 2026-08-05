/**
 * Widget refresh scheduler entrypoint.
 *
 * GET and POST both run it: Vercel Cron issues a GET with
 * `Authorization: Bearer $CRON_SECRET`, while an external scheduler or an
 * operator checking by hand will POST. Same work either way.
 *
 * The run is idempotent and cheap to overlap: `refreshDueWidgets` skips any
 * widget whose newest snapshot is still fresh, and the in-flight map in
 * refresh.ts collapses a racing manual trigger into one fetch per widget. Run
 * this as often as you like; snapshots carry their own expiry.
 */

import { NextResponse } from 'next/server'

import { authorizeCron } from '@/server/cron/authorize'
import { refreshDueWidgets } from '@/server/widgets/refresh'

/** Never cached, never prerendered: it mutates on every call. */
export const dynamic = 'force-dynamic'

async function handle(request: Request): Promise<NextResponse> {
  const unauthorized = authorizeCron(request)
  if (unauthorized) return unauthorized

  const params = new URL(request.url).searchParams
  const force = params.get('force') === 'true'
  const started = Date.now()

  try {
    const report = await refreshDueWidgets(new Date(), force)

    return NextResponse.json(
      {
        ok: true,
        force,
        durationMs: Date.now() - started,
        ...report,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    // A 500 makes most cron providers retry, which is what we want: the run is
    // idempotent, so a retry costs a duplicate count and nothing else.
    console.error('[cron:widgets] run failed', error)
    return NextResponse.json(
      { error: 'Widget refresh run failed.' },
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
