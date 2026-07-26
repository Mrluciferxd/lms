/**
 * Manual settlement "gateway".
 *
 * Two real jobs, not a stub:
 *
 *  1. Brands whose `integrations.payments` is `manual` — an academy that takes
 *     bank transfers and cash at the desk still needs orders, invoices, coupons
 *     and fee schedules. Everything works; staff mark the order paid from
 *     /admin/payments once the money lands.
 *
 *  2. Development against a Razorpay brand with no credentials. `resolveGateway`
 *     falls back here so checkout is exercisable end to end without a merchant
 *     account, and it says so in the log rather than pretending to have charged
 *     anybody.
 *
 * It never claims a payment succeeded. `verifyCheckoutCallback` always returns
 * false, because there is no signature it could be verifying — a manual gateway
 * that accepted an unsigned "I paid" callback would be a free-enrollment button.
 */

import { randomUUID } from 'node:crypto'

import { registerGateway, type GatewayOrder, type GatewayOrderInput, type PaymentGatewayAdapter } from './gateway'

export const manualGateway: PaymentGatewayAdapter = {
  key: 'MANUAL',
  name: 'Manual settlement',
  requiredEnv: [],
  hasBrowserCheckout: false,

  async createOrder(input: GatewayOrderInput): Promise<GatewayOrder> {
    console.info(
      `[payments:manual] order ${input.number} recorded for ${input.amountMinor} ${input.currency} minor units. No payment was requested — settle it from /admin/payments.`,
    )

    return {
      // Prefixed so a manual reference is never mistaken for a gateway id during
      // reconciliation.
      gatewayOrderId: `manual_${randomUUID()}`,
      amountMinor: input.amountMinor,
      currency: input.currency,
      publicKey: null,
    }
  },

  verifyCheckoutCallback(): boolean {
    return false
  },
}

registerGateway(manualGateway)
