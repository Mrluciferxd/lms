'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/server/catalog/actions'
import { VideoUpload } from './video-upload'

export interface LessonFormValues {
  id?: string
  title: string
  summary: string | null
  type: string
  isPreview: boolean
  isMandatory: boolean
  videoAssetId: string | null
  durationSec: number | null
  releaseMode: string
  releaseOffsetDays: number | null
  releaseAt: string | null
  releaseAfterSessionId: string | null
}

export interface SessionOption {
  id: string
  label: string
}

const RELEASE_MODES = [
  { value: 'IMMEDIATE', label: 'Available immediately' },
  { value: 'DAYS_AFTER_ENROLLMENT', label: 'N days after enrollment' },
  { value: 'DAYS_AFTER_BATCH_START', label: 'N days after batch start' },
  { value: 'FIXED_DATE', label: 'On a fixed date' },
  { value: 'AFTER_SESSION', label: 'After a live session ends' },
  { value: 'MANUAL', label: 'Manual — I release it' },
] as const

const NEEDS_OFFSET = new Set(['DAYS_AFTER_ENROLLMENT', 'DAYS_AFTER_BATCH_START'])

export function LessonForm({
  action,
  initial,
  sessions,
  submitLabel,
  onDone,
}: {
  action: (formData: FormData) => Promise<ActionResult>
  initial?: LessonFormValues
  sessions: SessionOption[]
  submitLabel: string
  onDone?: () => void
}) {
  const router = useRouter()
  const [result, setResult] = useState<ActionResult | null>(null)
  const [pending, startTransition] = useTransition()

  // Controlled so the conditional release fields appear as the mode changes.
  const [releaseMode, setReleaseMode] = useState(initial?.releaseMode ?? 'IMMEDIATE')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [assetId, setAssetId] = useState(initial?.videoAssetId ?? '')
  const [durationSec, setDurationSec] = useState(initial?.durationSec ?? '')

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const outcome = await action(formData)
      setResult(outcome)
      if (outcome.ok) {
        router.refresh()
        onDone?.()
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

      <Input
        label="Lesson title"
        name="title"
        required
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        error={result?.fieldErrors?.title}
      />

      <Input label="Summary" name="summary" defaultValue={initial?.summary ?? ''} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="type" className="block text-sm font-medium text-content">
            Type
          </label>
          <select
            id="type"
            name="type"
            defaultValue={initial?.type ?? 'VIDEO'}
            className="w-full rounded-brand border border-surface-border bg-surface px-3 py-2 text-sm text-content"
          >
            {['VIDEO', 'TEXT', 'PDF', 'LIVE', 'EMBED', 'QUIZ', 'ASSIGNMENT'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <Input
          label="Duration (seconds)"
          name="durationSec"
          type="number"
          min={0}
          value={durationSec}
          onChange={(event) => setDurationSec(event.target.value)}
          hint="Filled automatically on upload"
        />
      </div>

      {/* Hidden field carries the asset id the uploader produced. */}
      <input type="hidden" name="videoAssetId" value={assetId} />

      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-content">Video</span>
        {assetId ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-xs text-content-muted">{assetId}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAssetId('')}>
              Detach
            </Button>
          </div>
        ) : (
          <VideoUpload
            lessonTitle={title}
            onUploaded={(newAssetId, probedDuration) => {
              setAssetId(newAssetId)
              if (probedDuration) setDurationSec(probedDuration)
            }}
          />
        )}
      </div>

      <fieldset className="space-y-3 rounded-brand border border-surface-border p-3">
        <legend className="px-1 text-sm font-medium text-content">Release</legend>

        <div className="space-y-1.5">
          <label htmlFor="releaseMode" className="block text-sm font-medium text-content">
            When students can access this
          </label>
          <select
            id="releaseMode"
            name="releaseMode"
            value={releaseMode}
            onChange={(event) => setReleaseMode(event.target.value)}
            className="w-full rounded-brand border border-surface-border bg-surface px-3 py-2 text-sm text-content"
          >
            {RELEASE_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>

        {NEEDS_OFFSET.has(releaseMode) && (
          <Input
            label="Days"
            name="releaseOffsetDays"
            type="number"
            min={0}
            required
            defaultValue={initial?.releaseOffsetDays ?? 0}
            error={result?.fieldErrors?.releaseOffsetDays}
            hint={
              releaseMode === 'DAYS_AFTER_BATCH_START'
                ? 'Students with no batch fall back to their enrollment date.'
                : undefined
            }
          />
        )}

        {releaseMode === 'FIXED_DATE' && (
          <Input
            label="Release date and time"
            name="releaseAt"
            type="datetime-local"
            required
            defaultValue={initial?.releaseAt ?? ''}
            error={result?.fieldErrors?.releaseAt}
          />
        )}

        {releaseMode === 'AFTER_SESSION' && (
          <div className="space-y-1.5">
            <label htmlFor="releaseAfterSessionId" className="block text-sm font-medium text-content">
              Unlocks after
            </label>
            <select
              id="releaseAfterSessionId"
              name="releaseAfterSessionId"
              defaultValue={initial?.releaseAfterSessionId ?? ''}
              className="w-full rounded-brand border border-surface-border bg-surface px-3 py-2 text-sm text-content"
            >
              <option value="">Select a session…</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.label}
                </option>
              ))}
            </select>
            {result?.fieldErrors?.releaseAfterSessionId && (
              <p className="text-xs text-danger">{result.fieldErrors.releaseAfterSessionId}</p>
            )}
            {sessions.length === 0 && (
              <p className="text-xs text-content-muted">
                No live sessions exist for this course yet.
              </p>
            )}
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-content">
          <input
            type="checkbox"
            name="isPreview"
            defaultChecked={initial?.isPreview ?? false}
            className="rounded border-surface-border"
          />
          Free preview
        </label>

        <label className="flex items-center gap-2 text-sm text-content">
          <input
            type="checkbox"
            name="isMandatory"
            defaultChecked={initial?.isMandatory ?? true}
            className="rounded border-surface-border"
          />
          Counts toward completion
        </label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
