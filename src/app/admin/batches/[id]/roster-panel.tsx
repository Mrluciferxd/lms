'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { t } from '@/lib/labels'
import {
  enrollStudentInBatch,
  moveEnrollmentToBatch,
  setEnrollmentStatus,
  unenrollStudent,
} from '@/server/enrollments/actions'

export interface RosterRow {
  enrollmentId: string
  userId: string
  name: string
  email: string | null
  status: string
  /** Preformatted in the org timezone — the browser's zone is not the authority. */
  enrolledOn: string
  percentComplete: number
}

export interface BatchOption {
  id: string
  label: string
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'text-success',
  PENDING: 'text-warning',
  PAUSED: 'text-warning',
  COMPLETED: 'text-content-muted',
  CANCELLED: 'text-danger',
  EXPIRED: 'text-danger',
}

const SELECT_CLASS =
  'rounded-brand border border-surface-border bg-surface px-2 py-1.5 text-sm text-content'

export function RosterPanel({
  batchId,
  rows,
  enrollable,
  siblingBatches,
  canManage,
  seatsLabel,
  full,
}: {
  batchId: string
  rows: RosterRow[]
  enrollable: BatchOption[]
  siblingBatches: BatchOption[]
  canManage: boolean
  seatsLabel: string
  full: boolean
}) {
  const router = useRouter()
  const [notice, setNotice] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await work()
      setNotice(result.ok ? null : (result.error ?? 'Something went wrong.'))
      if (result.ok) {
        setMovingId(null)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      {notice && (
        <p role="alert" className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {notice}
        </p>
      )}

      <p className="text-sm text-content-muted">
        {seatsLabel}
        {full && <span className="ml-2 text-warning">Full</span>}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          Nobody is enrolled in this {t('batch.singular').toLowerCase()} yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
                <th scope="col" className="py-2 pr-4 font-medium">{t('student.singular')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                <th scope="col" className="py-2 pr-4 font-medium">Enrolled</th>
                <th scope="col" className="py-2 pr-4 font-medium">Progress</th>
                {canManage && <th scope="col" className="py-2 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rows.map((row) => (
                <tr key={row.enrollmentId}>
                  <td className="py-3 pr-4">
                    <Link
                      href={`/admin/students/${row.userId}`}
                      className="font-medium text-content hover:text-primary"
                    >
                      {row.name}
                    </Link>
                    {row.email && (
                      <span className="block text-xs text-content-muted">{row.email}</span>
                    )}
                  </td>
                  <td className={`py-3 pr-4 text-xs font-medium ${STATUS_STYLES[row.status] ?? ''}`}>
                    {row.status}
                  </td>
                  <td className="py-3 pr-4 text-content-muted">{row.enrolledOn}</td>
                  <td className="py-3 pr-4 tabular-nums text-content-muted">
                    {row.percentComplete}%
                  </td>

                  {canManage && (
                    <td className="py-3">
                      {movingId === row.enrollmentId ? (
                        <form
                          action={(formData) =>
                            run(() => moveEnrollmentToBatch(row.enrollmentId, formData))
                          }
                          className="space-y-2"
                        >
                          <label
                            htmlFor={`target-${row.enrollmentId}`}
                            className="block text-xs text-content-muted"
                          >
                            Move {row.name} to
                          </label>
                          <select
                            id={`target-${row.enrollmentId}`}
                            name="targetBatchId"
                            required
                            className={SELECT_CLASS}
                          >
                            <option value="">Select…</option>
                            {siblingBatches.map((batch) => (
                              <option key={batch.id} value={batch.id}>
                                {batch.label}
                              </option>
                            ))}
                          </select>
                          <p className="max-w-xs text-xs text-warning">
                            Lessons that drip from the batch start re-anchor to the new
                            batch&apos;s dates, so content may lock or unlock immediately.
                            Attendance stays with the old {t('batch.singular').toLowerCase()}.
                          </p>
                          <div className="flex gap-2">
                            <Button type="submit" size="sm">
                              Move
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setMovingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {row.status === 'ACTIVE' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => run(() => setEnrollmentStatus(row.enrollmentId, 'PAUSED'))}
                            >
                              Pause
                            </Button>
                          )}
                          {(row.status === 'PAUSED' || row.status === 'CANCELLED') && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => run(() => setEnrollmentStatus(row.enrollmentId, 'ACTIVE'))}
                            >
                              Reinstate
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={siblingBatches.length === 0}
                            onClick={() => setMovingId(row.enrollmentId)}
                          >
                            Move
                          </Button>
                          {row.status !== 'CANCELLED' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-danger"
                              onClick={() => run(() => unenrollStudent(row.enrollmentId))}
                            >
                              Unenroll
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <form
          action={(formData) => run(() => enrollStudentInBatch(batchId, formData))}
          className="flex flex-wrap items-end gap-2 rounded-brand bg-surface-muted p-3"
        >
          <div className="space-y-1.5">
            <label htmlFor="userId" className="block text-sm font-medium text-content">
              Add a {t('student.singular').toLowerCase()}
            </label>
            <select id="userId" name="userId" required className={SELECT_CLASS}>
              <option value="">Select…</option>
              {enrollable.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.label}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" size="sm" disabled={enrollable.length === 0}>
            Enroll
          </Button>
          {enrollable.length === 0 && (
            <p className="text-xs text-content-muted">
              No matching students. Use the search above to find one.
            </p>
          )}
        </form>
      )}
    </div>
  )
}
