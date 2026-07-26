'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

/**
 * Opens the gateway's hosted checkout for one fee installment.
 *
 * Three things this deliberately does not do:
 *
 *  - It does not know the amount. The server prices the installment; this only
 *    names which one, and displays whatever comes back.
 *  - It does not treat the widget's success callback as payment. The callback is
 *    posted to /api/checkout/verify, which checks the signature server-side, and
 *    the webhook remains the authority if the browser never gets that far.
 *  - It does not preload the gateway script. A student with nothing due should
 *    not be shipped a third-party payment script at all, so it is fetched on the
 *    first click.
 */

interface CheckoutSessionResponse {
  orderId: string
  number: string
  amountMinor: number
  currency: string
  gatewayOrderId: string
  publicKey: string | null
  hasBrowserCheckout: boolean
  description: string
}

interface CheckoutHandlerResponse {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

interface CheckoutWidget {
  open(): void
}

interface CheckoutConstructor {
  new (options: Record<string, unknown>): CheckoutWidget
}

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

function loadCheckoutScript(): Promise<CheckoutConstructor> {
  const existing = (window as unknown as { Razorpay?: CheckoutConstructor }).Razorpay
  if (existing) return Promise.resolve(existing)

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => {
      const loaded = (window as unknown as { Razorpay?: CheckoutConstructor }).Razorpay
      if (loaded) resolve(loaded)
      else reject(new Error('The payment widget did not initialise.'))
    }
    script.onerror = () => reject(new Error('Could not reach the payment provider.'))
    document.head.append(script)
  })
}

export function PayInstallmentButton({
  installmentId,
  label,
  studentName,
  studentEmail,
}: {
  installmentId: string
  label: string
  studentName: string
  studentEmail: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function pay(): Promise<void> {
    setBusy(true)
    setMessage(null)

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'INSTALLMENT', installmentId }),
      })

      const payload = (await response.json()) as CheckoutSessionResponse & { error?: string }
      if (!response.ok) {
        setMessage(payload.error ?? 'We could not start this payment.')
        return
      }

      if (!payload.hasBrowserCheckout || !payload.publicKey) {
        // A deployment that settles manually still records the order, so tell the
        // student it exists rather than leaving them on a dead button.
        setMessage(
          `Order ${payload.number} has been raised. Your academy will confirm it once payment is received.`,
        )
        router.refresh()
        return
      }

      const Checkout = await loadCheckoutScript()

      const widget = new Checkout({
        key: payload.publicKey,
        order_id: payload.gatewayOrderId,
        amount: payload.amountMinor,
        currency: payload.currency,
        name: payload.description,
        prefill: { name: studentName, email: studentEmail ?? undefined },
        handler: (result: CheckoutHandlerResponse) => {
          void confirm(payload.orderId, result)
        },
        modal: {
          ondismiss: () => {
            setBusy(false)
            setMessage('Payment cancelled. The order is still open if you want to try again.')
          },
        },
      })

      widget.open()
      return
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm(orderId: string, result: CheckoutHandlerResponse): Promise<void> {
    setBusy(true)
    try {
      const response = await fetch('/api/checkout/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          razorpayOrderId: result.razorpay_order_id,
          razorpayPaymentId: result.razorpay_payment_id,
          razorpaySignature: result.razorpay_signature,
        }),
      })

      if (response.ok) {
        setMessage(null)
        router.refresh()
        return
      }

      // The webhook is still the authority, so a failure here is a display
      // problem rather than a lost payment — say so instead of alarming them.
      setMessage('Payment received. It may take a moment to appear here.')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" disabled={busy} onClick={() => void pay()}>
        {busy ? 'Opening…' : label}
      </Button>
      {message && (
        <span role="status" className="max-w-xs text-right text-xs text-content-muted">
          {message}
        </span>
      )}
    </span>
  )
}
