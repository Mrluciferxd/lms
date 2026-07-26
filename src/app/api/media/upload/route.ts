/**
 * Creates a media asset and returns an upload target.
 *
 * The client uploads directly to the provider using the returned target, so
 * video bytes never pass through this server — that avoids serverless body
 * limits and doubled egress.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { authorizeRequest } from '@/server/auth/rbac'
import { createVideoAsset } from '@/server/media/assets'
import { MediaProviderError } from '@/server/media'

export const dynamic = 'force-dynamic'

const schema = z.object({
  title: z.string().min(1).max(300),
  filename: z.string().max(300).optional(),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024 * 1024).optional(),
  contentType: z.string().max(200).optional(),
})

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeRequest('media:upload')
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? 'Not signed in.' : 'Not permitted.' },
      { status: auth.status },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'A title is required.', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  try {
    const result = await createVideoAsset({
      title: parsed.data.title,
      filename: parsed.data.filename ?? null,
      sizeBytes: parsed.data.sizeBytes ?? null,
      contentType: parsed.data.contentType ?? null,
      uploadedById: auth.user.id,
    })

    return NextResponse.json({
      assetId: result.assetId,
      provider: result.provider,
      upload: {
        url: result.upload.url,
        method: result.upload.method,
        protocol: result.upload.protocol,
        headers: result.upload.headers ?? {},
        fields: result.upload.fields ?? {},
        expiresAt: result.upload.expiresAt.toISOString(),
      },
    })
  } catch (error) {
    if (error instanceof MediaProviderError) {
      // Configuration problems are actionable by the admin reading this, so the
      // message is surfaced rather than swallowed into a generic 500.
      console.error('[media] upload target failed', error)
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    throw error
  }
}
