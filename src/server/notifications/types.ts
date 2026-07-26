/**
 * The channel adapter contract.
 *
 * One interface for five channels that have nothing technically in common, for
 * the same reason ../media/index.ts has one for video providers: no calling code
 * should name a vendor, and swapping MSG91 for Twilio should be a brand-config
 * edit rather than a change to the worker.
 */

import type { NotificationChannelType } from '@/generated/prisma/enums'

export interface OutboundRecipient {
  userId: string
  name: string
  email: string | null
  phone: string | null
}

export interface OutboundMessage {
  notificationId: string
  channel: NotificationChannelType
  recipient: OutboundRecipient
  subject: string | null
  body: string
  actionUrl: string | null
}

/**
 * `retryable` is the adapter's judgement, not the worker's. Only the adapter
 * knows whether a 400 from its provider means "try later" or "this will never
 * work"; see ./retry.ts for what the worker does with the answer.
 */
export type DeliveryOutcome =
  | { ok: true; providerMessageId?: string | null }
  | { ok: false; retryable: boolean; error: string }

export interface ChannelAdapter {
  channel: NotificationChannelType
  /** Provider named by the brand config: "resend", "meta-cloud", "msg91". */
  provider: string
  /**
   * False for adapters that only record what they would have sent. Surfaced in
   * the admin delivery log so nobody reads a green SENT row as proof that a
   * message left the building.
   */
  live: boolean
  requiredEnv?: readonly string[]
  send(message: OutboundMessage): Promise<DeliveryOutcome>
}
