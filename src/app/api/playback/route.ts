/**
 * Playback token endpoint.
 *
 * POST   issue a short-TTL signed playback URL for a lesson
 * DELETE release a grant when the player stops
 *
 * All authorization lives in `issuePlayback`; this layer only translates HTTP.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getCurrentUser } from '@/server/auth/rbac'
import { issuePlayback, releasePlayback } from '@/server/media/playback'

/** Never cache a signed token. */
export const dynamic = 'force-dynamic'

const issueSchema = z.object({
  lessonId: z.string().min(1),
  deviceFingerprint: z.string().min(8).max(200),
})

const releaseSchema = z.object({
  grantId: z.string().min(1),
})

/** Best-effort client IP from the usual proxy headers. */
function clientIp(request: Request): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() ?? null
  return request.headers.get('x-real-ip')
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  const parsed = issueSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'lessonId and deviceFingerprint are required.' },
      { status: 400 },
    )
  }

  const result = await issuePlayback({
    lessonId: parsed.data.lessonId,
    viewerId: user?.id ?? null,
    deviceFingerprint: parsed.data.deviceFingerprint,
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code, detail: result.detail },
      {
        status: result.status,
        // A denial must never be cached either — the answer changes as soon as a
        // drip window opens or another device stops streaming.
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  }

  return NextResponse.json(
    {
      grantId: result.grantId,
      url: result.playback.url,
      format: result.playback.format,
      drm: result.playback.drm ?? null,
      thumbnailUrl: result.playback.thumbnailUrl ?? null,
      watermark: result.watermark,
      expiresAt: result.expiresAt.toISOString(),
      renewAfterSec: result.renewAfterSec,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  const parsed = releaseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'grantId is required.' }, { status: 400 })
  }

  // Scoped to the caller inside releasePlayback, so a guessed id is a no-op.
  await releasePlayback(parsed.data.grantId, user.id)

  return new NextResponse(null, { status: 204 })
}
