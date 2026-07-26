/**
 * Active brand resolution.
 *
 * `NEXT_PUBLIC_BRAND` is read at build time and inlined by Next, so both server
 * and client components resolve the same brand with no runtime lookup. A
 * deployment serves exactly one brand for its lifetime.
 */

import { BRANDS, DEFAULT_BRAND_KEY } from '@brands/index'
import {
  collectDataAdapters,
  collectNavItems,
  mergePackLabels,
  resolvePacks,
} from '@/packs/registry'
import type { DataFeedAdapter, PackNavItem, VerticalPack } from '@/packs/types'
import type { BrandConfig, BrandFeatures } from './types'

const BRAND_KEY = process.env.NEXT_PUBLIC_BRAND ?? DEFAULT_BRAND_KEY

function resolveBrand(): BrandConfig {
  const brand = BRANDS[BRAND_KEY]
  if (!brand) {
    throw new Error(
      `Unknown brand "${BRAND_KEY}". Set NEXT_PUBLIC_BRAND to one of: ${Object.keys(BRANDS).join(', ')}.`,
    )
  }
  return brand
}

export const brand: BrandConfig = resolveBrand()

/** Packs enabled for this deployment, in brand-config order. */
export const activePacks: VerticalPack[] = resolvePacks(brand.packs)

/** Pack label overrides, flattened. Consumed by `t()` in src/lib/labels.ts. */
export const packLabels: Record<string, string> = mergePackLabels(activePacks)

/** Pack-contributed navigation, already sorted. */
export const packNavItems: PackNavItem[] = collectNavItems(activePacks)

/** Adapter lookup for the data-widget refresh job. */
export const dataAdapters: Map<string, DataFeedAdapter<never, never>> =
  collectDataAdapters(activePacks)

/**
 * Build-time feature check. Use this to gate routes, navigation and scheduled
 * jobs. Runtime-toggleable flags additionally consult OrgSettings.featureFlags —
 * see `isFeatureEnabled` in src/server/org/settings.ts.
 */
export function hasFeature(feature: keyof BrandFeatures): boolean {
  return brand.features[feature]
}
