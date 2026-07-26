'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { deleteBatch } from '@/server/batches/actions'

/**
 * Two-step, because the server refuses to delete a batch with any history and
 * the useful outcome of pressing this is usually the explanation of why not.
 */
export function DeleteBatchButton({ batchId, name }: { batchId: string; name: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function remove() {
    startTransition(async () => {
      const result = await deleteBatch(batchId)
      if (result.ok) router.push('/admin/batches')
      else setError(result.error ?? 'Something went wrong.')
    })
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-content">Delete {name}?</span>
          <Button variant="danger" size="sm" disabled={pending} onClick={remove}>
            {pending ? 'Deleting…' : 'Yes, delete'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirming(true)}>
          Delete batch
        </Button>
      )}
    </div>
  )
}
