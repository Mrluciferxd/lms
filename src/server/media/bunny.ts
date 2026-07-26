/**
 * Bunny Stream provider.
 *
 * Chosen for Nirlep because it supports DRM (MediaCage), CDN token
 * authentication and per-viewer watermarking at egress pricing that works for an
 * India-based audience. `MediaProvider` plus this interface exist so switching to
 * Mux or Cloudflare Stream is one file, not a rewrite.
 *
 * NOT YET VERIFIED AGAINST A LIVE LIBRARY. Bunny credentials are a
 * client-provisioned dependency (docs/04-white-label.md), so the HTTP shapes and
 * signature composition here are written from Bunny's documentation and unit
 * tested only for the properties testable offline — see signing.test.ts. Validate
 * against a real library as the first task of video integration; a wrong
 * signature fails closed (every playback 403s), so it surfaces immediately rather
 * than subtly.
 */

import {
  MediaProviderError,
  type RemoteAssetState,
  type SignPlaybackInput,
  type SignedPlayback,
  type UploadTarget,
  type VideoProviderAdapter,
  type WebhookOutcome,
  type WebhookRequest,
} from './types'
import { buildBunnyUrl, signBunnyToken, signBunnyUploadSignature, unixSeconds } from './signing'
import type { MediaStatus } from '@/generated/prisma/enums'

const API_BASE = 'https://video.bunnycdn.com'
const TUS_ENDPOINT = 'https://video.bunnycdn.com/tusupload'

/** How long a client has to complete an upload. */
const UPLOAD_WINDOW_SEC = 4 * 60 * 60

interface BunnyConfig {
  libraryId: string
  apiKey: string
  tokenAuthKey: string
  cdnHostname: string
}

function readConfig(): BunnyConfig {
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID
  const apiKey = process.env.BUNNY_STREAM_API_KEY
  const tokenAuthKey = process.env.BUNNY_STREAM_TOKEN_AUTH_KEY
  const cdnHostname = process.env.BUNNY_STREAM_CDN_HOSTNAME

  if (!libraryId || !apiKey || !tokenAuthKey || !cdnHostname) {
    throw new MediaProviderError(
      'Bunny Stream is not configured. Set BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY, BUNNY_STREAM_TOKEN_AUTH_KEY and BUNNY_STREAM_CDN_HOSTNAME.',
    )
  }

  return { libraryId, apiKey, tokenAuthKey, cdnHostname }
}

/**
 * Bunny's numeric video status. 4 is the only state that can play; 5 and 6 are
 * terminal failures. Anything below 4 is still in the pipeline.
 */
function mapStatus(raw: unknown): MediaStatus {
  const code = typeof raw === 'number' ? raw : Number(raw)
  switch (code) {
    case 0: // Created — record exists, no bytes yet
      return 'UPLOADING'
    case 1: // Uploaded
    case 2: // Processing
    case 3: // Transcoding
      return 'PROCESSING'
    case 4: // Finished
      return 'READY'
    case 5: // Error
    case 6: // UploadFailed
      return 'ERRORED'
    default:
      return 'PROCESSING'
  }
}

async function bunnyRequest(
  config: BunnyConfig,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        AccessKey: config.apiKey,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch (error) {
    throw new MediaProviderError(`Bunny request to ${path} failed`, error)
  }

  if (!response.ok) {
    throw new MediaProviderError(
      `Bunny responded ${response.status} ${response.statusText} for ${path}`,
    )
  }

  // DELETE returns an empty body.
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

export const bunnyStreamAdapter: VideoProviderAdapter = {
  key: 'BUNNY_STREAM',
  name: 'Bunny Stream',
  requiredEnv: [
    'BUNNY_STREAM_LIBRARY_ID',
    'BUNNY_STREAM_API_KEY',
    'BUNNY_STREAM_TOKEN_AUTH_KEY',
    'BUNNY_STREAM_CDN_HOSTNAME',
  ],
  supportsDrm: true,
  supportsServerWatermark: true,

  async createUploadTarget({ title, filename }) {
    const config = readConfig()

    // Two steps: create the record to get a guid, then sign an upload scoped to
    // that guid. The signature is what lets the browser upload without ever
    // holding the library API key.
    const created = await bunnyRequest(config, `/library/${config.libraryId}/videos`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    })

    const guid =
      typeof created === 'object' && created !== null
        ? (created as Record<string, unknown>).guid
        : null

    if (typeof guid !== 'string' || guid === '') {
      throw new MediaProviderError('Bunny did not return a video guid on create.')
    }

    const expiresAtUnix = unixSeconds(new Date()) + UPLOAD_WINDOW_SEC
    const signature = signBunnyUploadSignature({
      libraryId: config.libraryId,
      apiKey: config.apiKey,
      videoId: guid,
      expiresAtUnix,
    })

    return {
      url: TUS_ENDPOINT,
      method: 'POST',
      protocol: 'tus',
      headers: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expiresAtUnix),
        VideoId: guid,
        LibraryId: config.libraryId,
        ...(filename ? { Filename: filename } : {}),
      },
      providerAssetId: guid,
      playbackId: guid,
      expiresAt: new Date(expiresAtUnix * 1000),
    } satisfies UploadTarget
  },

  async signPlayback({ asset, ttlSec, ip }: SignPlaybackInput): Promise<SignedPlayback> {
    const config = readConfig()
    const videoId = asset.playbackId ?? asset.providerAssetId

    if (!videoId) {
      throw new MediaProviderError(`Asset ${asset.id} has no Bunny video id.`)
    }

    const expiresAtUnix = unixSeconds(new Date()) + ttlSec

    // Sign the directory, not the manifest file: HLS segments are fetched as
    // siblings of the manifest, and a file-scoped token would reject every one
    // of them.
    const token = signBunnyToken({
      securityKey: config.tokenAuthKey,
      tokenPath: `/${videoId}/`,
      expiresAtUnix,
      ip,
    })

    // DRM playback uses a distinct manifest; the CDN token still applies.
    const manifest = asset.drmEnabled ? 'playlist.drm' : 'playlist.m3u8'
    const url = buildBunnyUrl(config.cdnHostname, `/${videoId}/${manifest}`, token)

    return {
      url,
      format: 'hls',
      expiresAt: new Date(expiresAtUnix * 1000),
      drm: asset.drmEnabled
        ? {
            widevineLicenseUrl: `${API_BASE}/DrmLicense/${config.libraryId}/widevine`,
            fairplayLicenseUrl: `${API_BASE}/DrmLicense/${config.libraryId}/fairplay`,
            fairplayCertificateUrl: `${API_BASE}/DrmCertificate/${config.libraryId}/fairplay`,
          }
        : undefined,
      thumbnailUrl: `https://${config.cdnHostname.replace(/^https?:\/\//, '')}/${videoId}/thumbnail.jpg`,
    }
  },

  async getAssetState(providerAssetId): Promise<RemoteAssetState> {
    const config = readConfig()
    const video = await bunnyRequest(
      config,
      `/library/${config.libraryId}/videos/${providerAssetId}`,
    )

    if (typeof video !== 'object' || video === null) {
      throw new MediaProviderError(`Bunny returned no video for ${providerAssetId}.`)
    }

    const row = video as Record<string, unknown>
    const status = mapStatus(row.status)

    return {
      status,
      // Bunny reports length in seconds and 0 while still transcoding.
      durationSec: typeof row.length === 'number' && row.length > 0 ? row.length : null,
      sizeBytes: typeof row.storageSize === 'number' ? row.storageSize : null,
      thumbnailUrl:
        typeof row.thumbnailFileName === 'string'
          ? `https://${config.cdnHostname.replace(/^https?:\/\//, '')}/${providerAssetId}/${row.thumbnailFileName}`
          : null,
      error: status === 'ERRORED' ? `Bunny status ${String(row.status)}` : null,
    }
  },

  async deleteAsset(providerAssetId) {
    const config = readConfig()
    await bunnyRequest(config, `/library/${config.libraryId}/videos/${providerAssetId}`, {
      method: 'DELETE',
    })
  },

  /**
   * Bunny posts `{ VideoLibraryId, VideoGuid, Status }` on state changes.
   *
   * There is no signature on this webhook, so it is treated as a *hint*, not as
   * truth: the caller re-reads authoritative state via `getAssetState`. That way a
   * forged webhook cannot mark a broken asset READY.
   */
  async parseWebhook(request: WebhookRequest): Promise<WebhookOutcome | null> {
    let payload: unknown
    try {
      payload = JSON.parse(request.rawBody)
    } catch {
      return null
    }

    if (typeof payload !== 'object' || payload === null) return null
    const row = payload as Record<string, unknown>

    const guid = row.VideoGuid ?? row.videoGuid
    if (typeof guid !== 'string' || guid === '') return null

    return {
      providerAssetId: guid,
      state: { status: mapStatus(row.Status ?? row.status) },
    }
  },
}
