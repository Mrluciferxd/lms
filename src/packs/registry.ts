/**
 * Pack registry.
 *
 * Every pack the platform ships is listed here. Which ones are *active* is
 * decided by the brand config, so a deployment ships one codebase and enables a
 * subset. Imports are static so bundlers can tree-shake unused packs out of a
 * per-client build.
 */

import { coachingPack } from './coaching'
import { forexPack } from './forex'
import type { DataFeedAdapter, PackNavItem, VerticalPack } from './types'

/**
 * Every pack the platform ships. Two unrelated industries on one core is the
 * working proof that core carries no vertical assumptions — add the third here.
 */
const ALL_PACKS: readonly VerticalPack[] = [forexPack, coachingPack]

const BY_KEY = new Map(ALL_PACKS.map((pack) => [pack.key, pack]))

export function listAvailablePacks(): readonly VerticalPack[] {
  return ALL_PACKS
}

export function getPack(key: string): VerticalPack | undefined {
  return BY_KEY.get(key)
}

/**
 * Resolves brand-config pack keys to packs. An unknown key is a config typo, and
 * silently ignoring it would leave a client wondering where their features went
 * — so it throws at startup rather than degrading quietly.
 */
export function resolvePacks(keys: readonly string[]): VerticalPack[] {
  const unknown = keys.filter((key) => !BY_KEY.has(key))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown vertical pack(s): ${unknown.join(', ')}. ` +
        `Available: ${[...BY_KEY.keys()].join(', ') || '(none)'}.`,
    )
  }
  return keys.map((key) => BY_KEY.get(key)!)
}

/**
 * Flattens pack label overrides. Later packs win on collision; core defaults
 * fill any key no pack overrides.
 */
export function mergePackLabels(packs: readonly VerticalPack[]): Record<string, string> {
  return Object.assign({}, ...packs.map((pack) => pack.labels ?? {}))
}

export function collectNavItems(packs: readonly VerticalPack[]): PackNavItem[] {
  return packs
    .flatMap((pack) => pack.navItems ?? [])
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

/**
 * Builds the adapter lookup used by the data-widget refresh job. Two packs
 * claiming the same adapter key is a packaging bug, not a runtime condition.
 */
export function collectDataAdapters(
  packs: readonly VerticalPack[],
): Map<string, DataFeedAdapter<never, never>> {
  const adapters = new Map<string, DataFeedAdapter<never, never>>()
  for (const pack of packs) {
    for (const adapter of pack.dataAdapters ?? []) {
      if (adapters.has(adapter.key)) {
        throw new Error(
          `Duplicate data adapter key "${adapter.key}" — claimed by more than one enabled pack.`,
        )
      }
      adapters.set(adapter.key, adapter)
    }
  }
  return adapters
}
