'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { refreshOverdueAction } from '@/server/payments/actions'

/**
 * Re-derives OVERDUE from due dates on demand. This belongs on a schedule and the
 * function behind it is written for one; the button exists because the cron
 * entrypoints are not in this module's territory, and a job nobody can trigger is
 * worse than a button somebody has to press.
 */
export function RefreshOverdueButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await refreshOverdueAction()
            setError(result.ok ? null : (result.error ?? 'Could not refresh.'))
            if (result.ok) router.refresh()
          })
        }
      >
        {pending ? 'Refreshing…' : 'Refresh overdue'}
      </Button>
    </span>
  )
}
