/**
 * Tracker validation — the pure value layer.
 *
 * A `TrackerDefinition` is data: a pack declares a type, a scope and a
 * free-form `config` Json. Core parses that config defensively and normalizes
 * the per-record `value` Json into exactly the shape each type renders. The
 * same coercion happens on write (actions) and on read (shaping), so a
 * hand-corrupted row and a stray client payload both degrade to a safe
 * default rather than throwing.
 *
 * Value shapes (see schema comments):
 *   COUNTER  -> { count: number }                 progress = count/target
 *   BOOLEAN  -> { on: boolean }
 *   CHECKLIST-> { checked: string[] }             ids must match config.items
 *   EXPIRY   -> { active: boolean }               + the expiresAt column
 *   GAUGE    -> { value: number } 0..100, or      weighted: { segments: {key: number} }
 *              { segments: { key: 0..100 } }      overall = sum(segment * weight)
 */

import type { TrackerType } from '@/generated/prisma/enums'

export interface TrackerChecklistItem {
  id: string
  label: string
}

export interface TrackerGaugeSegment {
  key: string
  label: string
  /** Fraction of overall progress. Not enforced to sum to 1 — display clamps. */
  weight: number
}

export interface ParsedTrackerConfig {
  target: number | null
  items: TrackerChecklistItem[]
  segments: TrackerGaugeSegment[]
}

export function parseTrackerConfig(raw: unknown): ParsedTrackerConfig {
  const config: ParsedTrackerConfig = { target: null, items: [], segments: [] }
  if (typeof raw !== 'object' || raw === null) return config

  const source = raw as Record<string, unknown>

  if (typeof source.target === 'number' && Number.isFinite(source.target) && source.target > 0) {
    config.target = source.target
  }

  if (Array.isArray(source.items)) {
    const seen = new Set<string>()
    for (const item of source.items) {
      const row = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null
      const id = typeof row?.id === 'string' ? row.id.trim() : ''
      const label = typeof row?.label === 'string' ? row.label.trim() : ''
      if (id !== '' && label !== '' && !seen.has(id)) {
        seen.add(id)
        config.items.push({ id, label })
      }
    }
  }

  if (Array.isArray(source.segments)) {
    const seen = new Set<string>()
    for (const segment of source.segments) {
      const row =
        typeof segment === 'object' && segment !== null ? (segment as Record<string, unknown>) : null
      const key = typeof row?.key === 'string' ? row.key.trim() : ''
      const label = typeof row?.label === 'string' ? row.label.trim() : ''
      const weight =
        typeof row?.weight === 'number' && Number.isFinite(row.weight) && row.weight >= 0
          ? row.weight
          : 0
      if (key !== '' && label !== '' && !seen.has(key)) {
        seen.add(key)
        config.segments.push({ key, label, weight })
      }
    }
  }

  return config
}

export type TrackerUpdate =
  | { type: 'COUNTER'; count: number }
  | { type: 'BOOLEAN'; on: boolean }
  | { type: 'CHECKLIST'; checked: string[] }
  | { type: 'GAUGE'; value?: number; segments?: Record<string, number> }
  | { type: 'EXPIRY'; active: boolean; expiresAt?: string | null }

export type TrackerUpdateResult =
  | { ok: true; value: Record<string, unknown>; expiresAt: Date | null }
  | { ok: false; error: string }

/** Clamps any finite number to [0, 100]; anything else becomes 0. */
function clampPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

/**
 * Normalizes a client update into the stored Json + expiry, per type.
 * `config` is the already-parsed definition config; unknown checklist ids and
 * unknown gauge segment keys are dropped rather than rejected, so a definition
 * edited after a record was saved keeps rendering.
 */
export function normalizeTrackerUpdate(
  type: TrackerType,
  config: ParsedTrackerConfig,
  update: TrackerUpdate,
): TrackerUpdateResult {
  // The caller passes the definition's `type` separately, but narrowing the
  // discriminated `update` union happens on `update.type` — the two are
  // expected to match (the action resolves the type from the definition row),
  // and a mismatched payload falls into the default arm and refuses.
  switch (update.type) {
    case 'COUNTER': {
      if (type !== 'COUNTER') return { ok: false, error: 'Tracker type mismatch.' }
      if (!Number.isInteger(update.count) || update.count < 0) {
        return { ok: false, error: 'Count must be a whole number of 0 or more.' }
      }
      return { ok: true, value: { count: update.count }, expiresAt: null }
    }

    case 'BOOLEAN': {
      if (type !== 'BOOLEAN') return { ok: false, error: 'Tracker type mismatch.' }
      return { ok: true, value: { on: update.on === true }, expiresAt: null }
    }

    case 'CHECKLIST': {
      if (type !== 'CHECKLIST') return { ok: false, error: 'Tracker type mismatch.' }
      if (config.items.length === 0) {
        return { ok: false, error: 'This checklist has no items configured.' }
      }
      const known = new Set(config.items.map((item) => item.id))
      const checked = Array.from(new Set(update.checked)).filter((id) => known.has(id))
      return { ok: true, value: { checked }, expiresAt: null }
    }

    case 'GAUGE': {
      if (type !== 'GAUGE') return { ok: false, error: 'Tracker type mismatch.' }
      if (config.segments.length > 0) {
        if (typeof update.segments !== 'object' || update.segments === null) {
          return { ok: false, error: 'Segment values are required for this gauge.' }
        }
        const known = new Set(config.segments.map((segment) => segment.key))
        const segments: Record<string, number> = {}
        for (const key of known) {
          const raw = update.segments[key]
          segments[key] = clampPercent(raw)
        }
        return { ok: true, value: { segments }, expiresAt: null }
      }
      return { ok: true, value: { value: clampPercent(update.value) }, expiresAt: null }
    }

    case 'EXPIRY': {
      if (type !== 'EXPIRY') return { ok: false, error: 'Tracker type mismatch.' }
      let expiresAt: Date | null = null
      if (update.active && update.expiresAt) {
        const parsed = new Date(update.expiresAt)
        if (Number.isNaN(parsed.getTime())) {
          return { ok: false, error: 'Expiry date is not valid.' }
        }
        expiresAt = parsed
      }
      return { ok: true, value: { active: update.active === true }, expiresAt }
    }
  }
}

// ─── Read-side parsing (the stored Json is untrusted) ──────────────────────

export interface ParsedRecordValue {
  count: number
  on: boolean
  checked: string[]
  active: boolean
  /** Simple gauge value (0..100). */
  value: number
  /** Weighted gauge segment values (each 0..100). */
  segments: Record<string, number>
}

export function parseRecordValue(type: TrackerType, raw: unknown): ParsedRecordValue {
  const out: ParsedRecordValue = {
    count: 0,
    on: false,
    checked: [],
    active: false,
    value: 0,
    segments: {},
  }

  if (typeof raw !== 'object' || raw === null) return out
  const source = raw as Record<string, unknown>

  if (type === 'COUNTER') {
    const count = source.count
    if (typeof count === 'number' && Number.isInteger(count) && count >= 0) out.count = count
    return out
  }

  if (type === 'BOOLEAN') {
    out.on = source.on === true
    return out
  }

  if (type === 'CHECKLIST') {
    if (Array.isArray(source.checked)) {
      out.checked = source.checked.filter((id): id is string => typeof id === 'string')
    }
    return out
  }

  if (type === 'EXPIRY') {
    out.active = source.active === true
    return out
  }

  // GAUGE
  if (typeof source.value === 'number' && Number.isFinite(source.value)) {
    out.value = clampPercent(source.value)
  }
  if (typeof source.segments === 'object' && source.segments !== null) {
    for (const [key, value] of Object.entries(source.segments as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) out.segments[key] = clampPercent(value)
    }
  }
  return out
}

// ─── Display math ──────────────────────────────────────────────────────────

export type TrackerProgress =
  | { kind: 'percent'; value: number }
  | { kind: 'count'; current: number; target: number | null }

/**
 * Progress toward the tracker's goal for list/detail rendering.
 * COUNTER and GAUGE produce a percent when a target is meaningful; others
 * return null and render their own summary (checked n/m, on/off, expiry).
 */
export function trackerProgress(
  type: TrackerType,
  config: ParsedTrackerConfig,
  value: ParsedRecordValue,
): TrackerProgress | null {
  switch (type) {
    case 'COUNTER': {
      if (config.target === null) return null
      const percent = Math.min(100, Math.round((value.count / config.target) * 100))
      return { kind: 'percent', value: percent }
    }

    case 'GAUGE': {
      if (config.segments.length > 0) {
        const weighted = config.segments.reduce(
          (sum, segment) => sum + (value.segments[segment.key] ?? 0) * segment.weight,
          0,
        )
        return { kind: 'percent', value: Math.min(100, Math.round(weighted)) }
      }
      return { kind: 'percent', value: value.value }
    }

    default:
      return null
  }
}

export type ExpiryStatus = 'ACTIVE' | 'EXPIRED' | 'INACTIVE'

/**
 * The life of an EXPIRY record, decided against the injected clock. Active
 * records with a past `expiresAt` read EXPIRED — the reminder job and the UI
 * must agree, so the decision takes `now` instead of the machine clock.
 */
export function decideExpiryStatus(
  value: ParsedRecordValue,
  expiresAt: Date | null,
  now: Date,
): ExpiryStatus | null {
  if (value.active !== true) return 'INACTIVE'
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return 'EXPIRED'
  return 'ACTIVE'
}
