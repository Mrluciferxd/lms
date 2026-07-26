/**
 * Bunny Stream status webhook.
 *
 * Bunny does not sign this webhook, so the body is treated strictly as a hint
 * that *something* changed for a video id. The state actually written comes from
 * an authenticated read back to Bunny via `refreshAssetState` — otherwise anyone
 * who could guess a video guid could mark a broken asset READY, or mark a working
 * one ERRORED.
 *
 * Always returns 200 for a well-formed request. A non-2xx makes Bunny retry, and
 * retrying will not fix an unknown asset id.
 */

import { NextResponse } from 'next/server'

import { bunnyStreamAdapter } from '@/server/media/bunny'
import { findAssetByProviderId, refreshAssetState } from '@/server/media/assets'
import { db } from '@/server/db'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text()

  const parsed = await bunnyStreamAdapter.parseWebhook?.({
    rawBody,
    headers: Object.fromEntries(request.headers.entries()),
  })

  if (!parsed) {
    return NextResponse.json({ ok: true, ignored: 'unparseable' })
  }

  // Idempotency + an audit trail of what the provider told us, independent of
  // what we then verified. Bunny sends no event id, so the composite of guid and
  // reported status is the best key available; a repeat of the same transition is
  // a no-op.
  const eventId = `${parsed.providerAssetId}:${parsed.state.status}`
  try {
    await db.webhookEvent.create({
      data: {
        gateway: 'MANUAL',
        eventId,
        type: 'bunny.video.status',
        payload: JSON.parse(rawBody) as never,
      },
    })
  } catch {
    // Unique violation — already handled this transition.
    return NextResponse.json({ ok: true, duplicate: true })
  }

  const asset = await findAssetByProviderId(parsed.providerAssetId)
  if (!asset) {
    return NextResponse.json({ ok: true, ignored: 'unknown asset' })
  }

  try {
    await refreshAssetState(asset.id)
    await db.webhookEvent.updateMany({
      where: { gateway: 'MANUAL', eventId },
      data: { processedAt: new Date() },
    })
  } catch (error) {
    // Record the failure and still return 200: the poller will pick this up, and
    // a retry storm from Bunny helps nobody.
    console.error('[webhook:bunny] refresh failed', error)
    await db.webhookEvent.updateMany({
      where: { gateway: 'MANUAL', eventId },
      data: { error: error instanceof Error ? error.message : 'unknown' },
    })
  }

  return NextResponse.json({ ok: true })
}
