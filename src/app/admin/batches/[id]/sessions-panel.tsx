'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { liveSessionKindLabel, t } from '@/lib/labels'
import { generateBatchSessions } from '@/server/batches/actions'
import { setSessionStatus } from '@/server/sessions/actions'
import type { SessionKind } from '@/generated/prisma/enums'

export interface BatchSessionRow {
  id: string
  title: string
  kind: SessionKind
  /** Preformatted in the org timezone. */
  when: string
  status: string
  phaseLabel: string
  tracksAttendance: boolean
  markedCount: number
}

export function SessionsPanel({
  batchId,
  sessions,
  scheduleSummary,
  scheduleError,
  defaultFrom,
  defaultTo,
  canManage,
}: {
  batchId: string
  sessions: BatchSessionRow[]
  scheduleSummary: string | null
  scheduleError: string | null
  defaultFrom: string
  defaultTo: string
  canManage: boolean
}) {
  const router = useRouter()
  const [notice, setNotice] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await work()
      setNotice(result.ok ? null : (result.error ?? 'Something went wrong.'))
      if (result.ok) router.refresh()
    })
  }

  function generate(formData: FormData) {
    startTransition(async () => {
      const result = await generateBatchSessions(batchId, formData)
      setNotice(result.ok ? null : (result.error ?? 'Something went wrong.'))
      setOutcome(
        result.ok
          ? `Created ${result.created ?? 0} session(s); ${result.skipped ?? 0} already existed.`
          : null,
      )
      if (result.ok) router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {notice && (
        <p role="alert" className="rounded-brand border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {notice}
        </p>
      )}
      {outcome && (
        <p role="status" className="rounded-brand border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {outcome}
        </p>
      )}

      {sessions.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          No {t('liveSession.plural').toLowerCase()} scheduled for this{' '}
          {t('batch.singular').toLowerCase()} yet.
        </p>
      ) : (
        <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <Link
                  href={`/admin/batches/sessions/${session.id}`}
                  className="block truncate text-sm font-medium text-content hover:text-primary"
                >
                  {session.title}
                </Link>
                <span className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
                  <span>{session.when}</span>
                  <span aria-hidden>·</span>
                  <span>{liveSessionKindLabel(session.kind)}</span>
                  <span aria-hidden>·</span>
                  <span>{session.phaseLabel}</span>
                  {session.tracksAttendance && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{session.markedCount} marked</span>
                    </>
                  )}
                </span>
              </span>

              {canManage && session.status !== 'CANCELLED' && (
                <>
                  {session.status !== 'LIVE' && session.status !== 'ENDED' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => run(() => setSessionStatus(session.id, 'LIVE'))}
                    >
                      Start
                    </Button>
                  )}
                  {session.status === 'LIVE' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => run(() => setSessionStatus(session.id, 'ENDED'))}
                    >
                      End
                    </Button>
                  )}
                </>
              )}

              {session.tracksAttendance && (
                <Link
                  href={`/admin/attendance/${session.id}`}
                  className="text-sm text-primary underline"
                >
                  {t('nav.attendance')}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form action={generate} className="space-y-3 rounded-brand bg-surface-muted p-3">
          <p className="text-sm font-medium text-content">Generate from the recurring schedule</p>

          {scheduleError ? (
            <p className="text-xs text-danger">{scheduleError}</p>
          ) : scheduleSummary ? (
            <p className="text-xs text-content-muted">{scheduleSummary}</p>
          ) : (
            <p className="text-xs text-content-muted">
              This {t('batch.singular').toLowerCase()} has no recurring schedule. Add one in the
              details above, or create sessions individually.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="From" name="from" type="date" defaultValue={defaultFrom} />
            <Input label="To" name="to" type="date" defaultValue={defaultTo} />
            <Input
              label="Join link"
              name="joinUrl"
              type="url"
              placeholder="https://…"
              hint="Applied to every generated class"
            />
          </div>

          <Button type="submit" size="sm" disabled={!scheduleSummary}>
            Generate classes
          </Button>
          <p className="text-xs text-content-muted">
            Safe to run twice — occurrences that already have a session are skipped.
          </p>
        </form>
      )}
    </div>
  )
}
