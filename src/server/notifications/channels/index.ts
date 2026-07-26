/**
 * Channel resolution.
 *
 * The brand config names the providers; this maps them to adapters. Same
 * registry indirection as ../../media/index.ts and ../../../packs/registry.ts —
 * core never names a vendor.
 *
 * A channel with no provider declared is UNAVAILABLE, not merely unconfigured.
 * `demo-academy` declares no SMS, WhatsApp or push, so a rule inherited from a
 * pack that lists all five channels queues two rows there, not five. Queueing a
 * WhatsApp message on a deployment with no WhatsApp account produces a row that
 * can only ever end FAILED, and a delivery log full of those is a log nobody
 * reads.
 */

import { brand } from '@/lib/brand'
import { inAppAdapter } from './in-app'
import { createLoggingAdapter } from './log'
import type { ChannelAdapter } from '../types'
import type { NotificationChannelType } from '@/generated/prisma/enums'

/**
 * Env each provider needs before a real adapter could work. Mirrors the mapping
 * in src/env.ts, which drives the admin setup checklist; kept here too so the
 * delivery log can explain a channel that is declared but unusable.
 */
const PROVIDER_ENV: Record<string, readonly string[]> = {
  resend: ['RESEND_API_KEY', 'EMAIL_FROM'],
  ses: ['AWS_SES_REGION', 'EMAIL_FROM'],
  smtp: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM'],
  msg91: ['MSG91_AUTH_KEY', 'MSG91_SENDER_ID'],
  twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
  'meta-cloud': ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'],
  gupshup: ['GUPSHUP_API_KEY', 'GUPSHUP_SOURCE_NUMBER'],
  webpush: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
  fcm: ['FCM_SERVICE_ACCOUNT_JSON'],
}

/** Which brand integration supplies each external channel. */
function providerFor(channel: NotificationChannelType): string | null {
  switch (channel) {
    case 'EMAIL':
      return brand.integrations.email
    case 'SMS':
      return brand.integrations.sms ?? null
    case 'WHATSAPP':
      return brand.integrations.whatsapp ?? null
    case 'PUSH':
      return brand.integrations.push ?? null
    case 'IN_APP':
      return 'in-app'
    default: {
      const exhaustive: never = channel
      throw new Error(`Unhandled notification channel: ${String(exhaustive)}`)
    }
  }
}

/**
 * The adapter for a channel, or null when this deployment has no provider for it.
 *
 * Every external channel currently resolves to the logging adapter. That is a
 * deliberate, visible gap rather than a pretence: see ./log.ts.
 */
export function resolveChannelAdapter(
  channel: NotificationChannelType,
): ChannelAdapter | null {
  if (channel === 'IN_APP') return inAppAdapter

  const provider = providerFor(channel)
  if (!provider) return null

  return createLoggingAdapter(channel, provider, PROVIDER_ENV[provider] ?? [])
}

/** Channels this deployment can queue for. Used to filter a rule's channel list. */
export function availableChannels(): NotificationChannelType[] {
  const all: NotificationChannelType[] = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP']
  return all.filter((channel) => resolveChannelAdapter(channel) !== null)
}

export interface ChannelStatus {
  channel: NotificationChannelType
  provider: string | null
  available: boolean
  live: boolean
  missingEnv: string[]
}

/** Per-channel readiness, for the admin console. */
export function channelStatuses(): ChannelStatus[] {
  const all: NotificationChannelType[] = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP']

  return all.map((channel) => {
    const adapter = resolveChannelAdapter(channel)
    return {
      channel,
      provider: adapter?.provider ?? null,
      available: adapter !== null,
      live: adapter?.live ?? false,
      missingEnv: (adapter?.requiredEnv ?? []).filter((name) => !process.env[name]),
    }
  })
}
