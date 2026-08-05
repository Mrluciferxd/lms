/**
 * Widget read queries.
 *
 * Reads only — snapshots are written exclusively by the refresh worker in
 * ./refresh.ts, which runs on the cron route and never as a user. The payload
 * is opaque Json out of the database, so every read re-validates it against
 * the `DataWidgetSnapshotPayload` envelope before the page touches it: a row
 * corrupted by hand, by an old adapter, or by a future one must degrade to an
 * empty timeline, never throw or render attacker-shaped HTML.
 */

import { db } from '@/server/db'
import { dataAdapters } from '@/lib/brand'
import { decideWidgetVisibility, isStandaloneWidget, type WidgetViewer } from './access'

/** One rendered row of a widget timeline, fully validated. */
export interface ViewableWidgetItem {
  id: string
  at: Date
  title: string
  badge: string | null
  detail: string | null
  url: string | null
}

export interface ViewableWidget {
  id: string
  key: string
  name: string
  description: string | null
  /** Adapter display name; falls back to the adapter key when no pack claims it. */
  adapterName: string
  items: ViewableWidgetItem[]
  /** When the adapter last produced data. Null until the first refresh. */
  generatedAt: Date | null
  /** Present when the latest snapshot could not retrieve data. */
  unavailable: { reason: string } | null
  fetchedAt: Date | null
  expiresAt: Date | null
  /** Set only when `fetch` threw; adapter-reported failures ride in `unavailable`. */
  error: string | null
  refreshIntervalSec: number
}

export interface ParsedSnapshot {
  items: ViewableWidgetItem[]
  generatedAt: Date | null
  unavailable: { reason: string } | null
}

function parseWidgetItem(raw: unknown, index: number): ViewableWidgetItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>

  const title = typeof row.title === 'string' && row.title.trim() !== '' ? row.title.trim() : null
  const at = typeof row.at === 'string' ? new Date(row.at) : null
  if (!title || !at || Number.isNaN(at.getTime())) return null

  return {
    id: typeof row.id === 'string' && row.id !== '' ? row.id : `item-${index}`,
    at,
    title,
    badge: typeof row.badge === 'string' && row.badge !== '' ? row.badge : null,
    detail: typeof row.detail === 'string' && row.detail !== '' ? row.detail : null,
    url: typeof row.url === 'string' && row.url !== '' ? row.url : null,
  }
}

/**
 * Validates a stored snapshot against the envelope. Exporting it (rather than
 * keeping it private to this module) is what lets the unit tests corrupt the
 * payload shape on purpose; the DB layer never sees these cases.
 */
export function parseSnapshotPayload(raw: unknown): ParsedSnapshot {
  const parsed: ParsedSnapshot = { items: [], generatedAt: null, unavailable: null }
  if (typeof raw !== 'object' || raw === null) return parsed

  const source = raw as Record<string, unknown>

  if (typeof source.generatedAt === 'string') {
    const generatedAt = new Date(source.generatedAt)
    if (!Number.isNaN(generatedAt.getTime())) parsed.generatedAt = generatedAt
  }

  const unavailable = source.unavailable
  if (typeof unavailable === 'object' && unavailable !== null) {
    const reason = (unavailable as Record<string, unknown>).reason
    parsed.unavailable = {
      reason: typeof reason === 'string' && reason.trim() !== '' ? reason : 'Feed unavailable.',
    }
  }

  if (Array.isArray(source.items)) {
    parsed.items = source.items
      .map(parseWidgetItem)
      .filter((item): item is ViewableWidgetItem => item !== null)
      .sort((a, b) => a.at.getTime() - b.at.getTime())
  }

  return parsed
}

const DEFINITION_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  packKey: true,
  adapterKey: true,
  config: true,
  refreshIntervalSec: true,
  surfaces: true,
  enabled: true,
  sortOrder: true,
} as const

async function latestSnapshotFor(definitionId: string) {
  return db.dataWidgetSnapshot.findFirst({
    where: { definitionId },
    orderBy: { fetchedAt: 'desc' },
    select: { payload: true, fetchedAt: true, expiresAt: true, error: true },
  })
}

async function shapeWidget(
  row: {
    id: string
    key: string
    name: string
    description: string | null
    adapterKey: string
    refreshIntervalSec: number
  },
  snapshot: Awaited<ReturnType<typeof latestSnapshotFor>> | null,
): Promise<ViewableWidget> {
  const payload = snapshot ? parseSnapshotPayload(snapshot.payload) : null
  const adapter = dataAdapters.get(row.adapterKey)

  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    adapterName: adapter?.name ?? row.adapterKey,
    items: payload?.items ?? [],
    generatedAt: payload?.generatedAt ?? null,
    unavailable: payload?.unavailable ?? null,
    fetchedAt: snapshot?.fetchedAt ?? null,
    expiresAt: snapshot?.expiresAt ?? null,
    error: snapshot?.error ?? null,
    refreshIntervalSec: row.refreshIntervalSec,
  }
}

/** All enabled widgets that declare the standalone surface, for the sidebar. */
export async function listStandaloneWidgets(viewer: WidgetViewer): Promise<ViewableWidget[]> {
  const rows = await db.dataWidgetDefinition.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: DEFINITION_SELECT,
  })

  const standalone = rows.filter(
    (row) => decideWidgetVisibility(row, viewer).visible && isStandaloneWidget(row),
  )

  const snapshots = await db.dataWidgetSnapshot.findMany({
    where: { definitionId: { in: standalone.map((row) => row.id) } },
    orderBy: { fetchedAt: 'desc' },
    select: {
      id: true,
      definitionId: true,
      payload: true,
      fetchedAt: true,
      expiresAt: true,
      error: true,
    },
  })

  // Group by definition keeping the most recent snapshot per widget.
  const latest = new Map<string, (typeof snapshots)[number]>()
  for (const snapshot of snapshots) {
    if (!latest.has(snapshot.definitionId)) latest.set(snapshot.definitionId, snapshot)
  }

  return Promise.all(
    standalone.map((row) => shapeWidget(row, latest.get(row.id) ?? null)),
  )
}

/** Loads a single standalone widget by key; null when missing or not visible. */
export async function loadWidget(
  key: string,
  viewer: WidgetViewer,
): Promise<ViewableWidget | null> {
  const row = await db.dataWidgetDefinition.findUnique({
    where: { key },
    select: DEFINITION_SELECT,
  })

  if (!row) return null
  if (!decideWidgetVisibility(row, viewer).visible) return null
  if (!isStandaloneWidget(row)) return null

  return shapeWidget(row, await latestSnapshotFor(row.id))
}
