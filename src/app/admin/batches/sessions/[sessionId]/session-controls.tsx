'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { deleteLiveSession, setSessionStatus } from '@/server/sessions/actions'
import type { SessionStatus } from '@/generated/prisma/enums'

/**
 * Lifecycle buttons. "End" is more consequential than it looks: an AFTER_SESSION
 * lesson unlocks when its gate session has ended, so this is what releases
 * content to a cohort.
 */
export function SessionControls({
  sessionId,
  status,
  gatedLessonCount,
}: {
  sessionId: string
  status: SessionStatus
  gatedLessonCount: number
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  function change(next: SessionStatus) {
    startTransition(async () => {
      const result = await setSessionStatus(sessionId, next)
      setError(result.ok ? null : (result.error ?? 'Something went wrong.'))
      if (result.ok) router.refresh()
    })
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteLiveSession(sessionId)
      if (result.ok) router.push('/admin/batches/sessions')
      else setError(result.error ?? 'Something went wrong.')
    })
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {status !== 'LIVE' && status !== 'ENDED' && (
          <Button size="sm" disabled={pending} onClick={() => change('LIVE')}>
            Start
          </Button>
        )}
        {status === 'LIVE' && (
          <Button size="sm" disabled={pending} onClick={() => change('ENDED')}>
            End
          </Button>
        )}
        {status === 'ENDED' && (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => change('LIVE')}>
            Reopen
          </Button>
        )}
        {status !== 'CANCELLED' ? (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => change('CANCELLED')}>
            Cancel session
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => change('SCHEDULED')}
          >
            Reinstate
          </Button>
        )}
      </div>

      {gatedLessonCount > 0 && (
        <p className="text-xs text-warning">
          {gatedLessonCount} lesson(s) unlock when this session ends.
        </p>
      )}

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-content">Delete this session?</span>
          <Button variant="danger" size="sm" disabled={pending} onClick={remove}>
            {pending ? 'Deleting…' : 'Yes, delete'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirming(true)}>
          Delete session
        </Button>
      )}
    </div>
  )
}
