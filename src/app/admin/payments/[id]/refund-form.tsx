'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { recordRefundAction } from '@/server/payments/actions'
import type { ActionResult } from '@/server/catalog/actions'

export interface RefundablePayment {
  id: string
  reference: string
  refundableMinor: number
  refundableLabel: string
}

/**
 * Records a refund against a captured payment.
 *
 * This is bookkeeping: the money is reversed in the gateway dashboard, and this
 * makes our ledger agree. Refunds Razorpay reports through `refund.processed`
 * reconcile themselves, so this form is for the ones that never produce a
 * webhook — bank transfers, cash, and anything done before the integration is
 * live.
 */
export function RefundForm({
  orderId,
  payments,
}: {
  orderId: string
  payments: RefundablePayment[]
}) {
  const router = useRouter()
  const [result, setResult] = useState<ActionResult | null>(null)
  const [selected, setSelected] = useState(payments[0]?.id ?? '')
  const [pending, startTransition] = useTransition()

  const payment = payments.find((candidate) => candidate.id === selected) ?? payments[0]

  function handleSubmit(formData: FormData): void {
    startTransition(async () => {
      const outcome = await recordRefundAction(orderId, formData)
      setResult(outcome)
      if (outcome.ok) router.refresh()
    })
  }

  return (
    <form action={handleSubmit} className="space-y-4 rounded-brand border border-surface-border p-4">
      <div>
        <h3 className="text-sm font-semibold text-content">Record a refund</h3>
        <p className="mt-1 text-xs text-content-muted">
          Reverse the payment in the gateway first. This records it so the books match.
        </p>
      </div>

      {result?.error && (
        <p role="alert" className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <p role="status" className="rounded-brand border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          Refund recorded.
        </p>
      )}

      <div className="space-y-1.5">
        <label htmlFor="paymentId" className="block text-sm font-medium text-content">
          Payment
        </label>
        <select
          id="paymentId"
          name="paymentId"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className="w-full rounded-brand border border-surface-border bg-surface px-3 py-2 text-sm text-content"
        >
          {payments.map((option) => (
            <option key={option.id} value={option.id}>
              {option.reference} — {option.refundableLabel} refundable
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Amount (₹)"
          name="amount"
          type="number"
          min={0.01}
          step="0.01"
          // Defaulted to the full refundable amount, which is the common case, and
          // capped so a typo cannot ask for more than was captured.
          max={payment ? payment.refundableMinor / 100 : undefined}
          defaultValue={payment ? payment.refundableMinor / 100 : ''}
          required
          error={result?.fieldErrors?.amount}
        />
        <Input
          label="Gateway refund id"
          name="gatewayRefundId"
          placeholder="rfnd_…"
          hint="Optional. Helps reconcile against the gateway later."
        />
      </div>

      <Input label="Reason" name="reason" placeholder="Withdrew before the batch started" />

      <label className="flex items-start gap-2 text-sm text-content">
        <input type="checkbox" name="cancelEnrollments" className="mt-1" />
        <span>
          Also cancel this student&rsquo;s enrollment
          <span className="block text-xs text-content-muted">
            Leave unchecked for a partial or goodwill refund — cancelling removes their access
            immediately.
          </span>
        </span>
      </label>

      <Button type="submit" variant="danger" disabled={pending || payments.length === 0}>
        {pending ? 'Recording…' : 'Record refund'}
      </Button>
    </form>
  )
}
