/**
 * Media asset lifecycle.
 *
 * Creating an asset and getting an upload target are one operation: the row must
 * exist before the client can upload, because the provider's id comes back from
 * the create call and is what the upload is scoped to.
 */

import { brand } from '@/lib/brand'
import { recordAudit } from '@/server/audit'
import { db } from '@/server/db'
import { adapterForAsset, resolveActiveProvider } from './index'
import type { UploadTarget } from './types'

export interface CreateAssetInput {
  title: string
  filename?: string | null
  sizeBytes?: number | null
  contentType?: string | null
  uploadedById: string
  /**
   * Worksheets and reference material are meant to be downloaded; lectures are
   * not. Defaults to the protected posture.
   */
  downloadable?: boolean
}

export interface CreateAssetResult {
  assetId: string
  upload: UploadTarget
  provider: string
}

export async function createVideoAsset(input: CreateAssetInput): Promise<CreateAssetResult> {
  const adapter = resolveActiveProvider()

  const upload = await adapter.createUploadTarget({
    title: input.title,
    filename: input.filename ?? null,
    sizeBytes: input.sizeBytes ?? null,
    contentType: input.contentType ?? null,
  })

  const asset = await db.mediaAsset.create({
    data: {
      provider: adapter.key,
      providerAssetId: upload.providerAssetId,
      playbackId: upload.playbackId ?? upload.providerAssetId,
      type: 'VIDEO',
      status: 'UPLOADING',
      title: input.title,
      originalFilename: input.filename ?? null,
      sizeBytes: input.sizeBytes ? BigInt(input.sizeBytes) : null,
      mimeType: input.contentType ?? null,
      uploadedById: input.uploadedById,
      // Protection posture defaults from the brand; per-asset overrides are set
      // afterwards in admin.
      drmEnabled: brand.videoSecurity.drm && adapter.supportsDrm,
      watermarkEnabled: brand.videoSecurity.forensicWatermark,
      downloadable: input.downloadable ?? !brand.videoSecurity.blockDownloads,
      maxConcurrentStreams: 0,
    },
    select: { id: true },
  })

  await recordAudit({
    actorId: input.uploadedById,
    action: 'media.created',
    entityType: 'MediaAsset',
    entityId: asset.id,
    meta: { provider: adapter.key, title: input.title },
  })

  return { assetId: asset.id, upload, provider: adapter.key }
}

/**
 * Re-reads authoritative state from the provider and updates the row.
 *
 * Called both by the webhook handler and by a poller. The webhook is treated as
 * an unauthenticated *hint* — Bunny does not sign it — so the state that gets
 * written always comes from an authenticated read, never from the webhook body.
 * Otherwise a forged POST could mark a broken asset READY.
 */
export async function refreshAssetState(assetId: string): Promise<void> {
  const asset = await db.mediaAsset.findUnique({
    where: { id: assetId },
    select: { id: true, provider: true, providerAssetId: true, status: true },
  })

  if (!asset?.providerAssetId) return

  const state = await adapterForAsset(asset.provider).getAssetState(asset.providerAssetId)

  await db.mediaAsset.update({
    where: { id: asset.id },
    data: {
      status: state.status,
      // Only overwrite with real values; providers report 0/null while transcoding.
      ...(state.durationSec ? { durationSec: state.durationSec } : {}),
      ...(state.sizeBytes ? { sizeBytes: BigInt(state.sizeBytes) } : {}),
      ...(state.thumbnailUrl ? { thumbnailUrl: state.thumbnailUrl } : {}),
    },
  })
}

/** Finds our row from a provider's id, for webhook handling. */
export async function findAssetByProviderId(
  providerAssetId: string,
): Promise<{ id: string } | null> {
  return db.mediaAsset.findFirst({
    where: { providerAssetId },
    select: { id: true },
  })
}

/**
 * Deletes the provider's copy and our row. Detaches from lessons first via the
 * schema's onDelete: SetNull, so a lesson survives losing its video.
 */
export async function deleteAsset(assetId: string, actorId: string): Promise<void> {
  const asset = await db.mediaAsset.findUnique({
    where: { id: assetId },
    select: { id: true, provider: true, providerAssetId: true, title: true },
  })
  if (!asset) return

  if (asset.providerAssetId) {
    try {
      await adapterForAsset(asset.provider).deleteAsset(asset.providerAssetId)
    } catch (error) {
      // Leaving an orphan at the provider is preferable to leaving a row that
      // points at deleted bytes, which would present as a broken lesson.
      console.error('[media] provider delete failed; removing local row anyway', error)
    }
  }

  await db.mediaAsset.delete({ where: { id: asset.id } })

  await recordAudit({
    actorId,
    action: 'media.deleted',
    entityType: 'MediaAsset',
    entityId: asset.id,
    meta: { title: asset.title, provider: asset.provider },
  })
}
