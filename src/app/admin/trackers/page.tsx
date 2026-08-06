import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { t } from '@/lib/labels'
import { requirePermission } from '@/server/auth/rbac'
import { isFeatureEnabled } from '@/server/org/settings'
import { loadTrackerViewer } from '@/server/trackers/access'
import { listAllTrackerDefinitions } from '@/server/trackers/trackers'

export const metadata: Metadata = { title: 'Trackers' }

export default async function AdminTrackersPage() {
  if (!(await isFeatureEnabled('trackers'))) notFound()
  const user = await requirePermission('tracker:manage', '/admin/trackers')

  const viewer = await loadTrackerViewer(user.id)
  if (!viewer) notFound()

  const definitions = await listAllTrackerDefinitions(viewer)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-content">{t('nav.trackers')}</h1>
        <p className="text-sm text-content-muted">
          Manage tracker values across every subject — the global record, each batch,
          and every active student.
        </p>
      </header>

      {definitions.length === 0 ? (
        <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
          No trackers installed.
        </p>
      ) : (
        <ul className="space-y-3">
          {definitions.map((definition) => {
            const description =
              definition.description && definition.description.length > 140
                ? `${definition.description.slice(0, 137).trimEnd()}…`
                : definition.description
            return (
              <li key={definition.id}>
                <Link
                  href={`/admin/trackers/${definition.key}`}
                  className="block rounded-brand border border-surface-border px-4 py-3 hover:bg-surface-muted"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-content">{definition.name}</span>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
                      {definition.type}
                    </span>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
                      {definition.scope}
                    </span>
                  </div>
                  {description && (
                    <p className="mt-1 text-xs text-content-muted">{description}</p>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
