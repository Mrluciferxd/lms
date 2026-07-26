'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { liveSessionKindLabel, t } from '@/lib/labels'
import type { ActionResult } from '@/server/catalog/actions'
import type { SessionKind } from '@/generated/prisma/enums'

export interface SessionFormValues {
  kind: SessionKind
  title: string
  description: string | null
  batchId: string | null
  courseId: string | null
  hostId: string | null
  /** `YYYY-MM-DDTHH:mm` in the org timezone. */
  scheduledStart: string
  scheduledEnd: string
  mode: string
  visibility: string
  status: string
  location: string | null
  joinUrl: string | null
  streamProvider: string | null
  /** Whether a key is stored. The value itself never leaves the server. */
  hasStreamKey: boolean
  recordingAssetId: string | null
  tracksAttendance: boolean
  capacity: number | null
}

export interface SessionOption {
  id: string
  label: string
}

const KINDS: readonly SessionKind[] = ['CLASS', 'BROADCAST', 'WEBINAR', 'DOUBT_CLEARING', 'EVENT']

const MODES = [
  { value: 'ONLINE', label: 'Online' },
  { value: 'OFFLINE', label: 'In person' },
  { value: 'HYBRID', label: 'Hybrid' },
] as const

const VISIBILITIES = [
  { value: 'BATCH', label: 'This batch only' },
  { value: 'ENROLLED', label: 'Enrolled students' },
  { value: 'PUBLIC', label: 'Anyone with the link' },
  { value: 'ROLE', label: 'Staff only' },
] as const

const STATUSES = [
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'LIVE', label: 'Live' },
  { value: 'ENDED', label: 'Ended' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const

const SELECT_CLASS =
  'w-full rounded-brand border border-surface-border bg-surface px-3 py-2 text-sm text-content'

export function SessionForm({
  action,
  batches,
  courses,
  hosts,
  initial,
  submitLabel,
  onSaved,
}: {
  action: (formData: FormData) => Promise<ActionResult>
  batches: SessionOption[]
  courses: SessionOption[]
  hosts: SessionOption[]
  initial?: SessionFormValues
  submitLabel: string
  onSaved?: (id: string | undefined) => void
}) {
  const router = useRouter()
  const [result, setResult] = useState<ActionResult | null>(null)
  const [pending, startTransition] = useTransition()

  const [kind, setKind] = useState<SessionKind>(initial?.kind ?? 'CLASS')
  const [visibility, setVisibility] = useState(initial?.visibility ?? 'BATCH')
  const [mode, setMode] = useState(initial?.mode ?? 'ONLINE')

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

  const needsBatch = kind === 'CLASS' || visibility === 'BATCH'

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
        <div className="space-y-1.5">
          <label htmlFor="kind" className="block text-sm font-medium text-content">
            Kind
          </label>
          <select
            id="kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as SessionKind)}
            className={SELECT_CLASS}
          >
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {liveSessionKindLabel(value)}
              </option>
            ))}
          </select>
        </div>

        <Input
          label="Title"
          name="title"
          required
          defaultValue={initial?.title}
          error={result?.fieldErrors?.title}
        />
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Starts"
          name="scheduledStart"
          type="datetime-local"
          required
          defaultValue={initial?.scheduledStart ?? ''}
          error={result?.fieldErrors?.scheduledStart}
          hint="In the org timezone"
        />
        <Input
          label="Ends"
          name="scheduledEnd"
          type="datetime-local"
          defaultValue={initial?.scheduledEnd ?? ''}
          error={result?.fieldErrors?.scheduledEnd}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="batchId" className="block text-sm font-medium text-content">
            {t('batch.singular')}
          </label>
          <select
            id="batchId"
            name="batchId"
            defaultValue={initial?.batchId ?? ''}
            className={SELECT_CLASS}
          >
            <option value="">{needsBatch ? 'Select a batch…' : 'None'}</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.label}
              </option>
            ))}
          </select>
          {result?.fieldErrors?.batchId && (
            <p className="text-xs text-danger">{result.fieldErrors.batchId}</p>
          )}
          {needsBatch && !result?.fieldErrors?.batchId && (
            <p className="text-xs text-content-muted">
              Required for a {liveSessionKindLabel('CLASS').toLowerCase()} and for batch-only
              visibility. The batch also sets the course.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="courseId" className="block text-sm font-medium text-content">
            {t('course.singular')}
          </label>
          <select
            id="courseId"
            name="courseId"
            defaultValue={initial?.courseId ?? ''}
            disabled={needsBatch}
            className={SELECT_CLASS}
          >
            <option value="">None</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-content-muted">
            {needsBatch
              ? 'Taken from the batch.'
              : 'Narrows an enrolled-only session to one course.'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="visibility" className="block text-sm font-medium text-content">
            Who can see it
          </label>
          <select
            id="visibility"
            name="visibility"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value)}
            className={SELECT_CLASS}
          >
            {VISIBILITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="mode" className="block text-sm font-medium text-content">
            Mode
          </label>
          <select
            id="mode"
            name="mode"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
            className={SELECT_CLASS}
          >
            {MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="status" className="block text-sm font-medium text-content">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={initial?.status ?? 'SCHEDULED'}
            className={SELECT_CLASS}
          >
            {STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {mode !== 'OFFLINE' && (
          <Input
            label="Join link"
            name="joinUrl"
            type="url"
            placeholder="https://…"
            defaultValue={initial?.joinUrl ?? ''}
            error={result?.fieldErrors?.joinUrl}
          />
        )}
        {mode !== 'ONLINE' && (
          <Input
            label="Location"
            name="location"
            defaultValue={initial?.location ?? ''}
            hint="Room or address"
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="hostId" className="block text-sm font-medium text-content">
            Host
          </label>
          <select
            id="hostId"
            name="hostId"
            defaultValue={initial?.hostId ?? ''}
            className={SELECT_CLASS}
          >
            <option value="">Unassigned</option>
            {hosts.map((host) => (
              <option key={host.id} value={host.id}>
                {host.label}
              </option>
            ))}
          </select>
          {result?.fieldErrors?.hostId && (
            <p className="text-xs text-danger">{result.fieldErrors.hostId}</p>
          )}
        </div>

        <Input
          label="Capacity"
          name="capacity"
          type="number"
          min={1}
          defaultValue={initial?.capacity ?? ''}
          hint="Blank = uncapped"
        />
      </div>

      <fieldset className="space-y-3 rounded-brand border border-surface-border p-3">
        <legend className="px-1 text-sm font-medium text-content">Streaming and recording</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Stream provider"
            name="streamProvider"
            defaultValue={initial?.streamProvider ?? ''}
            hint="Free text, e.g. zoom, youtube"
          />
          <Input
            label={`${t('liveSession.recording')} asset id`}
            name="recordingAssetId"
            defaultValue={initial?.recordingAssetId ?? ''}
            error={result?.fieldErrors?.recordingAssetId}
            hint="Media asset holding the recording"
          />
        </div>

        {/*
          Write-only. The stored key is never sent to the browser, so this field
          starts empty and an empty submit leaves it untouched.
        */}
        <Input
          label="Stream key"
          name="streamKey"
          type="password"
          autoComplete="off"
          placeholder={initial?.hasStreamKey ? '•••••••• (unchanged)' : 'Not set'}
          hint={
            initial?.hasStreamKey
              ? 'A key is stored. Leave blank to keep it; type to replace it.'
              : 'Kept server-side and never shown again after saving.'
          }
        />

        {initial?.hasStreamKey && (
          <label className="flex items-center gap-2 text-sm text-content">
            <input type="checkbox" name="clearStreamKey" className="rounded border-surface-border" />
            Remove the stored stream key
          </label>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm text-content">
        <input
          type="checkbox"
          name="tracksAttendance"
          defaultChecked={initial?.tracksAttendance ?? true}
          className="rounded border-surface-border"
        />
        Track {t('nav.attendance').toLowerCase()}
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}
