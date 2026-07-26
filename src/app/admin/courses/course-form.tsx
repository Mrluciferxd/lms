'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/server/catalog/actions'

export function CourseForm({
  action,
  initial,
  submitLabel,
  onSaved,
}: {
  action: (formData: FormData) => Promise<ActionResult>
  initial?: {
    title: string
    slug: string
    subtitle: string | null
    description: string | null
    status: string
    priceMinor: number | null
    accessDurationDays: number | null
  }
  submitLabel: string
  /** Where to go after a successful create. */
  onSaved?: (id: string | undefined) => void
}) {
  const router = useRouter()
  const [result, setResult] = useState<ActionResult | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const outcome = await action(formData)
      setResult(outcome)
      if (outcome.ok) {
        onSaved?.(outcome.id)
        router.refresh()
      }
    })
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {result?.error && (
        <p role="alert" className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {result.error}
        </p>
      )}
      {result?.ok && !onSaved && (
        <p role="status" className="rounded-brand border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          Saved.
        </p>
      )}

      <Input
        label="Title"
        name="title"
        required
        defaultValue={initial?.title}
        error={result?.fieldErrors?.title}
      />

      <Input
        label="URL slug"
        name="slug"
        defaultValue={initial?.slug}
        hint="Leave blank to generate from the title."
        error={result?.fieldErrors?.slug}
      />

      <Input label="Subtitle" name="subtitle" defaultValue={initial?.subtitle ?? ''} />

      <div className="space-y-1.5">
        <label htmlFor="description" className="block text-sm font-medium text-content">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          defaultValue={initial?.description ?? ''}
          className="w-full rounded-brand border border-surface-border bg-surface px-3 py-2 text-sm text-content"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="status" className="block text-sm font-medium text-content">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={initial?.status ?? 'DRAFT'}
            className="w-full rounded-brand border border-surface-border bg-surface px-3 py-2 text-sm text-content"
          >
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>

        <Input
          label="Price (₹)"
          name="price"
          type="number"
          min={0}
          step="0.01"
          // Stored as paise; shown as rupees.
          defaultValue={initial?.priceMinor != null ? initial.priceMinor / 100 : ''}
          hint="Blank = not directly purchasable"
        />

        <Input
          label="Access days"
          name="accessDurationDays"
          type="number"
          min={1}
          defaultValue={initial?.accessDurationDays ?? ''}
          hint="Blank = lifetime"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}
