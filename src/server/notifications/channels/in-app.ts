/**
 * In-app channel adapter.
 *
 * The only fully implemented channel, and the one that needs no provider: the
 * `Notification` row the scheduler already inserted *is* the message. Delivery is
 * therefore the transition to SENT, which the worker performs for every channel
 * anyway — so this adapter has nothing left to do but say so.
 *
 * It exists rather than being special-cased in the worker because a branch on
 * `channel === 'IN_APP'` inside the delivery loop is how a second one appears
 * later, and then a third. One interface, five implementations.
 */

import type { ChannelAdapter, DeliveryOutcome } from '../types'

export const inAppAdapter: ChannelAdapter = {
  channel: 'IN_APP',
  provider: 'in-app',
  live: true,

  async send(): Promise<DeliveryOutcome> {
    return { ok: true }
  },
}
