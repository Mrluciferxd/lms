'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { cancelOrder } from '@/server/payments/actions'

/**
 * Cancelling is deliberately not deleting: an abandoned checkout is a real event,
 * and reconciliation needs to tell "never attempted" from "never happened".
 */
export function OrderActions({
  orderId,
  cancellable,
}: {
  orderId: string
  cancellable: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!cancellable) return null

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await cancelOrder(orderId)
            setError(result.ok ? null : (result.error ?? 'Could not cancel this order.'))
            if (result.ok) router.refresh()
          })
        }
      >
        {pending ? 'Cancelling…' : 'Cancel this order'}
      </Button>
    </div>
  )
}
