/**
 * Playback authorization.
 *
 * The security boundary for video. Everything a student needs to watch a lesson
 * passes through here: access check, concurrency enforcement, grant ledger,
 * watermark, and a short-TTL signed URL.
 *
 * Three properties this is built to guarantee:
 *
 *  1. No durable asset URL exists. Tokens live for `videoSecurity.signedUrlTtlSec`
 *     (180s for Nirlep), so a copied link is worthless within minutes.
 *  2. Every issued token is recorded. When a recording leaks, the burned-in
 *     watermark maps back to an account, device, IP and minute.
 *  3. One paid login cannot serve a WhatsApp group. Concurrency is the control
 *     that actually protects revenue — the common leak in cohort education is a
 *     shared password, not sophisticated ripping.
 */

import { brand } from '@/lib/brand'
import { recordAudit } from '@/server/audit'
// Uncached: this runs once per route-handler invocation, outside any React
// render, so there is no request scope for cache() to key on.
import { loadLessonAccess } from '@/server/catalog/access'
import { db } from '@/server/db'
import { getOrgSettings } from '@/server/org/settings'
import { adapterForAsset } from './index'
import { renderWatermark } from './watermark'
import type { SignedPlayback } from './types'
import type { AccessDenialReason } from '@/server/catalog/access'

export type PlaybackErrorCode =
  | 'NOT_AUTHENTICATED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'LOCKED'
  | 'ENROLLMENT_EXPIRED'
  | 'NO_VIDEO'
  | 'NOT_READY'
  | 'CONCURRENCY_LIMIT'
  | 'DEVICE_REQUIRED'
  | 'PROVIDER_ERROR'

export interface PlaybackDenied {
  ok: false
  status: 400 | 401 | 403 | 404 | 409 | 503
  code: PlaybackErrorCode
  message: string
  /** Populated for CONCURRENCY_LIMIT so the UI can say how many are in use. */
  detail?: { activeStreams: number; limit: number }
}

export interface PlaybackIssued {
  ok: true
  grantId: string
  playback: SignedPlayback
  /** Rendered overlay text. Empty when watermarking is off for this asset. */
  watermark: string
  expiresAt: Date
  /** Client should renew this many seconds before expiry. */
  renewAfterSec: number
}

export type PlaybackResult = PlaybackIssued | PlaybackDenied

export interface IssuePlaybackInput {
  lessonId: string
  viewerId: string | null
  /**
   * Stable per-browser id, generated client-side and persisted. REQUIRED.
   *
   * Without it, concurrency cannot be counted per device: grants with a null
   * device would collapse into a single bucket and a shared login would read as
   * one stream no matter how many people were watching. Rotating the value to
   * evade the limit backfires — each rotation reads as an additional device and
   * hits the cap sooner.
   */
  deviceFingerprint: string | null
  ip: string | null
  userAgent: string | null
}

/** Maps an access denial to an HTTP-shaped response. */
function denyFromAccess(reason: AccessDenialReason): PlaybackDenied {
  switch (reason) {
    case 'NOT_AUTHENTICATED':
      return { ok: false, status: 401, code: 'NOT_AUTHENTICATED', message: 'Sign in to watch this lesson.' }
    case 'NOT_FOUND':
      return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Lesson not found.' }
    case 'NOT_ENROLLED':
      // 404 rather than 403: do not confirm the lesson exists to someone with no
      // enrollment, matching the admin-route behaviour in rbac.ts.
      return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Lesson not found.' }
    case 'ENROLLMENT_INACTIVE':
      return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Your enrollment is not active.' }
    case 'ENROLLMENT_EXPIRED':
      return {
        ok: false,
        status: 403,
        code: 'ENROLLMENT_EXPIRED',
        message: 'Your access to this course has expired.',
      }
    case 'NOT_RELEASED':
      return { ok: false, status: 403, code: 'LOCKED', message: 'This lesson is not available yet.' }
  }
}

/**
 * Effective concurrent-stream limit. The per-asset value wins when set, so a
 * single sensitive recording can be tighter than the deployment default.
 * 0 means unlimited at both levels.
 */
export function effectiveStreamLimit(assetLimit: number, brandLimit: number): number {
  return assetLimit > 0 ? assetLimit : brandLimit
}

export async function issuePlayback(input: IssuePlaybackInput): Promise<PlaybackResult> {
  if (!input.deviceFingerprint) {
    return {
      ok: false,
      status: 400,
      code: 'DEVICE_REQUIRED',
      message: 'A device identifier is required to start playback.',
    }
  }

  const { decision, lesson } = await loadLessonAccess(input.lessonId, input.viewerId)

  if (!decision.allowed) return denyFromAccess(decision.reason)
  if (!lesson) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Lesson not found.' }

  if (!lesson.videoAssetId) {
    return { ok: false, status: 404, code: 'NO_VIDEO', message: 'This lesson has no video.' }
  }

  // Preview access has no viewer, so there is nobody to bind a grant or a
  // watermark to. Previews are marketing material and are expected to be
  // shareable, so they are served without the ledger.
  const viewerId = input.viewerId
  if (!viewerId) {
    return {
      ok: false,
      status: 401,
      code: 'NOT_AUTHENTICATED',
      message: 'Sign in to watch this lesson.',
    }
  }

  const asset = await db.mediaAsset.findUnique({
    where: { id: lesson.videoAssetId },
    select: {
      id: true,
      provider: true,
      providerAssetId: true,
      playbackId: true,
      status: true,
      drmEnabled: true,
      watermarkEnabled: true,
      maxConcurrentStreams: true,
    },
  })

  if (!asset) {
    return { ok: false, status: 404, code: 'NO_VIDEO', message: 'This lesson has no video.' }
  }

  if (asset.status !== 'READY') {
    return {
      ok: false,
      status: 409,
      code: 'NOT_READY',
      message:
        asset.status === 'ERRORED'
          ? 'This video failed to process. Please contact support.'
          : 'This video is still processing. Try again shortly.',
    }
  }

  const [viewer, settings] = await Promise.all([
    db.user.findUnique({
      where: { id: viewerId },
      select: { id: true, name: true, email: true },
    }),
    getOrgSettings(),
  ])

  if (!viewer) {
    return { ok: false, status: 401, code: 'NOT_AUTHENTICATED', message: 'Sign in to watch this lesson.' }
  }

  const now = new Date()
  const ttlSec = brand.videoSecurity.signedUrlTtlSec

  // Register or refresh the device before counting, so its own prior grants can
  // be identified and released.
  const device = await db.device.upsert({
    where: { userId_fingerprint: { userId: viewerId, fingerprint: input.deviceFingerprint } },
    update: { lastSeenAt: now, lastIp: input.ip, userAgent: input.userAgent },
    create: {
      userId: viewerId,
      fingerprint: input.deviceFingerprint,
      lastIp: input.ip,
      userAgent: input.userAgent,
    },
    select: { id: true, revokedAt: true },
  })

  if (device.revokedAt) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'This device has been blocked. Contact support.',
    }
  }

  /**
   * Release this device's own live grants first: renewing a token mid-lesson is
   * the normal case (the player re-requests before expiry), and counting it as an
   * additional stream would lock a single legitimate viewer out of their own
   * lesson after `ttlSec`.
   */
  await db.playbackGrant.updateMany({
    where: { userId: viewerId, deviceId: device.id, revokedAt: null },
    data: { revokedAt: now },
  })

  const limit = effectiveStreamLimit(
    asset.maxConcurrentStreams,
    brand.videoSecurity.maxConcurrentStreams,
  )

  if (limit > 0) {
    // Distinct devices, not grants: one device watching several lessons in tabs is
    // one person, while two devices is the case worth blocking.
    const otherActiveDevices = await db.playbackGrant.findMany({
      where: {
        userId: viewerId,
        revokedAt: null,
        expiresAt: { gt: now },
        deviceId: { not: device.id },
      },
      select: { deviceId: true },
      distinct: ['deviceId'],
    })

    if (otherActiveDevices.length >= limit) {
      await recordAudit({
        actorId: viewerId,
        action: 'playback.concurrency_blocked',
        entityType: 'MediaAsset',
        entityId: asset.id,
        meta: { lessonId: lesson.id, limit, active: otherActiveDevices.length },
      })

      return {
        ok: false,
        status: 409,
        code: 'CONCURRENCY_LIMIT',
        message:
          limit === 1
            ? 'This account is already streaming on another device. Stop that stream and try again.'
            : `This account is already streaming on ${otherActiveDevices.length} devices.`,
        detail: { activeStreams: otherActiveDevices.length, limit },
      }
    }
  }

  const expiresAt = new Date(now.getTime() + ttlSec * 1000)

  const grant = await db.playbackGrant.create({
    data: {
      userId: viewerId,
      assetId: asset.id,
      deviceId: device.id,
      ip: input.ip,
      userAgent: input.userAgent,
      issuedAt: now,
      expiresAt,
    },
    select: { id: true },
  })

  let playback: SignedPlayback
  try {
    playback = await adapterForAsset(asset.provider).signPlayback({
      asset: {
        id: asset.id,
        providerAssetId: asset.providerAssetId,
        playbackId: asset.playbackId,
        drmEnabled: asset.drmEnabled && brand.videoSecurity.drm,
      },
      viewer: { id: viewerId },
      ttlSec,
      ip: input.ip,
    })
  } catch (error) {
    // Do not leave a grant counted against the student's concurrency for a
    // failure that was ours.
    await db.playbackGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } })
    console.error('[playback] provider signing failed', error)
    return {
      ok: false,
      status: 503,
      code: 'PROVIDER_ERROR',
      message: 'Video is temporarily unavailable. Please try again.',
    }
  }

  const watermark =
    asset.watermarkEnabled && brand.videoSecurity.forensicWatermark
      ? renderWatermark(
          settings.watermarkTemplate ?? brand.videoSecurity.watermarkTemplate,
          { userId: viewer.id, name: viewer.name, email: viewer.email, ip: input.ip },
          { timezone: settings.timezone, locale: settings.locale, now },
        )
      : ''

  return {
    ok: true,
    grantId: grant.id,
    playback,
    watermark,
    expiresAt,
    // Renew with a margin, so a slow network does not interrupt playback.
    renewAfterSec: Math.max(Math.floor(ttlSec * 0.6), 30),
  }
}

/**
 * Releases a grant when the player stops. Without this a student who closes a
 * lesson and opens it on their phone waits out the full TTL, which reads as a
 * broken product rather than as a security control.
 */
export async function releasePlayback(grantId: string, viewerId: string): Promise<void> {
  await db.playbackGrant.updateMany({
    // Scoped by userId so one student cannot free another's stream slot.
    where: { id: grantId, userId: viewerId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/** Active stream count for a user. Used by admin to explain a lockout. */
export async function countActiveStreams(userId: string): Promise<number> {
  const devices = await db.playbackGrant.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { deviceId: true },
    distinct: ['deviceId'],
  })
  return devices.length
}
