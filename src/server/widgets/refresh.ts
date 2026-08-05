/**
 * Widget refresh worker.
 *
 * The only writer of `DataWidgetSnapshot`. Fetching happens on the cron route,
 * never in the request path, so a slow or flaky vendor feed cannot cost a page
 * load — the page always renders whatever snapshot exists, and the refresh job
 * tops it up.
 *
 * The adapter contract already promises graceful degradation (`unavailable`
 * instead of a throw), but we still catch defensively: a buggy pack adapter or
 * an abort from the timeout is a *recorded* failure, not a retry storm.
 *
 * Concurrency: a module-level in-flight map makes overlapping cron runs (or a
 * manual admin trigger racing the scheduler) collapse into one fetch per
 * widget instead of doubling the vendor's rate-limit spend.
 */

import { dataAdapters } from '@/lib/brand'
import { db } from '@/server/db'
import type {
  DataFeedContext,
  DataFeedResult,
  DataWidgetSnapshotPayload,
} from '@/packs/types'

/**
 * The registry stores adapters as `DataFeedAdapter<never, never>`, which is
 * useless for calling. This is the narrow runtime shape the worker needs; the
 * cast is the single place pack typing meets database Json.
 */
interface AnyDataFeedAdapter {
  key: string
  name: string
  requiredEnv?: readonly string[]
  fetch(ctx: DataFeedContext<Record<string, unknown>>): Promise<DataFeedResult<unknown>>
}

/** How long a single vendor call may take before the worker moves on. */
const FETCH_TIMEOUT_MS = 30_000
/** Retry window for a throw — mirrors the transport's transient retry. */
const RETRY_TRANSIENT_SEC = 300

type Json = Parameters<typeof db.dataWidgetSnapshot.create>[0]['data']['payload']

function asJson(value: unknown): Json {
  return value as Json
}

/** Only the vars the adapter declared in `requiredEnv` are handed to it. */
function adapterEnv(adapter: AnyDataFeedAdapter): Record<string, string | undefined> {
  return Object.fromEntries(
    (adapter.requiredEnv ?? []).map((name) => [name, process.env[name]]),
  )
}

/** In-flight fetches per definition id; keeps overlapping runs to one call. */
const inFlight = new Map<string, Promise<void>>()

export interface RefreshOutcome {
  ok: boolean
  reason?: 'not-found' | 'disabled' | 'no-adapter' | 'already-running' | 'fetched'
}

/**
 * Fetches one widget through its adapter and persists a fresh snapshot.
 * Returns ok even when the fetch itself degrades to `unavailable` — recording
 * the setup notice *is* a successful refresh.
 */
export async function refreshWidget(definitionId: string): Promise<RefreshOutcome> {
  if (inFlight.has(definitionId)) return { ok: true, reason: 'already-running' }

  const definition = await db.dataWidgetDefinition.findUnique({
    where: { id: definitionId },
    select: { id: true, enabled: true, adapterKey: true, config: true, refreshIntervalSec: true },
  })
  if (!definition) return { ok: false, reason: 'not-found' }
  if (!definition.enabled) return { ok: false, reason: 'disabled' }

  const adapter = dataAdapters.get(definition.adapterKey) as AnyDataFeedAdapter | undefined
  if (!adapter) return { ok: false, reason: 'no-adapter' }

  const run = (async () => {
    let payload: DataWidgetSnapshotPayload
    let ttlSec: number | undefined
    let error: string | null = null

    try {
      const result = await adapter.fetch({
        config: definition.config as Record<string, unknown>,
        env: adapterEnv(adapter),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      // A pack bug returning a non-envelope payload is the reader's problem to
      // absorb; we persist what the adapter said, envelope or not.
      payload = (result.payload as DataWidgetSnapshotPayload) ?? {
        items: [],
        generatedAt: new Date().toISOString(),
        unavailable: { reason: 'Adapter returned an empty result.' },
      }
      ttlSec = result.ttlSec
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'unknown error'
      payload = {
        items: [],
        generatedAt: new Date().toISOString(),
        unavailable: { reason: `Feed fetch failed: ${message}` },
      }
      error = message
      ttlSec = RETRY_TRANSIENT_SEC
    }

    const fetchedAt = new Date()
    const expiresInSec = ttlSec ?? definition.refreshIntervalSec
    await db.dataWidgetSnapshot.create({
      data: {
        definitionId,
        payload: asJson(payload),
        fetchedAt,
        expiresAt: new Date(fetchedAt.getTime() + expiresInSec * 1000),
        error,
      },
    })
  })()

  inFlight.set(definitionId, run)
  try {
    await run
    return { ok: true, reason: 'fetched' }
  } finally {
    inFlight.delete(definitionId)
  }
}

export interface WidgetRefreshReport {
  checked: number
  refreshed: number
  skipped: number
}

/**
 * Refreshes every enabled widget whose newest snapshot is missing or expired.
 * `force` ignores expiry and refreshes all — the manual/admin trigger.
 * Idempotent: the in-flight map collapses concurrent runs, and a snapshot that
 * is still fresh is simply skipped.
 */
export async function refreshDueWidgets(
  now = new Date(),
  force = false,
): Promise<WidgetRefreshReport> {
  const definitions = await db.dataWidgetDefinition.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true },
  })

  const report: WidgetRefreshReport = { checked: definitions.length, refreshed: 0, skipped: 0 }

  for (const definition of definitions) {
    const latest = await db.dataWidgetSnapshot.findFirst({
      where: { definitionId: definition.id },
      orderBy: { fetchedAt: 'desc' },
      select: { expiresAt: true },
    })

    const due = force || !latest || latest.expiresAt <= now
    if (!due) {
      report.skipped += 1
      continue
    }

    const outcome = await refreshWidget(definition.id)
    if (outcome.ok) report.refreshed += 1
    else report.skipped += 1
  }

  return report
}
