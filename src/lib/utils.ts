import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Conditional class names with Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Formats an integer minor-unit amount for display.
 *
 * Every amount in the system is stored as an integer of the currency's minor
 * unit (paise, cents) and never as a float — see docs/01-architecture.md. This is
 * the only place that division by 100 should happen.
 */
export function formatMoney(
  amountMinor: number,
  currency = 'INR',
  locale = 'en-IN',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100)
}

/**
 * Formats a date in the org's timezone rather than the server's.
 *
 * Load-bearing: a lesson that unlocks at 00:30 IST renders as the previous day if
 * formatted in UTC, which silently misreports every student's drip schedule.
 */
export function formatDate(
  date: Date | string,
  timezone: string,
  locale = 'en-IN',
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone }).format(
    typeof date === 'string' ? new Date(date) : date,
  )
}

export function formatDateTime(
  date: Date | string,
  timezone: string,
  locale = 'en-IN',
): string {
  return formatDate(date, timezone, locale, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Duration in seconds as `h:mm:ss` or `m:ss`. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  const pad = (n: number) => n.toString().padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

/** URL-safe slug. Used for course and channel slugs. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
