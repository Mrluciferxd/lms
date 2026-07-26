import { ImageResponse } from 'next/og'

import { brand } from '@/lib/brand'
import { parseHexColor, readableForeground, toChannelString } from '@/lib/brand/theme'

/**
 * Default social card, inherited by every route that does not set its own.
 *
 * Generated rather than shipped as a file because a white-label deployment
 * routinely goes live before the client supplies artwork — the Nirlep brand
 * config still points at placeholder logo paths. A card built from the brand
 * colour and wordmark is always correct, always present, and costs the client
 * nothing to produce.
 *
 * The foreground is the same WCAG-derived colour the buttons use, so the text
 * stays readable whether the client's primary is navy or bright yellow. No
 * database read: this must render for any URL, including ones whose content is
 * gone.
 */

export const alt = `${brand.name} — ${brand.marketing.tagline}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  const primary = parseHexColor(brand.theme.primary)
  const foreground = readableForeground(primary)

  const background = `rgb(${toChannelString(primary)})`
  const text = `rgb(${toChannelString(foreground)})`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background,
          color: text,
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', fontSize: 34, opacity: 0.85 }}>{brand.domain}</div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 92, fontWeight: 700, letterSpacing: '-0.03em' }}>
            {brand.name}
          </div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 44, opacity: 0.9 }}>
            {brand.marketing.tagline}
          </div>
        </div>
      </div>
    ),
    size,
  )
}
