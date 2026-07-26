/**
 * Org settings and runtime feature resolution.
 *
 * Two sources of truth, deliberately layered:
 *
 *   brand.config.ts   build-time. Packs, integrations, security posture. Changing
 *                     any of these is a deploy, because code depends on them.
 *   OrgSettings       runtime. Name, colours, logos, contacts, and the feature
 *                     flags an admin is allowed to flip without us.
 *
 * A feature is enabled only if the brand build includes it AND the runtime flag
 * has not switched it off. The brand config is therefore a ceiling, not a
 * default — an admin can disable chat, but cannot enable a feature this
 * deployment was not built with, because the routes and jobs would not exist.
 */

import { cache } from 'react'

import { brand } from '@/lib/brand'
import type { BrandFeatures } from '@/lib/brand/types'
import { db } from '@/server/db'
import type { OrgSettings } from '@/generated/prisma/client'

export const ORG_SETTINGS_ID = 'org'

/**
 * Per-request memoized. `cache` dedupes across the many server components in a
 * single render that all want the org name or timezone.
 */
export const getOrgSettings = cache(async (): Promise<OrgSettings> => {
  const settings = await db.orgSettings.findUnique({
    where: { id: ORG_SETTINGS_ID },
  })

  if (!settings) {
    throw new Error(
      'OrgSettings row is missing. Run `npm run db:seed` to initialise this deployment.',
    )
  }

  return settings
})

/** Narrow the untyped `featureFlags` JSON to booleans we can trust. */
function readFlag(flags: unknown, feature: string): boolean | undefined {
  if (typeof flags !== 'object' || flags === null) return undefined
  const value = (flags as Record<string, unknown>)[feature]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * Runtime feature check. Prefer this in request paths; use the synchronous
 * `hasFeature` from `@/lib/brand` only where a DB read is not possible
 * (middleware, module initialisation).
 */
export async function isFeatureEnabled(feature: keyof BrandFeatures): Promise<boolean> {
  if (!brand.features[feature]) return false

  const settings = await getOrgSettings()
  return readFlag(settings.featureFlags, feature) ?? true
}

/** Resolved state of every feature. Used by navigation and the admin console. */
export async function resolveFeatures(): Promise<Record<keyof BrandFeatures, boolean>> {
  const settings = await getOrgSettings()
  const resolved = {} as Record<keyof BrandFeatures, boolean>

  for (const key of Object.keys(brand.features) as Array<keyof BrandFeatures>) {
    resolved[key] = brand.features[key] && (readFlag(settings.featureFlags, key) ?? true)
  }

  return resolved
}

/**
 * Display values, preferring the admin-editable runtime row over the build-time
 * brand config. Logos fall back to the brand config so a deployment always
 * renders something.
 */
export async function getOrgDisplay() {
  const settings = await getOrgSettings()
  return {
    name: settings.name || brand.name,
    supportEmail: settings.supportEmail ?? brand.supportEmail,
    supportPhone: settings.supportPhone ?? brand.supportPhone ?? null,
    logoLightUrl: settings.logoLightUrl ?? brand.logo.light,
    logoDarkUrl: settings.logoDarkUrl ?? brand.logo.dark ?? null,
    timezone: settings.timezone,
    locale: settings.locale,
    currency: settings.currency,
  }
}

/**
 * The org timezone, which is the single authority for rendering dates.
 *
 * This matters more than it looks: drip windows, class reminders and fee due
 * dates all straddle midnight for somebody, and formatting one of them in the
 * server's timezone silently shifts a student's unlock date by a day.
 */
export async function getOrgTimezone(): Promise<string> {
  return (await getOrgSettings()).timezone
}
