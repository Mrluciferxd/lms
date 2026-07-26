'use client'

/**
 * Playback session lifecycle.
 *
 * Owns the short-TTL token dance: request a signed URL, renew it before it
 * expires, and release the grant on unmount so the student's concurrency slot
 * frees immediately rather than after the full TTL.
 *
 * The device fingerprint is a random id persisted in localStorage. It is not a
 * fingerprint in the tracking sense and deliberately carries no device
 * characteristics — it exists only so the server can tell "this browser renewing
 * its token" apart from "a second browser sharing this login".
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const DEVICE_KEY = 'lms.device-id'

export interface PlaybackSource {
  grantId: string
  url: string
  format: 'hls' | 'dash' | 'mp4'
  drm: {
    widevineLicenseUrl?: string
    fairplayLicenseUrl?: string
    fairplayCertificateUrl?: string
  } | null
  thumbnailUrl: string | null
  watermark: string
  expiresAt: string
  renewAfterSec: number
}

export interface PlaybackError {
  code: string
  message: string
  detail?: { activeStreams: number; limit: number }
}

export type PlaybackState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; source: PlaybackSource }
  | { status: 'error'; error: PlaybackError }

/**
 * Stable per-browser id. `crypto.randomUUID` rather than any device
 * characteristic: it must be stable for a real user and offer nothing to
 * fingerprint with.
 */
function deviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY)
    if (existing && existing.length >= 8) return existing
    const created = crypto.randomUUID()
    window.localStorage.setItem(DEVICE_KEY, created)
    return created
  } catch {
    // Private mode with storage blocked: fall back to a per-session id. The
    // student may hit the concurrency limit sooner, which is the safe direction.
    return crypto.randomUUID()
  }
}

export function usePlayback(lessonId: string) {
  const [state, setState] = useState<PlaybackState>({ status: 'idle' })
  const grantRef = useRef<string | null>(null)
  const renewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Guards against a renewal landing after the component has gone away. */
  const activeRef = useRef(true)

  const clearRenew = useCallback(() => {
    if (renewTimer.current) {
      clearTimeout(renewTimer.current)
      renewTimer.current = null
    }
  }, [])

  const request = useCallback(
    async (isRenewal: boolean) => {
      // A renewal must not blank the player; only the first request shows loading.
      if (!isRenewal) setState({ status: 'loading' })

      try {
        const response = await fetch('/api/playback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lessonId, deviceFingerprint: deviceId() }),
        })

        const body = (await response.json()) as Record<string, unknown>
        if (!activeRef.current) return

        if (!response.ok) {
          setState({
            status: 'error',
            error: {
              code: typeof body.code === 'string' ? body.code : 'UNKNOWN',
              message:
                typeof body.error === 'string' ? body.error : 'Unable to start playback.',
              detail: body.detail as PlaybackError['detail'],
            },
          })
          return
        }

        const source = body as unknown as PlaybackSource
        grantRef.current = source.grantId
        setState({ status: 'ready', source })

        // Renew ahead of expiry so a slow network does not interrupt playback.
        clearRenew()
        renewTimer.current = setTimeout(
          () => void request(true),
          Math.max(source.renewAfterSec, 15) * 1000,
        )
      } catch {
        if (!activeRef.current) return
        setState({
          status: 'error',
          error: { code: 'NETWORK', message: 'Network problem starting playback.' },
        })
      }
    },
    [lessonId, clearRenew],
  )

  useEffect(() => {
    activeRef.current = true
    void request(false)

    return () => {
      activeRef.current = false
      clearRenew()

      const grantId = grantRef.current
      if (!grantId) return

      /**
       * Release on unmount. `keepalive` so the request survives the page
       * navigation that usually triggers this — without it, closing a tab would
       * leave the slot occupied for the rest of the TTL.
       */
      void fetch('/api/playback', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grantId }),
        keepalive: true,
      }).catch(() => {
        // Best effort; the grant expires on its own.
      })
      grantRef.current = null
    }
  }, [request, clearRenew])

  return { state, retry: () => void request(false) }
}
