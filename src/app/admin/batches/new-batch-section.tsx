'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { t } from '@/lib/labels'
import type { ActionResult } from '@/server/catalog/actions'
import { BatchForm, type Option } from './batch-form'

/** Collapsed by default so the list stays the focus. */
export function NewBatchSection({
  action,
  courses,
  instructors,
}: {
  action: (formData: FormData) => Promise<ActionResult>
  courses: Option[]
  instructors: Option[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={courses.length === 0}>
        New {t('batch.singular').toLowerCase()}
      </Button>
    )
  }

  return (
    <section
      aria-labelledby="new-batch-heading"
      className="space-y-4 rounded-brand border border-surface-border p-4"
    >
      <div className="flex items-center justify-between">
        <h2 id="new-batch-heading" className="text-sm font-semibold text-content">
          New {t('batch.singular').toLowerCase()}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      <BatchForm
        action={action}
        courses={courses}
        instructors={instructors}
        submitLabel={`Create ${t('batch.singular').toLowerCase()}`}
        onSaved={(id) => {
          if (id) router.push(`/admin/batches/${id}`)
        }}
      />
    </section>
  )
}
