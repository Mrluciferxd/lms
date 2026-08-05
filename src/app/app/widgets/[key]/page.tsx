import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { formatDate } from '@/lib/utils'
import { requireUser } from '@/server/auth/rbac'
import { isFeatureEnabled, getOrgSettings } from '@/server/org/settings'
import { loadWidgetViewer } from '@/server/widgets/access'
import {
  listStandaloneWidgets,
  loadWidget,
  type ViewableWidget,
  type ViewableWidgetItem,
} from '@/server/widgets/widgets'

export const metadata: Metadata = { title: 'Data Widgets' }

interface WidgetGroup {
  key: string
  label: string
  items: ViewableWidgetItem[]
}

export default async function WidgetPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  if (!(await isFeatureEnabled('dataWidgets'))) notFound()
  const user = await requireUser('/app/widgets')

  const { key } = await params
  const viewer = await loadWidgetViewer(user.id)
  if (!viewer) notFound()

  // Sidebar of every standalone widget (so /app/widgets/<key> comes with a
  // sitemap alongside), mirroring the journal list layout.
  const [sidebar, widget] = await Promise.all([
    listStandaloneWidgets(viewer),
    loadWidget(key, viewer),
  ])

  if (!widget) notFound()

  const settings = await getOrgSettings()
  const timezone = settings.timezone
  const locale = settings.locale
  const groups = groupByDay(widget, timezone, locale)

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      {/* Sidebar — the standalone widget list */}
      <nav aria-labelledby="widgets-heading" className="space-y-2">
        <h2
          id="widgets-heading"
          className="text-xs font-medium uppercase tracking-wide text-content-muted"
        >
          Data
        </h2>
        <ul className="space-y-1">
          {sidebar.map((item) => (
            <li key={item.key}>
              <Link
                href={`/app/widgets/${item.key}`}
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
          <h1 className="text-2xl font-semibold text-content">{widget.name}</h1>
          {widget.description && (
            <p className="text-sm text-content-muted">{widget.description}</p>
          )}
        </header>

        {widget.unavailable && (
          <p
            role="status"
            className="rounded-brand border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
          >
            {widget.unavailable.reason}
          </p>
        )}
        {!widget.unavailable && widget.error && (
          <p
            role="alert"
            className="rounded-brand border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          >
            {widget.error}
          </p>
        )}

        {groups.length === 0 ? (
          <p className="rounded-brand border border-surface-border bg-surface-muted px-4 py-6 text-sm text-content-muted">
            No items in view yet.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border rounded-brand border border-surface-border">
            {groups.map((group) => (
              <li key={group.key} className="px-4 py-3">
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-content-muted">
                  {group.label}
                </h2>
                <ul className="divide-y divide-surface-border">
                  {group.items.map((item) => (
                    <WidgetItemRow key={item.id} item={item} timezone={timezone} locale={locale} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-content-muted">
          {widget.fetchedAt
            ? `Fetched ${formatDate(widget.fetchedAt, timezone, locale)} · updates every ${refreshLabel(widget.refreshIntervalSec)}`
            : 'No data yet — the first refresh runs shortly.'}
        </p>
      </div>
    </div>
  )
}

function WidgetItemRow({
  item,
  timezone,
  locale,
}: {
  item: ViewableWidgetItem
  timezone: string
  locale: string
}) {
  return (
    <li className="flex items-start gap-3 py-2">
      <time
        dateTime={item.at.toISOString()}
        className="w-16 shrink-0 pt-0.5 text-right text-sm tabular-nums text-content-muted"
      >
        {formatDate(item.at, timezone, locale, { timeStyle: 'short' })}
      </time>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {item.badge && (
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-content-muted">
              {item.badge}
            </span>
          )}
          <p className="text-sm text-content">{item.title}</p>
        </div>
        {item.detail && (
          <p className="mt-0.5 truncate text-xs text-content-muted">{item.detail}</p>
        )}
      </div>
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open official page for ${item.title}`}
          className="shrink-0 pt-0.5 text-content-muted hover:text-content"
        >
          ↗
        </a>
      )}
    </li>
  )
}

/**
 * Groups items by their local day in the org timezone. Items arrive sorted by
 * `at` ascending; contiguous days collapse into one heading. The key is a
 * timezone-aware yyyy-mm-dd so grouping never shifts a midnight release to the
 * wrong day for the viewer.
 */
function groupByDay(widget: ViewableWidget, timezone: string, locale: string): WidgetGroup[] {
  const todayKey = dayKey(new Date(), timezone)
  const tomorrowKey = dayKey(new Date(Date.now() + 86_400_000), timezone)

  const groups: WidgetGroup[] = []
  for (const item of widget.items) {
    const key = dayKey(item.at, timezone)
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.items.push(item)
    } else {
      const label =
        key === todayKey
          ? 'Today'
          : key === tomorrowKey
            ? 'Tomorrow'
            : formatDate(item.at, timezone, locale, { dateStyle: 'full' })
      groups.push({ key, label, items: [item] })
    }
  }
  return groups
}

function dayKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function refreshLabel(intervalSec: number): string {
  const minutes = Math.round(intervalSec / 60)
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60)
    return `${hours}h`
  }
  return `${minutes} min`
}
