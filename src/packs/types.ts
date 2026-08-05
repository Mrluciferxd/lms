/**
 * Vertical pack contract.
 *
 * A pack is how an industry gets its vocabulary and its domain-specific record
 * types onto an otherwise generic LMS. Packs are declarative wherever possible
 * — they describe journals, trackers, widgets and labels as data, which the
 * installer writes into the database. Only `onInstall` and `DataFeedAdapter`
 * carry executable code.
 *
 * Nothing in core imports from a pack. Core reads pack output through the
 * registry, so a deployment with zero packs enabled is a complete, working,
 * industry-neutral LMS.
 */

// Prisma 7 emits enums into the generated client at the configured output path,
// not into the `@prisma/client` package entrypoint.
import type {
  NotificationChannelType,
  NotificationTrigger,
  Role,
  TrackerScope,
  TrackerType,
} from '@/generated/prisma/enums'

// -----------------------------------------------------------------------------
// Journals — generic structured records (forex trades, workout logs, ...)
// -----------------------------------------------------------------------------

export type JournalFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'percent'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'image'
  | 'file'
  | 'url'

export interface JournalFieldOption {
  value: string
  label: string
}

export interface PackJournalField {
  key: string
  label: string
  type: JournalFieldType
  required?: boolean
  help?: string
  placeholder?: string
  /** Required for `select` / `multiselect`. */
  options?: JournalFieldOption[]
  unit?: string
  min?: number
  max?: number
  step?: number
  defaultValue?: string | number | boolean
  /** Expression over sibling field values; field renders only when truthy. */
  showIf?: string
  /** Hidden from the entry form but still stored (set by computed/defaults). */
  hidden?: boolean
}

export interface PackJournalComputedField {
  key: string
  label: string
  /**
   * Expression evaluated server-side against the entry's field values.
   * Sandboxed: arithmetic, comparison and ternary over field keys, plus the
   * whitelisted helpers abs/min/max/round/sqrt. No property access, no
   * arbitrary calls, no assignment. Evaluates to null if any referenced field
   * is empty, so partially-filled entries never render garbage.
   * See src/server/journals/expression.ts.
   */
  expr: string
  type?: 'number' | 'currency' | 'percent' | 'text'
  unit?: string
  /** Decimal places for display. */
  precision?: number
}

export interface PackJournalDefinition {
  key: string
  name: string
  /** Singular noun used in UI copy: "Log a {singular}". */
  singular: string
  description?: string
  icon?: string
  fields: PackJournalField[]
  computed?: PackJournalComputedField[]
  /** Field keys (including computed) shown as table columns, in order. */
  listColumns?: string[]
  /** Students may author their own entries. False = instructor-only. */
  studentAuthored?: boolean
  /** Entries move through OPEN -> CLOSED (open positions, ongoing projects). */
  hasLifecycle?: boolean
}

// -----------------------------------------------------------------------------
// Trackers — counters, checklists and expiring flags
// -----------------------------------------------------------------------------

export interface PackTrackerDefinition {
  key: string
  name: string
  description?: string
  type: TrackerType
  scope?: TrackerScope
  unit?: string
  /** Type-specific: { target } for COUNTER/GAUGE, { items } for CHECKLIST. */
  config?: Record<string, unknown>
  /** Fire a reminder N days before an EXPIRY record lapses. */
  remindBeforeDays?: number
}

// -----------------------------------------------------------------------------
// Data feeds — pluggable external data (economic calendars, price tickers, ...)
// -----------------------------------------------------------------------------

export interface DataFeedContext<TConfig = Record<string, unknown>> {
  config: TConfig
  /** Only the vars named in `requiredEnv` are passed through. */
  env: Record<string, string | undefined>
  signal?: AbortSignal
}

export interface DataFeedResult<TPayload = unknown> {
  payload: TPayload
  /** Overrides the widget's configured refresh interval for this result. */
  ttlSec?: number
}

export interface DataFeedAdapter<
  TConfig = Record<string, unknown>,
  TPayload = unknown,
> {
  key: string
  name: string
  /**
   * Env vars this adapter needs. Surfaced in admin as a setup checklist, and
   * checked before the scheduler bothers calling `fetch`. Per the proposal,
   * these API subscriptions are the client's cost, so a missing key must
   * degrade gracefully rather than break the dashboard.
   */
  requiredEnv?: string[]
  /** Rendered as the admin config form for widgets using this adapter. */
  configFields?: PackJournalField[]
  fetch(ctx: DataFeedContext<TConfig>): Promise<DataFeedResult<TPayload>>
}

export type WidgetSurface =
  | 'student-dashboard'
  | 'admin-dashboard'
  | 'course-sidebar'
  | 'standalone'

export interface PackDataWidget {
  key: string
  name: string
  description?: string
  /** Must match a `DataFeedAdapter.key` registered by some enabled pack. */
  adapterKey: string
  config?: Record<string, unknown>
  refreshIntervalSec?: number
  surfaces?: WidgetSurface[]
}

// -----------------------------------------------------------------------------
// Widget snapshot envelope — the one payload shape core knows how to render
// -----------------------------------------------------------------------------

/** One row of a cached widget feed, normalized so core can render any industry. */
export interface DataWidgetItem {
  id: string
  /** ISO 8601 UTC. The UI localises to the org timezone. */
  at: string
  title: string
  /**
   * Short chip label — "HIGH", "EXAM", "APPLICATION_CLOSES", ... The adapter
   * owns the vocabulary; core renders it as an opaque badge.
   */
  badge?: string | null
  /** Secondary line under the title, e.g. actual/forecast/previous. */
  detail?: string | null
  /** External link the feed publishes, e.g. an official notification page. */
  url?: string | null
}

/**
 * The payload every `DataFeedAdapter.fetch` returns. Adapters own all vendor
 * normalization; the snapshot is opaque Json to the database and this envelope
 * to the UI, so core renders a timeline without knowing an industry. That is
 * what lets the same page serve an economic calendar and an exam calendar.
 */
export interface DataWidgetSnapshotPayload {
  items: DataWidgetItem[]
  generatedAt: string
  /** Present when no data could be retrieved. Drives the UI's setup notice. */
  unavailable?: { reason: string }
}

// -----------------------------------------------------------------------------
// Navigation, notifications, dashboard
// -----------------------------------------------------------------------------

export interface PackNavItem {
  key: string
  label: string
  href: string
  /** Lucide icon name. */
  icon?: string
  roles?: Role[]
  order?: number
}

export interface PackNotificationTemplate {
  key: string
  name: string
  subject?: string
  /** Handlebars-style body. Channels strip markup as appropriate. */
  body: string
  channels: NotificationChannelType[]
  variables?: { key: string; description?: string }[]
}

export interface PackNotificationRule {
  key: string
  name: string
  trigger: NotificationTrigger
  /** References a template key from this pack or from core. */
  templateKey: string
  channels: NotificationChannelType[]
  /** Negative = before the anchor event. */
  offsetMinutes?: number
  enabled?: boolean
}

// -----------------------------------------------------------------------------
// Install hook
// -----------------------------------------------------------------------------

export interface PackInstallContext {
  /** Narrow surface so packs cannot reach arbitrary tables. */
  seedChannel(input: { slug: string; name: string; description?: string }): Promise<void>
  seedPage(input: { slug: string; title: string; blocks: unknown[] }): Promise<void>
  log(message: string): void
}

// -----------------------------------------------------------------------------
// The pack itself
// -----------------------------------------------------------------------------

export interface VerticalPack {
  key: string
  name: string
  version: string
  description?: string

  /**
   * Overrides core UI strings so a generic feature reads as native to the
   * industry. Keys are dotted paths from src/lib/labels.ts — for example
   * `liveSession.kind.BROADCAST` -> "Live Market Session".
   * Unknown keys are ignored, so a label rename in core degrades to the
   * default rather than crashing the pack.
   */
  labels?: Record<string, string>

  journals?: PackJournalDefinition[]
  trackers?: PackTrackerDefinition[]
  dataAdapters?: DataFeedAdapter<never, never>[]
  dataWidgets?: PackDataWidget[]
  navItems?: PackNavItem[]
  notificationTemplates?: PackNotificationTemplate[]
  notificationRules?: PackNotificationRule[]

  onInstall?(ctx: PackInstallContext): Promise<void>
}

/** Identity helper that pins the type without widening literals. */
export function definePack(pack: VerticalPack): VerticalPack {
  return pack
}
