import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { formatDateTime } from '@/lib/utils'
import { requireUser } from '@/server/auth/rbac'
import { isFeatureEnabled, getOrgSettings } from '@/server/org/settings'
import { loadJournalViewer } from '@/server/journals/access'
import {
  listJournalDefinitions,
  loadJournalDefinition,
  listJournalEntries,
  type ViewableJournalEntry,
  type ViewableJournalDefinition,
} from '@/server/journals/journals'
import { EntryComposer } from '@/components/journals/entry-composer'

export const metadata: Metadata = { title: 'Journals' }

export default async function JournalPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  if (!(await isFeatureEnabled('journals'))) notFound()
  const user = await requireUser('/app/journal')

  const { key } = await params
  const viewer = await loadJournalViewer(user.id)
  if (!viewer) notFound()

  // Sidebar of all enabled journals for the viewer (so /app/journal/<key>
  // comes with a sitemap alongside). One query each direction; the entries
  // query is scoped to a single definition.
  const [sidebar, definition] = await Promise.all([
    listJournalDefinitions(viewer),
    loadJournalDefinition(key, viewer),
  ])

  if (!definition) notFound()

  const settings = await getOrgSettings()
  const format = (date: Date) =>
    formatDateTime(date, settings.timezone, settings.locale)

  const entries = await listJournalEntries(definition.id, viewer, definition)

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      {/* Sidebar — the journal list */}
      <nav aria-labelledby="journals-heading" className="space-y-2">
        <h2
          id="journals-heading"
          className="text-xs font-medium uppercase tracking-wide text-content-muted"
        >
          Journals
        </h2>
        <ul className="space-y-1">
          {sidebar.map((item) => (
            <li key={item.key}>
              <Link
                href={`/app/journal/${item.key}`}
                aria-current={item.key === key ? 'page' : undefined}
                className={
                  'block truncate rounded-brand px-2 py-1 text-sm ' +
                  (item.key === key
                    ? 'bg-primary/10 text-primary'
                    : 'text-content-muted hover:bg-surface-muted')
                }
              >
                {item.name}
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
        </header>

        <EntryComposer
          journalKey={definition.key}
          singular={definition.singular}
          fields={definition.fieldSchema}
          defaultValues={defaultValuesFor(definition)}
        />

        <section aria-labelledby="entries-heading" className="space-y-3">
          <h2
            id="entries-heading"
            className="text-sm font-medium uppercase tracking-wide text-content-muted"
          >
            {definition.singular} list ({entries.length})
          </h2>

          {entries.length === 0 ? (
            <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
              No {definition.singular.toLowerCase()}s logged yet.
            </p>
          ) : (
            <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
              {entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  definition={definition}
                  format={format}
                  journalKey={key}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function EntryRow({
  entry,
  definition,
  format,
  journalKey,
}: {
  entry: ViewableJournalEntry
  definition: ViewableJournalDefinition
  format: (date: Date) => string
  journalKey: string
}) {
  const visibleFields = definition.fieldSchema.filter((field) => !field.hidden)
  const computedFields = definition.computedFields
  const statusBadge =
    definition.hasLifecycle && entry.status === 'CLOSED' ? (
      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs uppercase tracking-wide text-content-muted">
        closed
      </span>
    ) : (
      <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs uppercase tracking-wide text-info">
        open
      </span>
    )

  const visibilityBadge =
    entry.visibility !== 'PRIVATE' ? (
      <span className="text-xs text-content-muted">
        · {entry.visibility.toLowerCase()}
      </span>
    ) : null

  return (
    <li>
      <Link
        href={`/app/journal/${journalKey}/${entry.id}`}
        className="block px-4 py-3 hover:bg-surface-muted"
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {statusBadge}
          {visibilityBadge}
          <span className="text-xs text-content-muted">
            · {format(entry.openedAt)}
          </span>
          {entry.batchId && entry.authorId !== entry.authorId && (
            <span className="text-xs text-content-muted">· by {entry.authorName}</span>
          )}
          {entry.commentCount > 0 && (
            <span className="text-xs text-content-muted">
              · {entry.commentCount} comment{entry.commentCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          {visibleFields.slice(0, 6).map((field) => {
            const value = entry.data[field.key]
            return (
              <div key={field.key} className="min-w-0">
                <dt className="truncate text-xs text-content-muted">{field.label}</dt>
                <dd className="truncate text-content">{formatValue(value, field.type)}</dd>
              </div>
            )
          })}
          {computedFields.slice(0, 3).map((field) => (
            <div key={field.key} className="min-w-0">
              <dt className="truncate text-xs text-content-muted">{field.label}</dt>
              <dd className="truncate text-content">{String(entry.computed[field.key] ?? '—')}</dd>
            </div>
          ))}
        </dl>
      </Link>
    </li>
  )
}

function formatValue(value: unknown, type: string): string {
  if (value === undefined || value === null || value === '') return '—'
  if (type === 'multiselect' && Array.isArray(value)) return (value as string[]).join(', ')
  if (type === 'boolean') return value === true ? 'yes' : value === false ? 'no' : '—'
  if (type === 'url' && typeof value === 'string') return new URL(value).hostname
  return String(value)
}

function defaultValuesFor(
  definition: ViewableJournalDefinition,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of definition.fieldSchema) {
    if (field.defaultValue !== undefined) {
      out[field.key] = field.defaultValue
    } else if (field.type === 'boolean') {
      out[field.key] = false
    } else if (field.type === 'multiselect') {
      out[field.key] = []
    } else {
      out[field.key] = ''
    }
  }
  return out
}
