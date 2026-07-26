'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t } from '@/lib/labels'
import type { ActionResult } from '@/server/catalog/actions'

export interface BatchFormValues {
  courseId: string
  name: string
  code: string
  description: string | null
  status: string
  /** `YYYY-MM-DD` in the org timezone. */
  startDate: string
  endDate: string
  capacity: number | null
  instructorId: string | null
  rrule: string
  startTime: string
  durationMin: number | null
}

export interface Option {
  id: string
  label: string
}

const STATUSES = [
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'ENROLLING', label: 'Enrolling' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const

const SELECT_CLASS =
  'w-full rounded-brand border border-surface-border bg-surface px-3 py-2 text-sm text-content'

export function BatchForm({
  action,
  courses,
  instructors,
  initial,
  submitLabel,
  onSaved,
}: {
  action: (formData: FormData) => Promise<ActionResult>
  courses: Option[]
  instructors: Option[]
  initial?: BatchFormValues
  submitLabel: string
  onSaved?: (id: string | undefined) => void
}) {
  const router = useRouter()
  const [result, setResult] = useState<ActionResult | null>(null)
  const [pending, startTransition] = useTransition()
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')

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

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={`${t('batch.singular')} name`}
          name="name"
          required
          defaultValue={initial?.name}
          error={result?.fieldErrors?.name}
        />
        <Input
          label="Code"
          name="code"
          required
          defaultValue={initial?.code}
          hint="Unique, e.g. FX-2026-01. Stored uppercase."
          error={result?.fieldErrors?.code}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="courseId" className="block text-sm font-medium text-content">
            {t('course.singular')}
          </label>
          <select
            id="courseId"
            name="courseId"
            required
            defaultValue={initial?.courseId ?? ''}
            className={SELECT_CLASS}
          >
            <option value="">Select a course…</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.label}
              </option>
            ))}
          </select>
          {result?.fieldErrors?.courseId && (
            <p className="text-xs text-danger">{result.fieldErrors.courseId}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="status" className="block text-sm font-medium text-content">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={initial?.status ?? 'UPCOMING'}
            className={SELECT_CLASS}
          >
            {STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="description" className="block text-sm font-medium text-content">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={initial?.description ?? ''}
          className={SELECT_CLASS}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label="Start date"
          name="startDate"
          type="date"
          required
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          error={result?.fieldErrors?.startDate}
          hint={
            initial && initial.startDate !== startDate
              ? 'Moving this re-anchors every drip lesson set to release after the batch start.'
              : undefined
          }
        />
        <Input
          label="End date"
          name="endDate"
          type="date"
          defaultValue={initial?.endDate ?? ''}
          error={result?.fieldErrors?.endDate}
          hint="Blank = open-ended"
        />
        <Input
          label="Capacity"
          name="capacity"
          type="number"
          min={1}
          defaultValue={initial?.capacity ?? ''}
          error={result?.fieldErrors?.capacity}
          hint="Blank = uncapped"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="instructorId" className="block text-sm font-medium text-content">
          {t('instructor.singular')}
        </label>
        <select
          id="instructorId"
          name="instructorId"
          defaultValue={initial?.instructorId ?? ''}
          className={SELECT_CLASS}
        >
          <option value="">Unassigned</option>
          {instructors.map((instructor) => (
            <option key={instructor.id} value={instructor.id}>
              {instructor.label}
            </option>
          ))}
        </select>
        {result?.fieldErrors?.instructorId && (
          <p className="text-xs text-danger">{result.fieldErrors.instructorId}</p>
        )}
      </div>

      <fieldset className="space-y-3 rounded-brand border border-surface-border p-3">
        <legend className="px-1 text-sm font-medium text-content">Recurring schedule</legend>
        <p className="text-xs text-content-muted">
          Optional. Generates this batch&apos;s classes; times are in the org timezone.
        </p>

        <Input
          label="Repeat rule"
          name="rrule"
          defaultValue={initial?.rrule ?? ''}
          placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
          hint="FREQ=DAILY or FREQ=WEEKLY, plus BYDAY, INTERVAL, COUNT, UNTIL. Blank = no fixed timetable."
          error={result?.fieldErrors?.rrule}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Class start time"
            name="startTime"
            type="time"
            defaultValue={initial?.startTime ?? ''}
            error={result?.fieldErrors?.startTime}
          />
          <Input
            label="Class length (minutes)"
            name="durationMin"
            type="number"
            min={5}
            max={1440}
            defaultValue={initial?.durationMin ?? ''}
            error={result?.fieldErrors?.durationMin}
          />
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}
