/**
 * Shared plumbing for pack data adapters that read a REST/JSON feed.
 *
 * Every vertical wants some external data on the dashboard — macro releases for
 * a trading academy, exam and application dates for a coaching institute, class
 * occupancy for a studio. The transport, the error mapping and the defensive
 * "which field name did this vendor use" probing are identical every time; only
 * the payload shape differs.
 *
 * Factoring it here means a new pack's adapter is roughly thirty lines of
 * normalization, which is what makes adding a vertical cheap in practice rather
 * than only in principle.
 *
 * Two invariants every adapter built on this must keep:
 *   - Credentials travel in headers, never in the query string.
 *   - An unconfigured or failing feed resolves successfully with `unavailable`
 *     set. The client owns these subscriptions, so a lapsed key must render a
 *     setup notice, not take down a dashboard we are accountable for.
 */

/** Vendors variously send strings or numbers for the same field. */
export function firstString(
  row: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

export function firstNumber(
  row: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

/** Accepts a bare array or an array nested under a common wrapper key. */
export function extractRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  if (typeof body === 'object' && body !== null) {
    for (const key of ['data', 'events', 'items', 'result', 'results', 'records', 'calendar']) {
      const value = (body as Record<string, unknown>)[key]
      if (Array.isArray(value)) return value
    }
  }
  return []
}

/** Parses a date, returning null rather than an Invalid Date. */
export function parseDate(raw: string | null): Date | null {
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Ensures a row is an indexable object before probing it. */
export function asRow(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

export interface JsonFeedRequest {
  baseUrl: string
  apiKey: string
  /** Undefined values are omitted. Never put secrets here. */
  params?: Record<string, string | undefined>
  signal?: AbortSignal
}

export type JsonFeedOutcome =
  | { ok: true; body: unknown }
  | { ok: false; reason: string; ttlSec: number }

/** How long to cache a failure before retrying. */
const RETRY_TRANSIENT_SEC = 300
/** Longer, because a missing key needs a human, not a retry. */
export const RETRY_UNCONFIGURED_SEC = 3600

export async function fetchJsonFeed(request: JsonFeedRequest): Promise<JsonFeedOutcome> {
  let url: URL
  try {
    url = new URL(request.baseUrl)
  } catch {
    return {
      ok: false,
      reason: `Feed URL "${request.baseUrl}" is not a valid absolute URL.`,
      ttlSec: RETRY_UNCONFIGURED_SEC,
    }
  }

  for (const [key, value] of Object.entries(request.params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        Accept: 'application/json',
      },
      signal: request.signal,
    })

    if (!response.ok) {
      // 401/403 means the key is wrong, which a fast retry will not fix.
      const isAuthFailure = response.status === 401 || response.status === 403
      return {
        ok: false,
        reason: `Feed responded ${response.status} ${response.statusText}.`,
        ttlSec: isAuthFailure ? RETRY_UNCONFIGURED_SEC : RETRY_TRANSIENT_SEC,
      }
    }

    return { ok: true, body: await response.json() }
  } catch (error) {
    return {
      ok: false,
      reason: `Could not reach the feed: ${error instanceof Error ? error.message : 'unknown transport error'}`,
      ttlSec: RETRY_TRANSIENT_SEC,
    }
  }
}

/** Names of env vars in `requiredEnv` that are absent from the adapter context. */
export function missingEnv(
  env: Record<string, string | undefined>,
  required: readonly string[],
): string[] {
  return required.filter((name) => !env[name])
}
