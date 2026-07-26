/**
 * Local media upload and serving — development only.
 *
 * Stands in for the CDN so the whole video path is runnable without client
 * provider credentials. Both the upload and the playback URL carry the same HMAC
 * token the LOCAL adapter issues, so this route is also the working proof that
 * signed-URL enforcement is wired correctly end to end.
 *
 * Refuses to run in production, where a real provider must serve video.
 */

import { createReadStream } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'

import { ensureLocalStorage, localMediaPath } from '@/server/media/local'
import { unixSeconds, verifyLocalToken } from '@/server/media/signing'

export const dynamic = 'force-dynamic'

/** Generous but bounded, so a stray request cannot exhaust memory. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024

function productionGuard(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available.' }, { status: 404 })
  }
  return null
}

function verify(
  request: Request,
  assetId: string,
  viewerId: string,
): { ok: true } | { ok: false; response: NextResponse } {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  const expires = Number(url.searchParams.get('expires'))
  const secret = process.env.AUTH_SECRET

  if (!secret) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Server misconfigured.' }, { status: 500 }),
    }
  }
  if (!token || !Number.isFinite(expires)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Missing playback token.' }, { status: 401 }),
    }
  }

  const verdict = verifyLocalToken(
    token,
    { secret, assetId, viewerId, expiresAtUnix: expires },
    unixSeconds(new Date()),
  )

  if (!verdict.valid) {
    // Distinguish expiry from forgery: the player retries on expiry but must not
    // retry on a bad signature.
    const status = verdict.reason === 'EXPIRED' ? 410 : 403
    return {
      ok: false,
      response: NextResponse.json({ error: verdict.reason }, { status }),
    }
  }

  return { ok: true }
}

/** Upload. Authorised by a token bound to the asset id, viewer "upload". */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const blocked = productionGuard()
  if (blocked) return blocked

  const { id } = await params

  const verified = verify(request, id, 'upload')
  if (!verified.ok) return verified.response

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large.' }, { status: 413 })
  }

  const body = await request.arrayBuffer()
  if (body.byteLength === 0) {
    return NextResponse.json({ error: 'Empty upload.' }, { status: 400 })
  }
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large.' }, { status: 413 })
  }

  await ensureLocalStorage()
  // localMediaPath rejects anything outside the [A-Za-z0-9_-] alphabet, so the
  // id cannot traverse out of the storage directory.
  await writeFile(localMediaPath(id), Buffer.from(body))

  return NextResponse.json({ ok: true, sizeBytes: body.byteLength })
}

/**
 * Serve. Supports Range so the player can seek — without it, scrubbing a
 * progressive MP4 re-downloads from the start.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const blocked = productionGuard()
  if (blocked) return blocked

  const { id } = await params
  const viewerId = new URL(request.url).searchParams.get('viewer')

  if (!viewerId) {
    return NextResponse.json({ error: 'Missing viewer.' }, { status: 401 })
  }

  const verified = verify(request, id, viewerId)
  if (!verified.ok) return verified.response

  let size: number
  try {
    size = (await stat(localMediaPath(id))).size
  } catch {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const path = localMediaPath(id)
  const range = request.headers.get('range')

  const commonHeaders = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    // Mirrors the production posture: never cached, never offered as a download.
    'Cache-Control': 'no-store, private',
    'Content-Disposition': 'inline',
  }

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (!match) {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      })
    }

    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1

    if (Number.isNaN(start) || start >= size || end < start) {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      })
    }

    const stream = createReadStream(path, { start, end })
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        ...commonHeaders,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      },
    })
  }

  const stream = createReadStream(path)
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: { ...commonHeaders, 'Content-Length': String(size) },
  })
}
