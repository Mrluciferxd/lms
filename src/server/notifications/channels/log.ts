/**
 * Logging channel adapter.
 *
 * No provider SDK is installed for email, SMS, WhatsApp or push — none of those
 * accounts exist yet, and the client owns the WhatsApp Business and MSG91
 * subscriptions per the proposal. Rather than stub a half-adapter that throws at
 * send time, or worse one that returns success without doing anything, every
 * external channel resolves to this: it records exactly what would have gone out,
 * through which vendor, to which address, and reports `live: false` so the admin
 * delivery log can say so on every row.
 *
 * The real adapters replace this one file at a time. Because the worker only
 * knows `ChannelAdapter`, wiring Resend is a new module plus one line in
 * ./index.ts — no change to rendering, scheduling, dedupe or retry.
 */

import type { ChannelAdapter, DeliveryOutcome, OutboundMessage } from '../types'
import type { NotificationChannelType } from '@/generated/prisma/enums'

/** The recipient field each channel needs before a real provider could be called. */
const ADDRESS: Partial<Record<NotificationChannelType, 'email' | 'phone'>> = {
  EMAIL: 'email',
  SMS: 'phone',
  WHATSAPP: 'phone',
}

export function createLoggingAdapter(
  channel: NotificationChannelType,
  provider: string,
  requiredEnv: readonly string[] = [],
): ChannelAdapter {
  return {
    channel,
    provider,
    live: false,
    requiredEnv,

    async send(message: OutboundMessage): Promise<DeliveryOutcome> {
      const addressField = ADDRESS[channel]
      const address = addressField ? message.recipient[addressField] : null

      // Checked even though nothing is sent: a missing address is a permanent
      // failure whichever adapter is installed, and catching it here means the
      // delivery log already shows which students cannot be reached before the
      // client has paid for a gateway.
      if (addressField && !address) {
        return {
          ok: false,
          retryable: false,
          error: `Recipient has no ${addressField} on file.`,
        }
      }

      console.info(
        `[notify:${channel}] via ${provider} (not wired) → ${address ?? message.recipient.userId}` +
          `${message.subject ? ` | ${message.subject}` : ''} | ${message.body.replace(/\n/g, ' ⏎ ')}`,
      )

      return { ok: true, providerMessageId: null }
    },
  }
}
