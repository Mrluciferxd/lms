'use client'

import { useState } from 'react'

/**
 * Brand logo with a text fallback.
 *
 * A white-label deployment routinely starts before the client has supplied
 * artwork — the Nirlep brand config points at placeholder paths marked
 * TODO(client). Rendering a broken-image icon in that window looks like a defect;
 * falling back to the wordmark looks deliberate. Also covers the case where a
 * client's asset later 404s after a storage change.
 */
export function BrandLogo({
  src,
  orgName,
  className,
}: {
  src: string | null
  orgName: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return <span className="text-base font-semibold">{orgName}</span>
  }

  return (
    // Brand logos are client-supplied SVG/PNG of unknown intrinsic size, so
    // next/image would need per-client remotePattern config for no benefit.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={orgName}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
