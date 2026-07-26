/**
 * Org context and sample data.
 *
 * The org half of every template's variables — name, timezone, locale, currency,
 * support contacts — resolved once per scheduler run and once per admin preview,
 * from the same place the rest of the product reads them.
 *
 * The sample contexts exist so the template editor can render a real preview.
 * They are built from the deployment's own org settings rather than from
 * invented ones, so an admin previewing a fee reminder sees their own currency
 * and their own timezone, which is where a formatting mistake becomes obvious.
 */

import { env } from '@/env'
import { t } from '@/lib/labels'
import { getOrgDisplay } from '@/server/org/settings'
import type { ScheduledTrigger } from './schedule'
import type { OrgContext, TemplateContext } from './variables'

/**
 * Local hour that date-anchored reminders go out at.
 *
 * Belongs in `OrgSettings` — it is exactly the kind of thing an academy wants to
 * change without a deploy — but the schema is frozen this round, so it reads
 * from the environment with a sane default. Nine in the morning, in the org's
 * own timezone: early enough to act on a fee due that day, late enough not to
 * wake anybody.
 */
const DEFAULT_DAILY_SEND_HOUR = 9

export function dailySendHour(): number {
  const raw = process.env.NOTIFICATIONS_DAILY_SEND_HOUR
  if (!raw) return DEFAULT_DAILY_SEND_HOUR

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
    console.warn(
      `[notify] NOTIFICATIONS_DAILY_SEND_HOUR="${raw}" is not an hour 0-23; using ${DEFAULT_DAILY_SEND_HOUR}.`,
    )
    return DEFAULT_DAILY_SEND_HOUR
  }
  return parsed
}

export async function buildOrgContext(): Promise<OrgContext> {
  const org = await getOrgDisplay()
  return {
    name: org.name,
    timezone: org.timezone,
    locale: org.locale,
    currency: org.currency,
    supportEmail: org.supportEmail,
    supportPhone: org.supportPhone,
    appUrl: env.NEXT_PUBLIC_APP_URL,
  }
}

/**
 * A plausible context for one trigger, for the editor preview.
 *
 * Fixed offsets from a caller-supplied instant rather than from `Date.now()`, so
 * the preview a server renders and the preview the browser re-renders on the
 * next keystroke agree — a hydration mismatch in a preview would read as the
 * template being wrong.
 */
export function sampleContext(
  trigger: ScheduledTrigger,
  org: OrgContext,
  sendAt: Date,
): TemplateContext {
  const student = {
    name: 'Asha Menon',
    email: 'asha.menon@example.com',
    phone: '+919876543210',
  }
  const course = { title: 'Foundation Programme', url: `${org.appUrl}/app/courses/foundation` }
  const batch = { name: 'August Cohort', code: 'AUG-26' }
  const inMinutes = (minutes: number) => new Date(sendAt.getTime() + minutes * 60_000)
  const inDays = (days: number) => inMinutes(days * 24 * 60)

  const base: TemplateContext = { org, student, course, batch }

  switch (trigger) {
    case 'CLASS_REMINDER':
    case 'SESSION_STARTING':
      return {
        ...base,
        session: {
          title: 'Week 3 — Risk and Position Sizing',
          kind: t('liveSession.singular'),
          startAt: inMinutes(30),
          joinUrl: 'https://meet.example.com/week-3',
          location: null,
        },
      }

    case 'FEE_DUE':
    case 'FEE_OVERDUE':
      return {
        ...base,
        fee: {
          label: 'Installment 2 of 3',
          seq: 2,
          // Minor units, as everywhere: ₹12,500.00.
          amountMinor: 1_250_000,
          currency: org.currency,
          dueDate: trigger === 'FEE_DUE' ? inDays(3) : inDays(-2),
          payUrl: `${org.appUrl}/app/billing`,
        },
      }

    case 'ASSIGNMENT_DUE':
      return {
        ...base,
        assignment: {
          title: 'Trade Review — Week 3',
          dueAt: inDays(1),
          maxScore: 100,
          url: `${org.appUrl}/app/assignments/sample`,
        },
      }

    case 'ENROLLMENT_EXPIRING':
      return {
        ...base,
        enrollment: { expiresAt: inDays(7), percentComplete: 68 },
      }

    case 'CALENDAR_EVENT':
      return {
        ...base,
        event: {
          title: 'Alumni Meetup',
          startAt: inDays(1),
          location: 'Kochi',
          joinUrl: null,
        },
      }

    case 'DRIP_UNLOCKED':
      return {
        ...base,
        lesson: {
          title: 'Position Sizing in Practice',
          url: `${org.appUrl}/app/courses/foundation/lessons/sample`,
        },
      }

    default: {
      // A new scheduled trigger must bring its own sample, or the editor would
      // preview it against an empty context and every variable would look wrong.
      const exhaustive: never = trigger
      throw new Error(`No sample context for trigger: ${String(exhaustive)}`)
    }
  }
}
