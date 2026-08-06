import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { t } from '@/lib/labels'
import { requireUser } from '@/server/auth/rbac'
import { isFeatureEnabled } from '@/server/org/settings'
import { loadTrackerViewer } from '@/server/trackers/access'
import {
  listTrackers,
  type TrackerDefinitionView,
  type TrackerRecordView,
  type ViewableTracker,
} from '@/server/trackers/trackers'

export const metadata: Metadata = { title: 'Trackers' }

export default async function TrackersPage() {
  if (!(await isFeatureEnabled('trackers'))) notFound()
  const user = await requireUser('/app/trackers')
  const viewer = await loadTrackerViewer(user.id)
  if (!viewer) notFound()

  const trackers = await listTrackers(viewer)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-content">{t('nav.trackers')}</h1>
      </header>

      {trackers.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          No trackers configured.
        </p>
      ) : (
        <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
          {trackers.map((tracker) => (
            <TrackerRow key={tracker.definition.id} tracker={tracker} />
          ))}
        </ul>
      )}
    </div>
  )
}

function TrackerRow({ tracker }: { tracker: ViewableTracker }) {
  const { definition, records } = tracker
  const record = records[0] ?? null
  return (
    <li>
      <Link
        href={`/app/trackers/${definition.key}`}
        className="block px-4 py-3 hover:bg-surface-muted"
      >
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
            {definition.type}
          </span>
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
            {definition.scope}
          </span>
          <span className="text-sm text-content-muted">·</span>
          <span className="text-sm text-content-muted">{recordSummary(definition, record)}</span>
        </div>
        <p className="text-content">{definition.name}</p>
        {definition.description && (
          <p className="mt-0.5 truncate text-sm text-content-muted">{definition.description}</p>
        )}
      </Link>
    </li>
  )
}

/**
 * One-line summary of the record's state, inferring the rendered shape from the
 * tracker type. Null when there is no record yet — the caller falls back to
 * "Not started" so the empty surface stays neutral rather than pack-specific.
 */
function recordSummary(
  definition: TrackerDefinitionView,
  record: TrackerRecordView | null,
): string {
  if (!record) return 'Not started'

  switch (definition.type) {
    case 'COUNTER': {
      if (definition.config.target !== null && definition.config.target > 0) {
        return `${record.value.count} / ${definition.config.target}${definition.unit ? ` ${definition.unit}` : ''}`
      }
      return `${record.value.count}${definition.unit ? ` ${definition.unit}` : ''}`
    }
    case 'BOOLEAN':
      return record.value.on ? 'On' : 'Off'
    case 'CHECKLIST':
      return `${record.value.checked.length} / ${definition.config.items.length} done`
    case 'GAUGE':
      return record.progress && record.progress.kind === 'percent'
        ? `${record.progress.value}%`
        : `${record.value.value}%`
    case 'EXPIRY':
      return expiryLabel(record.expiry)
  }
}

function expiryLabel(status: 'ACTIVE' | 'EXPIRED' | 'INACTIVE' | null): string {
  if (!status) return 'Unknown'
  switch (status) {
    case 'ACTIVE':
      return 'Active'
    case 'EXPIRED':
      return 'Expired'
    case 'INACTIVE':
      return 'Inactive'
  }
}
