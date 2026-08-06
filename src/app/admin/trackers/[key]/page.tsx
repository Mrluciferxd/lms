import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { t } from '@/lib/labels'
import { TrackerEditor } from '@/components/trackers/tracker-editor'
import { requirePermission } from '@/server/auth/rbac'
import { isFeatureEnabled } from '@/server/org/settings'
import { loadTrackerViewer } from '@/server/trackers/access'
import { loadTrackerForAdmin } from '@/server/trackers/trackers'

export const metadata: Metadata = { title: 'Trackers' }

export default async function AdminTrackerDetailPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  if (!(await isFeatureEnabled('trackers'))) notFound()
  const user = await requirePermission('tracker:manage', '/admin/trackers')

  const { key } = await params
  const viewer = await loadTrackerViewer(user.id)
  if (!viewer) notFound()

  const tracker = await loadTrackerForAdmin(key, viewer)
  if (!tracker) notFound()

  const { definition, records } = tracker

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs text-content-muted">
          <a href="/admin/trackers" className="hover:text-primary">
            {t('nav.trackers')}
          </a>{' '}
          / {definition.name}
        </p>
        <h1 className="text-2xl font-semibold text-content">{definition.name}</h1>
        {definition.description && (
          <p className="text-sm text-content-muted">{definition.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
            {definition.type}
          </span>
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
            {definition.scope}
          </span>
          {definition.unit && (
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
              · {definition.unit}
            </span>
          )}
          {definition.remindBeforeDays !== null && (
            <span className="text-xs text-content-muted">
              · Reminds {definition.remindBeforeDays} day
              {definition.remindBeforeDays !== 1 ? 's' : ''} before expiry
            </span>
          )}
        </div>
      </header>

      {records.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          No subjects configured.
        </p>
      ) : definition.scope === 'GLOBAL' && records[0] ? (
        <div className="rounded-brand border border-surface-border bg-surface p-4 space-y-3">
          <TrackerEditor definition={definition} record={records[0]} />
        </div>
      ) : (
        <ul className="space-y-4">
          {records.map((record) => (
            <li
              key={`${record.subjectUserId ?? ''}-${record.subjectBatchId ?? ''}-${record.id ?? 'new'}`}
              className="space-y-2"
            >
              {record.subjectLabel && (
                <h2 className="text-sm font-medium uppercase tracking-wide text-content-muted">
                  {record.subjectLabel}
                </h2>
              )}
              <div className="rounded-brand border border-surface-border bg-surface p-4 space-y-3">
                <TrackerEditor definition={definition} record={record} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
