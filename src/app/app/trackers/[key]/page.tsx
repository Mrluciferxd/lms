import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { t } from '@/lib/labels'
import { TrackerEditor } from '@/components/trackers/tracker-editor'
import { requireUser } from '@/server/auth/rbac'
import { isFeatureEnabled } from '@/server/org/settings'
import { loadTrackerViewer } from '@/server/trackers/access'
import {
  listTrackers,
  loadTracker,
  type TrackerRecordView,
  type ViewableTracker,
} from '@/server/trackers/trackers'

export const metadata: Metadata = { title: 'Trackers' }

export default async function TrackerDetailPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  if (!(await isFeatureEnabled('trackers'))) notFound()
  const user = await requireUser('/app/trackers')
  const { key } = await params
  const viewer = await loadTrackerViewer(user.id)
  if (!viewer) notFound()

  // Sidebar of every tracker the viewer can read, mirroring the widgets and
  // journal surfaces — /app/trackers/<key> keeps a sitemap alongside the
  // editor. One query each direction; the detail query is scoped by key.
  const [sidebar, tracker] = await Promise.all([
    listTrackers(viewer),
    loadTracker(key, viewer),
  ])

  if (!tracker) notFound()

  const { definition, records } = tracker

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      {/* Sidebar — the tracker list */}
      <nav aria-labelledby="trackers-heading" className="space-y-2">
        <h2
          id="trackers-heading"
          className="text-xs font-medium uppercase tracking-wide text-content-muted"
        >
          {t('nav.trackers')}
        </h2>
        <ul className="space-y-1">
          {sidebar.map((item) => (
            <li key={item.definition.key}>
              <Link
                href={`/app/trackers/${item.definition.key}`}
                aria-current={item.definition.key === key ? 'page' : undefined}
                className={
                  'block truncate rounded-brand px-2 py-1 text-sm ' +
                  (item.definition.key === key
                    ? 'bg-primary/10 text-primary'
                    : 'text-content-muted hover:bg-surface-muted')
                }
              >
                {item.definition.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Main column */}
      <div className="space-y-6">
        <header className="space-y-1">
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
          </div>
        </header>

        <RecordsSection tracker={tracker} viewerId={viewer.id} />
      </div>
    </div>
  )
}

function RecordsSection({
  tracker,
  viewerId,
}: {
  tracker: ViewableTracker
  viewerId: string
}) {
  const { definition, records } = tracker

  // Empty-state: a STUDENT-scope tracker with no record yet boots up an editor
  // pointed at a synthetic empty record so the student can create their first
  // entry. BATCH/GLOBAL scopes can't be self-created — those live in the
  // admin console — so they show a static "No record yet." instead.
  if (records.length === 0) {
    if (definition.scope === 'STUDENT') {
      const emptyRecord: TrackerRecordView = {
        id: null,
        subjectUserId: viewerId,
        subjectBatchId: null,
        subjectLabel: null,
        value: { count: 0, on: false, checked: [], active: false, value: 0, segments: {} },
        progress: null,
        expiry: null,
        expiresAt: null,
        updatedAt: null,
        canUpdate: true,
      }
      return (
        <div className="rounded-brand border border-surface-border bg-surface-muted p-4">
          <TrackerEditor definition={definition} record={emptyRecord} />
        </div>
      )
    }

    return (
      <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
        No record yet.
      </p>
    )
  }

  // BATCH-scope trackers can produce one record per batch the viewer belongs
  // to — render each with its batch label as a subheading so several rows are
  // disambiguated. STUDENT and GLOBAL have a single record; we still go through
  // the same loop so the path is uniform.
  return (
    <ul className="space-y-4">
      {records.map((record) => (
        <li
          key={`${record.id ?? 'new'}-${record.subjectBatchId ?? 'self'}`}
          className="space-y-2 rounded-brand border border-surface-border bg-surface-muted p-4"
        >
          {definition.scope === 'BATCH' && record.subjectLabel && (
            <h2 className="text-sm font-medium text-content">{record.subjectLabel}</h2>
          )}
          <TrackerEditor definition={definition} record={record} />
        </li>
      ))}
    </ul>
  )
}
