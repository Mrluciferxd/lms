/**
 * Payments entry point.
 *
 * Importing this module is what populates the gateway registry — each adapter
 * registers itself on import, and `resolveGateway` cannot find one that nobody
 * imported. Every consumer inside the payments domain goes through here rather
 * than importing an adapter by name, which is what keeps a vendor's name out of
 * the call sites.
 */

import './manual'
import './razorpay'

export {
  PaymentGatewayError,
  configuredGateway,
  missingGatewayEnv,
  registeredGateways,
  resolveGateway,
  type GatewayOrder,
  type PaymentGatewayAdapter,
} from './gateway'
export { verifyRazorpayWebhook } from './razorpay'
export { PaymentConfigError } from './signature'
