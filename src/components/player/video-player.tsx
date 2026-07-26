'use client'

/**
 * Protected lesson player.
 *
 * Plays a short-TTL signed source with a per-viewer watermark and reports
 * progress. Download affordances are suppressed (`controlsList`, no context menu,
 * no Picture-in-Picture) — those are friction for the opportunistic majority, not
 * protection, and are described as such in docs/06-video-security.md.
 *
 * ── DRM PLAYBACK IS NOT WIRED YET ───────────────────────────────────────────
 * Native playback covers progressive MP4 (the local development provider) and
 * HLS on Safari. Widevine on Chrome and PlayReady on Edge need an MSE player
 * (shaka-player) configured with the license endpoints the server returns.
 *
 * That is deliberately not stubbed in here: it cannot be exercised without a
 * provisioned Bunny library, and an untested DRM path that silently falls back to
 * unprotected playback would be worse than an explicit gap. When a DRM source
 * arrives on a browser that cannot play it natively, this renders a clear message
 * instead of a broken video element. Completing it is the first task of the Bunny
 * integration step.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState } from 'react'

import { usePlayback } from './use-playback'
import { WatermarkOverlay } from './watermark-overlay'

/** How often to persist progress. Frequent enough to survive a crash, sparse
 *  enough not to hammer the database from every open tab. */
const PROGRESS_INTERVAL_MS = 15_000

/** Fraction of the video that counts as completed. */
const COMPLETION_RATIO = 0.95

function canPlayNatively(format: string, hasDrm: boolean): boolean {
  if (format === 'mp4') return true
  if (format === 'hls') {
    if (typeof document === 'undefined') return false
    const probe = document.createElement('video')
    const native = probe.canPlayType('application/vnd.apple.mpegurl') !== ''
    // Safari plays HLS and handles FairPlay; other browsers need an MSE player.
    return native && (!hasDrm || native)
  }
  return false
}

export function VideoPlayer({
  lessonId,
  title,
  durationSec,
  initialPositionSec = 0,
}: {
  lessonId: string
  title: string
  durationSec: number | null
  initialPositionSec?: number
}) {
  const { state, retry } = usePlayback(lessonId)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [resumed, setResumed] = useState(false)
  const lastReported = useRef(0)

  /**
   * Reports progress. `keepalive` so the final report survives the navigation
   * that usually ends a session.
   */
  useEffect(() => {
    if (state.status !== 'ready') return

    const report = (final: boolean) => {
      const video = videoRef.current
      if (!video || video.currentTime <= 0) return

      const positionSec = Math.floor(video.currentTime)
      // Skip no-op reports from a paused player.
      if (!final && positionSec === lastReported.current) return
      lastReported.current = positionSec

      const total = durationSec ?? (Number.isFinite(video.duration) ? video.duration : 0)
      const completed = total > 0 && positionSec / total >= COMPLETION_RATIO

      void fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId, positionSec, completed }),
        keepalive: final,
      }).catch(() => {
        // Progress is not worth interrupting playback for.
      })
    }

    const timer = setInterval(() => report(false), PROGRESS_INTERVAL_MS)
    return () => {
      clearInterval(timer)
      report(true)
    }
  }, [state.status, lessonId, durationSec])

  /** Resume once, after metadata is available so the seek is honoured. */
  useEffect(() => {
    const video = videoRef.current
    if (!video || resumed || initialPositionSec <= 0) return

    const onLoaded = () => {
      // Do not resume at the very end; that looks broken.
      if (initialPositionSec < video.duration - 5) {
        video.currentTime = initialPositionSec
      }
      setResumed(true)
    }

    video.addEventListener('loadedmetadata', onLoaded, { once: true })
    return () => video.removeEventListener('loadedmetadata', onLoaded)
  }, [state.status, resumed, initialPositionSec])

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-brand bg-surface-muted">
        <p className="text-sm text-content-muted">Preparing secure playback…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    const isConcurrency = state.error.code === 'CONCURRENCY_LIMIT'
    return (
      <div
        role="alert"
        className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-brand border border-surface-border bg-surface-muted px-6 text-center"
      >
        <p className="text-sm font-medium text-content">{state.error.message}</p>
        {isConcurrency && (
          <p className="max-w-sm text-xs text-content-muted">
            Your account allows {state.error.detail?.limit ?? 1} stream at a time. Close the
            video on your other device, then try again.
          </p>
        )}
        <button
          type="button"
          onClick={retry}
          className="rounded-brand bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    )
  }

  const { source } = state
  const hasDrm = source.drm !== null

  if (!canPlayNatively(source.format, hasDrm)) {
    return (
      <div
        role="alert"
        className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-brand border border-warning/40 bg-warning/10 px-6 text-center"
      >
        <p className="text-sm font-medium text-content">
          This browser needs the DRM player to watch protected video.
        </p>
        <p className="max-w-md text-xs text-content-muted">
          Safari can play this today. DRM playback for Chrome and Edge is completed during
          the video provider integration step — see docs/06-video-security.md.
        </p>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-brand bg-black">
      <video
        ref={videoRef}
        src={source.url}
        poster={source.thumbnailUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        // Removes the browser's download button and the PiP affordance. Trivially
        // bypassable — friction, not protection.
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        onContextMenu={(event) => event.preventDefault()}
        className="aspect-video w-full"
        aria-label={title}
      >
        <track kind="captions" />
      </video>

      <WatermarkOverlay text={source.watermark} />
    </div>
  )
}
