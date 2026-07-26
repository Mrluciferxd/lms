'use client'

/**
 * Forensic watermark overlay.
 *
 * Renders the viewer's identity over the video so any recording identifies the
 * account it came from. Read docs/06-video-security.md for what this does and does
 * not achieve: it makes a leak *attributable*, which is the strongest deterrent
 * available for web delivery, and the only one that also survives someone
 * pointing a phone at the screen.
 *
 * The position rotates on a slow cycle. A fixed-position overlay can be cropped
 * out of a recording once and for all; a moving one cannot be removed without
 * cropping most of the frame, which makes the copy far less useful.
 *
 * `pointer-events: none` throughout, so it never interferes with player controls.
 */

import { useEffect, useState } from 'react'

/** Corners only — mid-edge positions sit over player controls. */
const POSITIONS = [
  'top-4 left-4',
  'top-4 right-4',
  'bottom-16 right-4',
  'bottom-16 left-4',
] as const

/** Long enough not to distract, short enough that no single crop defeats it. */
const ROTATE_MS = 20_000

export function WatermarkOverlay({ text }: { text: string }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!text) return
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % POSITIONS.length)
    }, ROTATE_MS)
    return () => clearInterval(timer)
  }, [text])

  if (!text) return null

  return (
    <div
      // Decorative for assistive tech: the student knows who they are, and
      // announcing this on every rotation would be hostile to screen readers.
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 select-none overflow-hidden"
    >
      <span
        className={`absolute ${POSITIONS[index]} rounded bg-black/35 px-2 py-1 font-mono text-[11px] leading-none text-white/70 transition-all duration-1000`}
        style={{
          // Discourages a naive "select and delete the DOM node" workaround from
          // looking like a clean removal in a screen recording.
          textShadow: '0 1px 2px rgba(0,0,0,0.8)',
        }}
      >
        {text}
      </span>
    </div>
  )
}
