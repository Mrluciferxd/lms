/**
 * Retry policy for the delivery worker.
 *
 * Pure, so the escalation from "try again in a minute" to "give up and record
 * why" is testable without a provider that fails on demand.
 *
 * Two axes, not one. A transient failure — a 502 from the SMS gateway, a
 * timeout — is worth retrying. A permanent one — the student has no phone number
 * on file — is not, and burning five attempts on it only delays the moment an
 * operator sees the real problem in the delivery log.
 */

const MS_PER_MINUTE = 60_000

/** Five attempts over roughly a quarter of an hour before it becomes a person's problem. */
export const MAX_ATTEMPTS = 5

const BASE_DELAY_MS = MS_PER_MINUTE
const MAX_DELAY_MS = 60 * MS_PER_MINUTE

export type RetryDecision =
  | { retry: true; retryAt: Date; delayMs: number }
  | { retry: false; reason: 'PERMANENT' | 'ATTEMPTS_EXHAUSTED' }

/**
 * Exponential, capped, and deliberately without jitter. Jitter exists to stop a
 * fleet of workers retrying in lockstep; a deployment runs one worker over a
 * bounded batch, so the only thing jitter would buy here is a test that cannot
 * assert its own output.
 */
export function backoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1)
  return Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS)
}

/**
 * `attempts` is the count *including* the attempt that just failed.
 */
export function planRetry(input: {
  attempts: number
  retryable: boolean
  now: Date
}): RetryDecision {
  if (!input.retryable) return { retry: false, reason: 'PERMANENT' }
  if (input.attempts >= MAX_ATTEMPTS) return { retry: false, reason: 'ATTEMPTS_EXHAUSTED' }

  const delayMs = backoffMs(input.attempts)
  return { retry: true, retryAt: new Date(input.now.getTime() + delayMs), delayMs }
}
