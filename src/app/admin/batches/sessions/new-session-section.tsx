'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { t } from '@/lib/labels'
import type { ActionResult } from '@/server/catalog/actions'
import { SessionForm, type SessionOption } from './session-form'

export function NewSessionSection({
  action,
  batches,
  courses,
  hosts,
  defaultStart,
}: {
  action: (formData: FormData) => Promise<ActionResult>
  batches: SessionOption[]
  courses: SessionOption[]
  hosts: SessionOption[]
  defaultStart: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        New {t('liveSession.singular').toLowerCase()}
      </Button>
    )
  }

  return (
    <section
      aria-labelledby="new-session-heading"
      className="space-y-4 rounded-brand border border-surface-border p-4"
    >
      <div className="flex items-center justify-between">
        <h2 id="new-session-heading" className="text-sm font-semibold text-content">
          New {t('liveSession.singular').toLowerCase()}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      <SessionForm
        action={action}
        batches={batches}
        courses={courses}
        hosts={hosts}
        initial={{
          kind: 'CLASS',
          title: '',
          description: null,
          batchId: null,
          courseId: null,
          hostId: null,
          scheduledStart: defaultStart,
          scheduledEnd: '',
          mode: 'ONLINE',
          visibility: 'BATCH',
          status: 'SCHEDULED',
          location: null,
          joinUrl: null,
          streamProvider: null,
          hasStreamKey: false,
          recordingAssetId: null,
          tracksAttendance: true,
          capacity: null,
        }}
        submitLabel={`Create ${t('liveSession.singular').toLowerCase()}`}
        onSaved={(id) => {
          if (id) router.push(`/admin/batches/sessions/${id}`)
        }}
      />
    </section>
  )
}
