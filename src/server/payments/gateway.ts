/**
 * Payment gateway contract and resolution.
 *
 * Same shape as the video provider registry in src/server/media/index.ts: the
 * brand config names the gateway (`integrations.payments`) and this maps that to
 * an adapter, so no calling code names a vendor and switching a client from
 * Razorpay to Stripe is one adapter plus a config line.
 *
 * The adapter surface is deliberately small. Everything that can be done without
 * the vendor — pricing, coupon rules, numbering, idempotency, reconciliation —
 * is done without the vendor, so the parts that need credentials to test are the
 * two that genuinely cannot be tested any other way: creating a gateway order and
 * verifying its signatures.
 */

import { brand } from '@/lib/brand'
import type { PaymentGateway } from '@/generated/prisma/enums'
import type { BrandIntegrations } from '@/lib/brand/types'

export interface GatewayOrderInput {
  /** Our Order.id, sent as a note so the gateway dashboard is cross-referenced. */
  orderId: string
  /** Our human-readable Order.number, used as the gateway receipt. */
  number: string
  amountMinor: number
  currency: string
  notes: Record<string, string>
}

export interface GatewayOrder {
  gatewayOrderId: string
  amountMinor: number
  currency: string
  /**
   * Publishable key the browser needs to open the gateway's checkout widget.
   * Null when the gateway has no browser step (manual settlement).
   */
  publicKey: string | null
}

export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'PaymentGatewayError'
  }
}

export interface PaymentGatewayAdapter {
  key: PaymentGateway
  name: string
  /** Checked before use and reported in the admin setup checklist. */
  requiredEnv: readonly string[]
  /**
   * Whether the browser completes payment through a hosted widget. False means
   * the order is recorded and settled by staff, and no client-side flow exists.
   */
  hasBrowserCheckout: boolean

  createOrder(input: GatewayOrderInput): Promise<GatewayOrder>

  /** Verifies the signature the checkout widget returns to the browser. */
  verifyCheckoutCallback(input: {
    gatewayOrderId: string
    gatewayPaymentId: string
    signature: string | null
  }): boolean
}

/** brand.integrations.payments → PaymentGateway enum. */
const BRAND_TO_GATEWAY: Record<BrandIntegrations['payments'], PaymentGateway> = {
  razorpay: 'RAZORPAY',
  stripe: 'STRIPE',
  manual: 'MANUAL',
}

export function configuredGateway(): PaymentGateway {
  return BRAND_TO_GATEWAY[brand.integrations.payments]
}

/**
 * Registry of adapters that exist. Stripe is absent rather than stubbed, for the
 * same reason the media registry omits Mux: an adapter that throws at checkout
 * time is worse than a resolution error naming the gap.
 *
 * Populated by ./index.ts to keep this module free of adapter imports — the
 * Razorpay adapter pulls in the vendor SDK, and the brand-neutral contract should
 * not drag that into every consumer.
 */
const ADAPTERS = new Map<PaymentGateway, PaymentGatewayAdapter>()

export function registerGateway(adapter: PaymentGatewayAdapter): void {
  ADAPTERS.set(adapter.key, adapter)
}

export function registeredGateways(): PaymentGatewayAdapter[] {
  return [...ADAPTERS.values()]
}

/** Env vars an adapter declares but this deployment has not set. */
export function missingGatewayEnv(adapter: PaymentGatewayAdapter): string[] {
  return adapter.requiredEnv.filter((name) => !process.env[name])
}

/**
 * The adapter this deployment takes money through.
 *
 * In development, a brand configured for Razorpay without credentials falls back
 * to the manual adapter rather than failing at import time — otherwise nobody can
 * work on checkout until the client provisions their merchant account, which is
 * exactly the dependency the manual adapter exists to break. Never falls back in
 * production: silently not charging anybody is the worst possible outcome.
 */
export function resolveGateway(): PaymentGatewayAdapter {
  const configured = configuredGateway()
  const adapter = ADAPTERS.get(configured)

  if (!adapter) {
    throw new PaymentGatewayError(
      `Brand "${brand.key}" is configured for payment gateway "${brand.integrations.payments}", which has no adapter yet. Implemented: ${[...ADAPTERS.keys()].join(', ')}.`,
    )
  }

  const missing = missingGatewayEnv(adapter)
  if (missing.length === 0) return adapter

  if (process.env.NODE_ENV === 'production') {
    throw new PaymentGatewayError(
      `${adapter.name} is missing ${missing.join(', ')}. Configure it or change integrations.payments.`,
    )
  }

  const fallback = ADAPTERS.get('MANUAL')
  if (!fallback) {
    throw new PaymentGatewayError(`${adapter.name} is missing ${missing.join(', ')}.`)
  }

  console.warn(
    `[payments] ${adapter.name} is missing ${missing.join(', ')} — falling back to manual settlement for development.`,
  )
  return fallback
}
