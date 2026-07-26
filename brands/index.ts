/**
 * Brand registry.
 *
 * Static imports keep this bundler-friendly: a per-client build with
 * BRAND=nirlep-forex tree-shakes every other brand out of the output.
 */

import type { BrandConfig } from '@/lib/brand/types'
import demoAcademy from './demo-academy/brand.config'
import nirlepForex from './nirlep-forex/brand.config'
import sunriseAcademy from './sunrise-academy/brand.config'

export const BRANDS: Record<string, BrandConfig> = {
  [nirlepForex.key]: nirlepForex,
  [sunriseAcademy.key]: sunriseAcademy,
  [demoAcademy.key]: demoAcademy,
}

export const DEFAULT_BRAND_KEY = demoAcademy.key
