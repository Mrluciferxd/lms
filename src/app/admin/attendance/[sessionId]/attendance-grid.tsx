'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { t } from '@/lib/labels'
import { bulkMarkAttendance } from '@/server/sessions/actions'
import type { AttendanceStatus } from '@/generated/prisma/enums'

export interface AttendanceGridRow {
  userId: string
  name: string
  email: string | null
  status: AttendanceStatus | null
  note: string | null
  /** Preformatted in the org timezone; null when never marked. */
  markedOn: string | null
  markedByName: string | null
  onRoster: boolean
}

const STATUSES: readonly AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']

const SELECT_CLASS =
  'rounded-brand border border-surface-border bg-surface px-2 py-1.5 text-sm text-content'

/**
 * The register.
 *
 * Bulk buttons set every row at once because that is how a register is actually
 * taken — everyone present, then correct the few who were not. An unset row is
 * left unset rather than defaulted, so saving a half-filled sheet cannot mark
 * absent a student nobody looked at.
 */
export function AttendanceGrid({
  sessionId,
  rows,
  canMark,
}: {
  sessionId: string
  rows: AttendanceGridRow[]
  canMark: boolean
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.userId, row.status ?? ''])),
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function setAll(status: AttendanceStatus) {
    setSelected(Object.fromEntries(rows.map((row) => [row.userId, status])))
  }

  function save(formData: FormData) {
    startTransition(async () => {
      const result = await bulkMarkAttendance(sessionId, formData)
      setNotice(result.ok ? null : (result.error ?? 'Something went wrong.'))
      setSaved(result.ok ? `Saved ${result.marked ?? 0} record(s).` : null)
      if (result.ok) router.refresh()
    })
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
        Nobody is on this register. Attach the session to a {t('batch.singular').toLowerCase()} with
        enrolled students.
      </p>
    )
  }

  return (
    <form action={save} className="space-y-4">
      {notice && (
        <p role="alert" className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {notice}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-brand border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {saved}
        </p>
      )}

      {canMark && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setAll('PRESENT')}>
            Mark all {t('attendance.PRESENT').toLowerCase()}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setAll('ABSENT')}>
            Mark all {t('attendance.ABSENT').toLowerCase()}
          </Button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
              <th scope="col" className="py-2 pr-4 font-medium">{t('student.singular')}</th>
              <th scope="col" className="py-2 pr-4 font-medium">{t('nav.attendance')}</th>
              <th scope="col" className="py-2 pr-4 font-medium">Note</th>
              <th scope="col" className="py-2 font-medium">Marked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {rows.map((row) => (
              <tr key={row.userId}>
                <td className="py-2 pr-4">
                  <span className="block text-content">{row.name}</span>
                  <span className="block text-xs text-content-muted">
                    {row.email}
                    {!row.onRoster && ' · not on the roster'}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <label htmlFor={`status-${row.userId}`} className="sr-only">
                    {t('nav.attendance')} for {row.name}
                  </label>
                  <select
                    id={`status-${row.userId}`}
                    name={`status:${row.userId}`}
                    value={selected[row.userId] ?? ''}
                    disabled={!canMark}
                    onChange={(event) =>
                      setSelected((current) => ({ ...current, [row.userId]: event.target.value }))
                    }
                    className={SELECT_CLASS}
                  >
                    <option value="">Not marked</option>
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {t(`attendance.${status}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-4">
                  <label htmlFor={`note-${row.userId}`} className="sr-only">
                    Note for {row.name}
                  </label>
                  <input
                    id={`note-${row.userId}`}
                    name={`note:${row.userId}`}
                    defaultValue={row.note ?? ''}
                    disabled={!canMark}
                    className="w-full rounded-brand border border-surface-border bg-surface px-2 py-1.5 text-sm text-content"
                  />
                </td>
                <td className="py-2 text-xs text-content-muted">
                  {row.markedOn ? (
                    <>
                      {row.markedOn}
                      {row.markedByName && <span className="block">by {row.markedByName}</span>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canMark && (
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save register'}
        </Button>
      )}
    </form>
  )
}
