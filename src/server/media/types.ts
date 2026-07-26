/**
 * Video provider contract.
 *
 * Same shape of idea as the pack data adapters: the provider is named in
 * brand config (`integrations.video`) and resolved at runtime, so switching a
 * client from Bunny to Mux is configuration plus one adapter, not a rewrite of
 * the player and upload paths.
 *
 * Providers differ in ways that matter here — some hand out a direct upload URL,
 * some want a multipart POST with signed fields; some report duration on a
 * webhook, some only when polled. The interface covers the union rather than the
 * intersection so no adapter has to lie about what it supports.
 */

import type { MediaProvider, MediaStatus } from '@/generated/prisma/enums'

export interface UploadTarget {
  /** Where the browser sends the file bytes. */
  url: string
  method: 'PUT' | 'POST'
  /**
   * How the client must talk to `url`. `tus` needs a resumable-upload client;
   * `binary` is a single request with the file as the body; `form` is multipart
   * with `fields` included. The uploader branches on this.
   */
  protocol: 'tus' | 'binary' | 'form'
  headers?: Record<string, string>
  /** Multipart form fields, for presigned-POST style providers. */
  fields?: Record<string, string>
  /** Stored as MediaAsset.providerAssetId. */
  providerAssetId: string
  /** Stored as MediaAsset.playbackId when the provider separates the two. */
  playbackId?: string | null
  /** When this upload authorization stops working. */
  expiresAt: Date
}

export interface DrmEndpoints {
  widevineLicenseUrl?: string
  playreadyLicenseUrl?: string
  fairplayLicenseUrl?: string
  /** FairPlay additionally needs the certificate fetched before a license. */
  fairplayCertificateUrl?: string
}

export interface SignedPlayback {
  url: string
  format: 'hls' | 'dash' | 'mp4'
  expiresAt: Date
  /** Present only when the asset and brand both have DRM enabled. */
  drm?: DrmEndpoints
  thumbnailUrl?: string | null
}

export interface SignPlaybackInput {
  asset: {
    id: string
    providerAssetId: string | null
    playbackId: string | null
    drmEnabled: boolean
  }
  viewer: { id: string }
  ttlSec: number
  /**
   * Binds the token to the requesting IP when the provider supports it. Off by
   * default: mobile networks rotate addresses mid-session, and a token that dies
   * on a cell handover is a support ticket, not security.
   */
  ip?: string | null
}

export interface RemoteAssetState {
  status: MediaStatus
  durationSec?: number | null
  sizeBytes?: number | null
  thumbnailUrl?: string | null
  error?: string | null
}

export interface WebhookRequest {
  rawBody: string
  headers: Record<string, string | undefined>
}

export interface WebhookOutcome {
  /** Provider's asset id, so we can find our row. */
  providerAssetId: string
  state: RemoteAssetState
}

export class MediaProviderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'MediaProviderError'
  }
}

export interface VideoProviderAdapter {
  key: MediaProvider
  name: string
  /** Checked before use; reported in the admin setup checklist. */
  requiredEnv: readonly string[]
  /** Whether this adapter can actually enforce DRM. */
  supportsDrm: boolean
  /** Whether it can burn a per-viewer overlay server-side. */
  supportsServerWatermark: boolean

  createUploadTarget(input: {
    title: string
    filename?: string | null
    sizeBytes?: number | null
    contentType?: string | null
  }): Promise<UploadTarget>

  signPlayback(input: SignPlaybackInput): Promise<SignedPlayback>

  getAssetState(providerAssetId: string): Promise<RemoteAssetState>

  deleteAsset(providerAssetId: string): Promise<void>

  /** Absent when the provider has no webhook; the poller is used instead. */
  parseWebhook?(request: WebhookRequest): Promise<WebhookOutcome | null>
}
