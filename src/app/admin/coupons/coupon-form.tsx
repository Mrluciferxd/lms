'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/server/catalog/actions'

export interface CourseOption {
  id: string
  title: string
}

export interface CouponFormValues {
  code: string
  type: 'PERCENT' | 'FLAT'
  /** Percent as-is; a flat amount already converted to rupees for the form. */
  value: number
  maxRedemptions: number | null
  minOrder: number | null
  validFrom: string | null
  validTo: string | null
  courseIds: string[]
  active: boolean
}

export function CouponForm({
  action,
  initial,
  courses,
  submitLabel,
  onDone,
}: {
  action: (formData: FormData) => Promise<ActionResult>
  initial?: CouponFormValues
  courses: CourseOption[]
  submitLabel: string
  onDone?: () => void
}) {
  const [result, setResult] = useState<ActionResult | null>(null)
  const [type, setType] = useState<'PERCENT' | 'FLAT'>(initial?.type ?? 'PERCENT')
  const [pending, startTransition] = useTransition()

  function handleSubmit(formData: FormData): void {
    startTransition(async () => {
      const outcome = await action(formData)
      setResult(outcome)
      if (outcome.ok) onDone?.()
    })
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {result?.error && (
        <p role="alert" className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {result.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label="Code"
          name="code"
          required
          defaultValue={initial?.code}
          hint="Stored uppercase; students may type it either way."
          error={result?.fieldErrors?.code}
        />

        <div className="space-y-1.5">
          <label htmlFor="type" className="block text-sm font-medium text-content">
            Type
          </label>
          <select
            id="type"
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value as 'PERCENT' | 'FLAT')}
            className="w-full rounded-brand border border-surface-border bg-surface px-3 py-2 text-sm text-content"
          >
            <option value="PERCENT">Percentage off</option>
            <option value="FLAT">Fixed amount off</option>
          </select>
        </div>

        <Input
          label={type === 'PERCENT' ? 'Discount (%)' : 'Discount (₹)'}
          name="value"
          type="number"
          min={type === 'PERCENT' ? 1 : 0.01}
          max={type === 'PERCENT' ? 100 : undefined}
          step={type === 'PERCENT' ? 1 : '0.01'}
          required
          defaultValue={initial?.value ?? ''}
          error={result?.fieldErrors?.value}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Maximum redemptions"
          name="maxRedemptions"
          type="number"
          min={1}
          defaultValue={initial?.maxRedemptions ?? ''}
          hint="Blank = unlimited. Counted when an order is paid, not when it is opened."
        />
        <Input
          label="Minimum order (₹)"
          name="minOrder"
          type="number"
          min={0}
          step="0.01"
          defaultValue={initial?.minOrder ?? ''}
          hint="Blank = no minimum."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Valid from"
          name="validFrom"
          type="datetime-local"
          defaultValue={initial?.validFrom ?? ''}
        />
        <Input
          label="Valid until"
          name="validTo"
          type="datetime-local"
          defaultValue={initial?.validTo ?? ''}
          error={result?.fieldErrors?.validTo}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-content">Applies to</legend>
        <p className="text-xs text-content-muted">
          Select nothing to apply the code to every course.
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {courses.map((course) => (
            <label key={course.id} className="flex items-center gap-2 text-sm text-content">
              <input
                type="checkbox"
                name="courseIds"
                value={course.id}
                defaultChecked={initial?.courseIds.includes(course.id)}
              />
              {course.title}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm text-content">
        <input type="checkbox" name="active" defaultChecked={initial?.active ?? true} />
        Active
      </label>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        {onDone && (
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
