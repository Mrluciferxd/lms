'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { t } from '@/lib/labels'
import {
  moveEnrollmentToBatch,
  setEnrollmentStatus,
  unenrollStudent,
} from '@/server/enrollments/actions'

export interface MoveTarget {
  id: string
  label: string
}

/**
 * Per-enrollment controls on a student's page. Same actions as the batch roster;
 * this is the view an operator reaches from a support conversation about one
 * student rather than one cohort.
 */
export function EnrollmentRowActions({
  enrollmentId,
  status,
  targets,
}: {
  enrollmentId: string
  status: string
  targets: MoveTarget[]
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [, startTransition] = useTransition()

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await work()
      setError(result.ok ? null : (result.error ?? 'Something went wrong.'))
      if (result.ok) {
        setMoving(false)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {moving ? (
        <form
          action={(formData) => run(() => moveEnrollmentToBatch(enrollmentId, formData))}
          className="space-y-2"
        >
          <label htmlFor={`move-${enrollmentId}`} className="block text-xs text-content-muted">
            Move to
          </label>
          <select
            id={`move-${enrollmentId}`}
            name="targetBatchId"
            required
            className="rounded-brand border border-surface-border bg-surface px-2 py-1.5 text-sm text-content"
          >
            <option value="">Select…</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
          <p className="max-w-xs text-xs text-warning">
            Drip lessons re-anchor to the new {t('batch.singular').toLowerCase()}&apos;s start date,
            so content may lock or unlock straight away. Attendance stays with the old one.
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Move
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMoving(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1">
          {status === 'ACTIVE' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => run(() => setEnrollmentStatus(enrollmentId, 'PAUSED'))}
            >
              Pause
            </Button>
          )}
          {(status === 'PAUSED' || status === 'CANCELLED') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => run(() => setEnrollmentStatus(enrollmentId, 'ACTIVE'))}
            >
              Reinstate
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={targets.length === 0}
            onClick={() => setMoving(true)}
          >
            Move
          </Button>
          {status !== 'CANCELLED' && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              onClick={() => run(() => unenrollStudent(enrollmentId))}
            >
              Unenroll
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
