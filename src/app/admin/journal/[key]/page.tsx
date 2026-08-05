import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { formatDateTime } from '@/lib/utils'
import { requirePermission } from '@/server/auth/rbac'
import { isFeatureEnabled, getOrgSettings } from '@/server/org/settings'
import { loadJournalViewer } from '@/server/journals/access'
import {
  loadJournalDefinitionForStaff,
  listJournalEntriesForStaff,
} from '@/server/journals/journals'

export const metadata: Metadata = { title: 'Journal Review · Admin' }

const STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-info/10 text-info',
  CLOSED: 'bg-surface-muted text-content-muted',
}

export default async function AdminJournalDetailPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  if (!(await isFeatureEnabled('journals'))) notFound()
  await requirePermission('journal:review', '/admin/journal')

  const { key } = await params
  const viewer = await loadJournalViewer(null)
  if (!viewer) notFound()

  const definition = await loadJournalDefinitionForStaff(key)
  if (!definition) notFound()

  const settings = await getOrgSettings()
  const format = (date: Date) =>
    formatDateTime(date, settings.timezone, settings.locale)

  const entries = await listJournalEntriesForStaff(definition.id, viewer, definition)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs text-content-muted">
          <a href="/admin/journal" className="hover:text-primary">
            Journal Review
          </a>{' '}
          / {definition.name}
        </p>
        <h1 className="text-2xl font-semibold text-content">{definition.name}</h1>
        {definition.description && (
          <p className="text-sm text-content-muted">{definition.description}</p>
        )}
      </header>

      <section aria-labelledby="entries-heading" className="space-y-3">
        <h2
          id="entries-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Entries ({entries.length})
        </h2>

        {entries.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            No entries logged yet.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {entries.map((entry) => {
              const visibleFields = definition.fieldSchema.filter((f) => !f.hidden)
              return (
                <li key={entry.id}>
                  <Link
                    href={`/app/journal/${key}/${entry.id}`}
                    className="block px-4 py-3 hover:bg-surface-muted"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      {definition.hasLifecycle && (
                        <span
                          className={
                            'rounded-full px-2 py-0.5 text-xs uppercase tracking-wide ' +
                            (STATUS_BADGE[entry.status] ?? '')
                          }
                        >
                          {entry.status.toLowerCase()}
                        </span>
                      )}
                      <span className="text-xs text-content-muted">
                        · {entry.authorName}
                      </span>
                      <span className="text-xs text-content-muted">
                        · {format(entry.openedAt)}
                      </span>
                      {entry.visibility !== 'PRIVATE' && (
                        <span className="text-xs text-content-muted">
                          · {entry.visibility.toLowerCase()}
                        </span>
                      )}
                      {entry.commentCount > 0 && (
                        <span className="text-xs text-content-muted">
                          · {entry.commentCount} comment
                          {entry.commentCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                      {visibleFields.slice(0, 6).map((field) => (
                        <div key={field.key} className="min-w-0">
                          <dt className="truncate text-xs text-content-muted">
                            {field.label}
                          </dt>
                          <dd className="truncate text-content">
                            {formatValue(entry.data[field.key], field.type)}
                          </dd>
                        </div>
                      ))}
                      {definition.computedFields.slice(0, 3).map((field) => (
                        <div key={field.key} className="min-w-0">
                          <dt className="truncate text-xs text-content-muted">
                            {field.label}
                          </dt>
                          <dd className="truncate text-content">
                            {String(entry.computed[field.key] ?? '—')}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function formatValue(value: unknown, type: string): string {
  if (value === undefined || value === null || value === '') return '—'
  if (type === 'multiselect' && Array.isArray(value))
    return (value as string[]).join(', ')
  if (type === 'boolean')
    return value === true ? 'yes' : value === false ? 'no' : '—'
  if (type === 'url' && typeof value === 'string') {
    try {
      return new URL(value).hostname
    } catch {
      return String(value)
    }
  }
  return String(value)
}
