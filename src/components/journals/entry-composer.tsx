'use client'

import { useState, useTransition } from 'react'

import {
  createJournalEntry,
  type ActionResult,
  type CreatedEntry,
} from '@/server/journals/actions'
import type { JournalFieldSchema, JournalFieldType } from '@/server/journals/validation'

interface EntryComposerProps {
  journalKey: string
  singular: string
  fields: JournalFieldSchema[]
  defaultValues: Record<string, unknown>
  onCreated?: () => void
}

/**
 * Journal entry composer. Renders one input per declared field, by type. A
 * successful create re-arms the form to default values so the next entry is a
 * fresh start; the list will refresh server-side on the next navigation
 * (the form is intentionally not optimistic, matching the assignment composer).
 */
export function EntryComposer({
  journalKey,
  singular,
  fields,
  defaultValues,
  onCreated,
}: EntryComposerProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...defaultValues,
  }))
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function setValue(key: string, value: unknown) {
    setError(null)
    setSuccess(null)
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function submit() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result: ActionResult<CreatedEntry> = await createJournalEntry({
        journalKey,
        data: values,
      })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      setSuccess('Saved.')
      setValues({ ...defaultValues })
      onCreated?.()
    })
  }

  return (
    <div className="space-y-4 rounded-brand border border-surface-border bg-surface p-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-content-muted">
        Log a {singular}
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        {fields
          .filter((field) => !field.hidden)
          .map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={values[field.key]}
              onChange={(value) => setValue(field.key, value)}
              disabled={pending}
            />
          ))}
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {success && <p className="text-xs text-success">{success}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-brand bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? 'Saving…' : `Save ${singular}`}
        </button>
      </div>
    </div>
  )
}

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: JournalFieldSchema
  value: unknown
  onChange: (value: unknown) => void
  disabled: boolean
}) {
  const label = (
    <span className="text-content-muted">{field.label}</span>
  )
  const help = field.help && <p className="text-xs text-content-muted/80">{field.help}</p>

  // Most fields land on a single grid column; textarea works better full width.
  const containerClass = field.type === 'textarea' ? 'space-y-1 text-sm sm:col-span-2' : 'space-y-1 text-sm'

  switch (field.type as JournalFieldType) {
    case 'text':
      return (
        <label className={containerClass}>
          {label}
          <input
            type="text"
            required={field.required}
            placeholder={field.placeholder}
            step={field.step}
            defaultValue={
              typeof field.defaultValue === 'string' ? field.defaultValue : undefined
            }
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
          {help}
        </label>
      )

    case 'textarea':
      return (
        <label className={containerClass}>
          {label}
          <textarea
            required={field.required}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            rows={4}
            className="block w-full resize-y rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
          {help}
        </label>
      )

    case 'number':
      return (
        <label className={containerClass}>
          {label}
          <input
            type="number"
            required={field.required}
            min={field.min}
            max={field.max}
            step={field.step ?? 'any'}
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(e) =>
              onChange(e.target.value === '' ? undefined : Number(e.target.value))
            }
            disabled={disabled}
            className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
          {help}
        </label>
      )

    case 'currency':
      return (
        <label className={containerClass}>
          {label}
          <input
            type="number"
            required={field.required}
            min={0}
            step="0.01"
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(e) =>
              onChange(e.target.value === '' ? undefined : Number(e.target.value))
            }
            disabled={disabled}
            className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
          {help}
        </label>
      )

    case 'percent':
      return (
        <label className={containerClass}>
          {label}
          <input
            type="number"
            required={field.required}
            min={0}
            max={100}
            step={field.step ?? 'any'}
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(e) =>
              onChange(e.target.value === '' ? undefined : Number(e.target.value))
            }
            disabled={disabled}
            className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
          {help}
        </label>
      )

    case 'select':
      return (
        <label className={containerClass}>
          {label}
          <select
            required={field.required}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
          >
            <option value="">—</option>
            {field.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {help}
        </label>
      )

    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : []
      const options = field.options ?? []
      return (
        <div className={containerClass}>
          {label}
          <div className="flex flex-wrap gap-2">
            {options.map((option) => {
              const checked = selected.includes(option.value)
              return (
                <label
                  key={option.value}
                  className={
                    'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs ' +
                    (checked
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-surface-border text-content-muted')
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => {
                      if (e.target.checked) onChange([...selected, option.value])
                      else onChange(selected.filter((v) => v !== option.value))
                    }}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              )
            })}
          </div>
          {help}
        </div>
      )
    }

    case 'boolean':
      return (
        <label className={containerClass}>
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              required={field.required}
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              disabled={disabled}
              className="h-4 w-4 rounded border-surface-border"
            />
            <span className="text-content-muted">{field.label}</span>
          </span>
          {help}
        </label>
      )

    case 'date':
      return (
        <label className={containerClass}>
          {label}
          <input
            type="date"
            required={field.required}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
          {help}
        </label>
      )

    case 'datetime':
      return (
        <label className={containerClass}>
          {label}
          <input
            type="datetime-local"
            required={field.required}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
          {help}
        </label>
      )

    case 'url':
      return (
        <label className={containerClass}>
          {label}
          <input
            type="url"
            required={field.required}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
          {help}
        </label>
      )

    case 'image':
    case 'file':
      // Upload id, typed as text for now. The upload API already exists at
      // /api/media/upload; a richer upload UI belongs in the resourcesvault,
      // not here. The validator accepts an opaque string id.
      return (
        <label className={containerClass}>
          {label}
          <input
            type="text"
            required={field.required}
            placeholder="Upload id"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
          {help}
        </label>
      )

    default:
      return null
  }
}
