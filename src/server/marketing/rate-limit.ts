/**
 * Fixed-window rate limiting for public form submissions.
 *
 * In-process, deliberately. One deployment and one database per client
 * (docs/01-architecture.md) with lead volumes in the tens per day make a Redis
 * dependency more operational surface than it buys. The honest cost: the limit
 * is per instance, so N instances allow N x limit, and a restart forgets every
 * window. That is proportionate to what it defends — a script pointed at the
 * enquiry form — and it is not the only defence, because the lead action also
 * suppresses duplicate contact details, which holds across instances and across
 * restarts.
 *
 * If a deployment ever needs a shared limit, replace `checkRateLimit` with a
 * store-backed implementation; `consume` is where the policy lives and does not
 * change.
 */

import { createHash, randomBytes } from 'node:crypto'

export interface RateLimitConfig {
  /** Requests permitted per window. */
  limit: number
  windowMs: number
}

export interface RateLimitWindow {
  count: number
  /** Epoch ms when the current window opened. */
  startedAt: number
}

export interface RateLimitDecision {
  allowed: boolean
  remaining: number
  /** Seconds until the window resets. 0 when allowed. */
  retryAfterSec: number
  /** The window to store back. Returned rather than mutated so this stays pure. */
  window: RateLimitWindow
}

/**
 * Pure window arithmetic. Separated from the store so the whole matrix —
 * first hit, window rollover, exact-limit boundary, retry-after — is testable
 * without sleeping.
 */
export function consume(
  existing: RateLimitWindow | undefined,
  nowMs: number,
  config: RateLimitConfig,
): RateLimitDecision {
  const expired = !existing || nowMs - existing.startedAt >= config.windowMs

  if (expired) {
    return {
      allowed: true,
      remaining: Math.max(0, config.limit - 1),
      retryAfterSec: 0,
      window: { count: 1, startedAt: nowMs },
    }
  }

  // Capped so sustained abuse cannot grow the counter without bound; the window
  // start never moves, so hammering does not extend the block either.
  const count = Math.min(existing.count + 1, config.limit + 1)
  const allowed = count <= config.limit
  const resetAt = existing.startedAt + config.windowMs

  return {
    allowed,
    remaining: Math.max(0, config.limit - count),
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((resetAt - nowMs) / 1000)),
    window: { count, startedAt: existing.startedAt },
  }
}

/**
 * Per-process salt. An unsalted hash of an IPv4 address is reversible by brute
 * force in seconds, which would make the bucket key a stored identifier rather
 * than an anonymous one. Losing it on restart is harmless — windows are minutes.
 */
const KEY_SALT = randomBytes(16).toString('hex')

/** Anonymous, stable-within-a-process bucket key for a client. */
export function clientKey(scope: string, ip: string | null): string {
  return createHash('sha256')
    .update(`${KEY_SALT}:${scope}:${ip ?? 'unknown'}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Bound on tracked keys. Reached only under attack; pruning expired entries at
 * that point is cheaper than an unbounded map, and dropping live windows in the
 * worst case costs one extra permitted request rather than correctness.
 */
const MAX_TRACKED_KEYS = 10_000

const windows = new Map<string, RateLimitWindow>()

function prune(nowMs: number, windowMs: number): void {
  for (const [key, window] of windows) {
    if (nowMs - window.startedAt >= windowMs) windows.delete(key)
  }
  if (windows.size > MAX_TRACKED_KEYS) windows.clear()
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  now: Date = new Date(),
): RateLimitDecision {
  const nowMs = now.getTime()
  const decision = consume(windows.get(key), nowMs, config)
  windows.set(key, decision.window)

  if (windows.size > MAX_TRACKED_KEYS) prune(nowMs, config.windowMs)

  return decision
}

/** Test seam. Never call this from request paths. */
export function resetRateLimits(): void {
  windows.clear()
}
