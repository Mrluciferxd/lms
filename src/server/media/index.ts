/**
 * Video provider resolution.
 *
 * The brand config names the provider; this maps that to an adapter. Same
 * registry pattern as vertical packs — one indirection so no calling code names a
 * vendor.
 */

import { brand } from '@/lib/brand'
import { bunnyStreamAdapter } from './bunny'
import { localVideoAdapter } from './local'
import { MediaProviderError, type VideoProviderAdapter } from './types'
import type { BrandIntegrations } from '@/lib/brand/types'
import type { MediaProvider } from '@/generated/prisma/enums'

/**
 * Adapters that exist today. Mux and Cloudflare Stream are deliberately absent
 * rather than stubbed: a half-implemented adapter that throws at playback time is
 * worse than a resolution error at boot, which names the problem.
 */
const ADAPTERS: Partial<Record<MediaProvider, VideoProviderAdapter>> = {
  BUNNY_STREAM: bunnyStreamAdapter,
  LOCAL: localVideoAdapter,
}

/** brand.integrations.video → MediaProvider enum. */
const BRAND_TO_PROVIDER: Record<BrandIntegrations['video'], MediaProvider> = {
  'bunny-stream': 'BUNNY_STREAM',
  mux: 'MUX',
  'cloudflare-stream': 'CLOUDFLARE_STREAM',
  s3: 'S3',
}

/**
 * The provider this deployment writes new uploads to.
 *
 * In development, a brand configured for Bunny falls back to LOCAL when Bunny
 * credentials are absent — otherwise nobody can work on the video pipeline until
 * the client provisions their library, which is exactly the dependency the local
 * adapter exists to break. Never falls back in production.
 */
export function resolveActiveProvider(): VideoProviderAdapter {
  const configured = BRAND_TO_PROVIDER[brand.integrations.video]
  const adapter = ADAPTERS[configured]

  if (!adapter) {
    throw new MediaProviderError(
      `Brand "${brand.key}" is configured for video provider "${brand.integrations.video}", which has no adapter yet. Implemented: ${Object.keys(ADAPTERS).join(', ')}.`,
    )
  }

  const missing = adapter.requiredEnv.filter((name) => !process.env[name])
  if (missing.length === 0) return adapter

  if (process.env.NODE_ENV === 'production') {
    throw new MediaProviderError(
      `${adapter.name} is missing ${missing.join(', ')}. Configure it or change integrations.video.`,
    )
  }

  console.warn(
    `[media] ${adapter.name} is missing ${missing.join(', ')} — falling back to the LOCAL provider for development.`,
  )
  return localVideoAdapter
}

/**
 * The adapter for an asset that already exists, chosen by the provider recorded
 * on the row rather than by current config. Assets uploaded before a provider
 * switch must keep playing through the provider that holds their bytes.
 */
export function adapterForAsset(provider: MediaProvider): VideoProviderAdapter {
  const adapter = ADAPTERS[provider]
  if (!adapter) {
    throw new MediaProviderError(
      `Asset is stored on provider "${provider}", which has no adapter in this build.`,
    )
  }
  return adapter
}

export { MediaProviderError } from './types'
export type {
  RemoteAssetState,
  SignedPlayback,
  UploadTarget,
  VideoProviderAdapter,
} from './types'
