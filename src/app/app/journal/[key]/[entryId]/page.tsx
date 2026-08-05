import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { formatDateTime } from '@/lib/utils'
import { requireUser } from '@/server/auth/rbac'
import { isFeatureEnabled, getOrgSettings } from '@/server/org/settings'
import { loadJournalViewer } from '@/server/journals/access'
import {
  loadJournalDefinition,
  loadJournalEntry,
  listJournalEntryComments,
  type ViewableJournalDefinition,
  type ViewableJournalEntry,
} from '@/server/journals/journals'
import { CommentEditor } from '@/components/journals/comment-editor'
import { LifecycleButtons } from '@/components/journals/lifecycle-buttons'

export const metadata: Metadata = { title: 'Journal entry' }

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ key: string; entryId: string }>
}) {
  if (!(await isFeatureEnabled('journals'))) notFound()
  const user = await requireUser('/app')

  const { key, entryId } = await params
  const viewer = await loadJournalViewer(user.id)
  if (!viewer) notFound()

  const definition = await loadJournalDefinition(key, viewer)
  if (!definition) notFound()

  const entry = await loadJournalEntry(entryId, viewer, definition)
  if (!entry) notFound()

  const settings = await getOrgSettings()
  const format = (date: Date) =>
    formatDateTime(date, settings.timezone, settings.locale)

  const comments = await listJournalEntryComments(entryId)
  const isAuthor = entry.authorId === user.id
  const canReview = viewer.canReview
  const canEdit = isAuthor || canReview
  const canClose = canEdit && definition.hasLifecycle
  const canComment =
    isAuthor ||
    canReview ||
    (entry.visibility === 'INSTRUCTORS' && user.role !== 'STUDENT') ||
    entry.visibility === 'PUBLIC' ||
    (entry.visibility === 'BATCH' &&
      entry.batchId !== null &&
      viewer.batchIds.includes(entry.batchId))

  const visibleFields = definition.fieldSchema.filter((field) => !field.hidden)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs text-content-muted">
          <a
            href={`/app/journal/${key}`}
            className="hover:text-primary"
          >
            {definition.name}
          </a>{' '}
          / {definition.singular}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {definition.hasLifecycle && (
            <span
              className={
                'rounded-full px-2 py-0.5 text-xs uppercase tracking-wide ' +
                (entry.status === 'CLOSED'
                  ? 'bg-surface-muted text-content-muted'
                  : 'bg-info/10 text-info')
              }
            >
              {entry.status.toLowerCase()}
            </span>
          )}
          <span className="text-xs text-content-muted">
            · {entry.authorName} · {format(entry.openedAt)}
          </span>
          {entry.closedAt && (
            <span className="text-xs text-content-muted">
              · closed {format(entry.closedAt)}
            </span>
          )}
          {entry.visibility !== 'PRIVATE' && (
            <span className="text-xs text-content-muted">
              · {entry.visibility.toLowerCase()}
            </span>
          )}
        </div>
      </header>

      <section aria-labelledby="fields-heading" className="space-y-3">
        <h2
          id="fields-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Fields
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          {visibleFields.map((field) => (
            <div key={field.key} className="min-w-0">
              <dt className="truncate text-xs text-content-muted">{field.label}</dt>
              <dd className="whitespace-pre-wrap break-words text-content">
                {formatValue(entry.data[field.key], field.type)}
              </dd>
            </div>
          ))}
          {definition.computedFields.map((field) => (
            <div key={field.key} className="min-w-0">
              <dt className="truncate text-xs text-content-muted">{field.label}</dt>
              <dd className="text-content">{String(entry.computed[field.key] ?? '—')}</dd>
            </div>
          ))}
        </dl>
      </section>

      {canClose && (
        <LifecycleButtons entryId={entry.id} status={entry.status} />
      )}

      <section aria-labelledby="comments-heading" className="space-y-3">
        <h2
          id="comments-heading"
          className="text-sm font-medium uppercase tracking-wide text-content-muted"
        >
          Comments ({comments.length})
        </h2>

        {comments.length === 0 ? (
          <p className="text-xs text-content-muted">No comments yet.</p>
        ) : (
          <ul className="space-y-3">
            {comments.map((comment) => (
              <li
                key={comment.id}
                className="rounded-brand border border-surface-border bg-surface-muted px-4 py-2"
              >
                <p className="text-xs text-content-muted">
                  {comment.authorName} · {format(comment.createdAt)}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm text-content">
                  {comment.body}
                </p>
              </li>
            ))}
          </ul>
        )}

        {canComment ? (
          <CommentEditor entryId={entry.id} />
        ) : (
          <p className="text-xs text-content-muted">
            You cannot comment on this entry.
          </p>
        )}
      </section>
    </div>
  )
}

function formatValue(value: unknown, type: string): string {
  if (value === undefined || value === null || value === '') return '—'
  if (type === 'multiselect' && Array.isArray(value)) return (value as string[]).join(', ')
  if (type === 'boolean') return value === true ? 'yes' : value === false ? 'no' : '—'
  if (type === 'url' && typeof value === 'string') {
    try {
      return new URL(value).hostname
    } catch {
      return String(value)
    }
  }
  return String(value)
}
