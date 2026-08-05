'use client'

import { useState, useTransition } from 'react'

import {
  closeJournalEntry,
  reopenJournalEntry,
  type ActionResult,
} from '@/server/journals/actions'
import type { JournalEntryStatus } from '@/generated/prisma/enums'

interface LifecycleButtonsProps {
  entryId: string
  status: JournalEntryStatus
}

export function LifecycleButtons({ entryId, status }: LifecycleButtonsProps) {
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState<'close' | 'reopen' | null>(null)
  const [latestStatus, setLatestStatus] = useState<JournalEntryStatus>(status)

  function closeIt() {
    setBusy('close')
    startTransition(async () => {
      const result: ActionResult = await closeJournalEntry({ entryId })
      if (result.ok) setLatestStatus('CLOSED')
      setBusy(null)
    })
  }

  function reopenIt() {
    setBusy('reopen')
    startTransition(async () => {
      const result: ActionResult = await reopenJournalEntry({ entryId })
      if (result.ok) setLatestStatus('OPEN')
      setBusy(null)
    })
  }

  if (latestStatus === 'OPEN') {
    return (
      <button
        type="button"
        disabled={busy === 'close'}
        onClick={closeIt}
        className="rounded-brand border border-surface-border px-4 py-1.5 text-sm text-content-muted hover:bg-surface-muted disabled:opacity-50"
      >
        {busy === 'close' ? '…' : 'Close'}
      </button>
    )
  }

  return (
    <button
      type="button"
      disabled={busy === 'reopen'}
      onClick={reopenIt}
      className="rounded-brand border border-surface-border px-4 py-1.5 text-sm text-content-muted hover:bg-surface-muted disabled:opacity-50"
    >
      {busy === 'reopen' ? '…' : 'Reopen'}
    </button>
  )
}
