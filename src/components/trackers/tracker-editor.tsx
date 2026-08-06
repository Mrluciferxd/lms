'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { cn } from '@/lib/utils'
import { updateTracker, type ActionResult } from '@/server/trackers/actions'
import type { TrackerRecordView, TrackerDefinitionView } from '@/server/trackers/trackers'
import type { ExpiryStatus, TrackerProgress, TrackerUpdate } from '@/server/trackers/validation'
import type React from 'react'

interface TrackerEditorProps {
  definition: TrackerDefinitionView
  record: TrackerRecordView
}

function toDateInputValue(date: Date | null): string {
  if (!date) return ''
  return new Date(date).toISOString().slice(0, 10)
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function TrackerEditor({ definition, record }: TrackerEditorProps) {
  if (!record.canUpdate) {
    return <ReadOnlySummary definition={definition} record={record} />
  }
  return <EditableTracker definition={definition} record={record} />
}

type SubmitFn = (update: TrackerUpdate) => void

function EditableTracker({
  definition,
  record,
}: {
  definition: TrackerDefinitionView
  record: TrackerRecordView
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit(update: TrackerUpdate) {
    setError(null)
    startTransition(async () => {
      const result: ActionResult = await updateTracker({
        definitionKey: definition.key,
        subjectUserId: record.subjectUserId,
        subjectBatchId: record.subjectBatchId,
        update,
      })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-4 rounded-brand border border-surface-border bg-surface p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium uppercase tracking-wide text-content-muted">
          {definition.name}
        </h2>
        {definition.description && (
          <p className="text-xs text-content-muted/80">{definition.description}</p>
        )}
      </div>

      <TypeForm definition={definition} record={record} pending={pending} onSubmit={submit} />

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function TypeForm({
  definition,
  record,
  pending,
  onSubmit,
}: {
  definition: TrackerDefinitionView
  record: TrackerRecordView
  pending: boolean
  onSubmit: SubmitFn
}) {
  switch (definition.type) {
    case 'COUNTER':
      return <CounterForm definition={definition} record={record} pending={pending} onSubmit={onSubmit} />
    case 'BOOLEAN':
      return <BooleanForm record={record} pending={pending} onSubmit={onSubmit} />
    case 'CHECKLIST':
      return <ChecklistForm definition={definition} record={record} pending={pending} onSubmit={onSubmit} />
    case 'GAUGE':
      return <GaugeForm definition={definition} record={record} pending={pending} onSubmit={onSubmit} />
    case 'EXPIRY':
      return <ExpiryForm record={record} pending={pending} onSubmit={onSubmit} />
  }
}

const inputClass =
  'block w-full rounded-brand border border-surface-border bg-surface px-3 py-1.5 text-sm text-content outline-none focus:border-primary disabled:opacity-50'
const buttonClass =
  'rounded-brand bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50'
const labelClass = 'space-y-1 text-sm'

function CounterForm({
  definition,
  record,
  pending,
  onSubmit,
}: {
  definition: TrackerDefinitionView
  record: TrackerRecordView
  pending: boolean
  onSubmit: SubmitFn
}) {
  const [count, setCount] = useState<string>(String(record.value.count ?? 0))
  const [clientError, setClientError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = Number(count)
    if (!Number.isInteger(parsed) || parsed < 0) {
      setClientError('Count must be a whole number of 0 or more.')
      return
    }
    setClientError(null)
    onSubmit({ type: 'COUNTER', count: parsed })
  }

  const target = definition.config.target
  const unit = definition.unit ?? ''

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className={labelClass}>
        <span className="text-content-muted">Count</span>
        <input
          type="number"
          min={0}
          step={1}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          disabled={pending}
          className={inputClass}
        />
      </div>

      <ProgressLine progress={record.progress}>
        {target !== null ? (
          <span className="text-content-muted">
            {record.value.count} / {target} {unit}
          </span>
        ) : (
          <span className="text-content-muted">
            {record.value.count} {unit}
          </span>
        )}
      </ProgressLine>

      {clientError && (
        <p role="alert" className="text-sm text-danger">
          {clientError}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function BooleanForm({
  record,
  pending,
  onSubmit,
}: {
  record: TrackerRecordView
  pending: boolean
  onSubmit: SubmitFn
}) {
  const [on, setOn] = useState<boolean>(record.value.on === true)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit({ type: 'BOOLEAN', on })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className={labelClass}>
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => setOn(e.target.checked)}
            disabled={pending}
            className="h-4 w-4 rounded border-surface-border"
          />
          <span className="text-content-muted">On</span>
        </span>
      </label>

      <div>
        <Chip tone={on ? 'success' : 'muted'}>{on ? 'On' : 'Off'}</Chip>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function ChecklistForm({
  definition,
  record,
  pending,
  onSubmit,
}: {
  definition: TrackerDefinitionView
  record: TrackerRecordView
  pending: boolean
  onSubmit: SubmitFn
}) {
  const [checked, setChecked] = useState<string[]>(() => Array.isArray(record.value.checked) ? record.value.checked : [])
  const items = definition.config.items

  function toggle(id: string, next: boolean) {
    setChecked((prev) => (next ? Array.from(new Set([...prev, id])) : prev.filter((v) => v !== id)))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit({ type: 'CHECKLIST', checked })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        {items.map((item) => {
          const isChecked = checked.includes(item.id)
          return (
            <label
              key={item.id}
              className={cn(
                'flex items-center gap-2 rounded-brand border px-3 py-1.5 text-sm',
                isChecked
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-surface-border text-content',
              )}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(e) => toggle(item.id, e.target.checked)}
                disabled={pending}
                className="h-4 w-4 rounded border-surface-border"
              />
              {item.label}
            </label>
          )
        })}
      </div>

      <p className="text-xs text-content-muted">
        {checked.length} / {items.length} done
      </p>

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function GaugeForm({
  definition,
  record,
  pending,
  onSubmit,
}: {
  definition: TrackerDefinitionView
  record: TrackerRecordView
  pending: boolean
  onSubmit: SubmitFn
}) {
  const segments = definition.config.segments
  const hasSegments = segments.length > 0

  const [value, setValue] = useState<string>(String(record.value.value ?? 0))
  const [segmentValues, setSegmentValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const segment of segments) {
      initial[segment.key] = String(record.value.segments[segment.key] ?? 0)
    }
    return initial
  })
  const [clientError, setClientError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (hasSegments) {
      const out: Record<string, number> = {}
      for (const segment of segments) {
        const parsed = Number(segmentValues[segment.key])
        out[segment.key] = Number.isFinite(parsed) ? clamp(Math.round(parsed), 0, 100) : 0
      }
      setClientError(null)
      onSubmit({ type: 'GAUGE', segments: out })
      return
    }
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setClientError('Value must be between 0 and 100.')
      return
    }
    setClientError(null)
    onSubmit({ type: 'GAUGE', value: clamp(Math.round(parsed), 0, 100) })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {hasSegments ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {segments.map((segment) => (
            <label key={segment.key} className={labelClass}>
              <span className="text-content-muted">{segment.label}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={segmentValues[segment.key] ?? '0'}
                onChange={(e) =>
                  setSegmentValues((prev) => ({ ...prev, [segment.key]: e.target.value }))
                }
                disabled={pending}
                className={inputClass}
              />
            </label>
          ))}
        </div>
      ) : (
        <label className={labelClass}>
          <span className="text-content-muted">Value</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </label>
      )}

      {hasSegments && record.progress && record.progress.kind === 'percent' && (
        <ProgressBar percent={record.progress.value} />
      )}

      {clientError && (
        <p role="alert" className="text-sm text-danger">
          {clientError}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function ExpiryForm({
  record,
  pending,
  onSubmit,
}: {
  record: TrackerRecordView
  pending: boolean
  onSubmit: SubmitFn
}) {
  const [active, setActive] = useState<boolean>(record.value.active === true)
  const [expiresAt, setExpiresAt] = useState<string>(() => toDateInputValue(record.expiresAt))
  const [clientError, setClientError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (active && expiresAt === '') {
      setClientError('An expiry date is required when active.')
      return
    }
    setClientError(null)
    onSubmit({ type: 'EXPIRY', active, expiresAt: active ? expiresAt : null })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className={labelClass}>
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            disabled={pending}
            className="h-4 w-4 rounded border-surface-border"
          />
          <span className="text-content-muted">Active</span>
        </span>
      </label>

      <label className={labelClass}>
        <span className="text-content-muted">Expires at</span>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          required={active}
          disabled={pending}
          className={inputClass}
        />
      </label>

      {record.expiry && <ExpiryChip status={record.expiry} />}

      {clientError && (
        <p role="alert" className="text-sm text-danger">
          {clientError}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function ReadOnlySummary({
  definition,
  record,
}: {
  definition: TrackerDefinitionView
  record: TrackerRecordView
}) {
  return (
    <div className="space-y-3 rounded-brand border border-surface-border bg-surface-muted p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium uppercase tracking-wide text-content-muted">
          {definition.name}
        </h2>
        {definition.description && (
          <p className="text-xs text-content-muted/80">{definition.description}</p>
        )}
      </div>

      <TypeSummary definition={definition} record={record} />
    </div>
  )
}

function TypeSummary({
  definition,
  record,
}: {
  definition: TrackerDefinitionView
  record: TrackerRecordView
}) {
  const unit = definition.unit ?? ''

  switch (definition.type) {
    case 'COUNTER': {
      const target = definition.config.target
      return (
        <div className="space-y-2 text-sm">
          {target !== null ? (
            <p className="text-content-muted">
              {record.value.count} / {target} {unit}
            </p>
          ) : (
            <p className="text-content-muted">
              {record.value.count} {unit}
            </p>
          )}
          <ProgressLine progress={record.progress}>{null}</ProgressLine>
        </div>
      )
    }
    case 'BOOLEAN':
      return (
        <div className="text-sm">
          <Chip tone={record.value.on ? 'success' : 'muted'}>{record.value.on ? 'On' : 'Off'}</Chip>
        </div>
      )
    case 'CHECKLIST':
      return (
        <div className="space-y-2 text-sm">
          <p className="text-content-muted">
            {record.value.checked.length} / {definition.config.items.length} done
          </p>
          <ul className="space-y-1">
            {definition.config.items.map((item) => {
              const isChecked = record.value.checked.includes(item.id)
              return (
                <li
                  key={item.id}
                  className={cn(
                    'flex items-center gap-2 rounded-brand border px-3 py-1.5',
                    isChecked
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-surface-border text-content-muted',
                  )}
                >
                  {isChecked ? '✓' : '○'} {item.label}
                </li>
              )
            })}
          </ul>
        </div>
      )
    case 'GAUGE':
      return (
        <div className="space-y-2 text-sm">
          {definition.config.segments.length > 0 ? (
            <ul className="space-y-1 text-content-muted">
              {definition.config.segments.map((segment) => (
                <li key={segment.key}>
                  {segment.label}: {record.value.segments[segment.key] ?? 0}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-content-muted">{record.value.value}</p>
          )}
          {record.progress && record.progress.kind === 'percent' && (
            <ProgressBar percent={record.progress.value} />
          )}
        </div>
      )
    case 'EXPIRY':
      return (
        <div className="space-y-2 text-sm">
          {record.expiry && <ExpiryChip status={record.expiry} />}
          {record.expiresAt && (
            <p className="text-content-muted">Expires: {toDateInputValue(record.expiresAt)}</p>
          )}
        </div>
      )
  }
}

function ProgressLine({
  progress,
  children,
}: {
  progress: TrackerProgress | null
  children: React.ReactNode
}) {
  if (progress && progress.kind === 'percent') {
    return (
      <div className="space-y-1">
        {children}
        <ProgressBar percent={progress.value} />
      </div>
    )
  }
  return <>{children}</>
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${clamp(percent, 0, 100)}%` }}
      />
    </div>
  )
}

type ChipTone = 'success' | 'muted' | 'danger'

function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  const toneClass: Record<ChipTone, string> = {
    success: 'border-primary bg-primary/10 text-primary',
    muted: 'border-surface-border bg-surface-muted text-content-muted',
    danger: 'border-danger/40 bg-danger/10 text-danger',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium',
        toneClass[tone],
      )}
    >
      {children}
    </span>
  )
}

function ExpiryChip({ status }: { status: ExpiryStatus }) {
  switch (status) {
    case 'ACTIVE':
      return <Chip tone="success">ACTIVE</Chip>
    case 'EXPIRED':
      return <Chip tone="danger">EXPIRED</Chip>
    case 'INACTIVE':
      return <Chip tone="muted">INACTIVE</Chip>
  }
}
