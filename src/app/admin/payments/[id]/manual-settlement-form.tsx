'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { settleOrderManually } from '@/server/payments/actions'
import type { ActionResult } from '@/server/catalog/actions'

/**
 * Marks an order paid outside the gateway — a bank transfer, a cheque, cash at
 * the desk. The amount is not editable: it is the order total, and settling an
 * order for a different figure than the one it records is the mismatch the
 * reconciliation view exists to surface, not something to offer as a field.
 */
export function ManualSettlementForm({
  orderId,
  amountLabel,
}: {
  orderId: string
  amountLabel: string
}) {
  const router = useRouter()
  const [result, setResult] = useState<ActionResult | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(formData: FormData): void {
    startTransition(async () => {
      const outcome = await settleOrderManually(orderId, formData)
      setResult(outcome)
      if (outcome.ok) router.refresh()
    })
  }

  return (
    <form action={handleSubmit} className="space-y-4 rounded-brand border border-surface-border p-4">
      <div>
        <h3 className="text-sm font-semibold text-content">Record a payment received outside the gateway</h3>
        <p className="mt-1 text-xs text-content-muted">
          Settles this order for {amountLabel}, enrolls the student and issues an invoice — the same
          path a gateway payment takes.
        </p>
      </div>

      {result?.error && (
        <p role="alert" className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {result.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Reference"
          name="reference"
          required
          hint="UTR, cheque number or receipt. Entering the same one twice updates one payment."
          error={result?.fieldErrors?.reference}
        />
        <Input label="Method" name="method" placeholder="bank_transfer" defaultValue="bank_transfer" />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Recording…' : 'Mark as paid'}
      </Button>
    </form>
  )
}
