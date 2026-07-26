/**
 * Economic calendar data feed.
 *
 * The proposal explicitly excludes third-party API licensing from the build fee —
 * the client procures and pays for the feed. So this adapter is provider-agnostic
 * against a configurable REST endpoint and normalises whatever shape comes back,
 * rather than binding us to one vendor whose pricing the client may want to change.
 *
 * Transport, error mapping and field probing come from ../shared/rest-feed.
 */

import type { DataFeedAdapter, DataFeedContext, DataFeedResult } from '../types'
import {
  RETRY_UNCONFIGURED_SEC,
  asRow,
  extractRows,
  fetchJsonFeed,
  firstString,
  missingEnv,
  parseDate,
} from '../shared/rest-feed'

export type EventImpact = 'LOW' | 'MEDIUM' | 'HIGH'

export interface EconomicEvent {
  id: string
  /** ISO 8601 UTC. The UI localises to the org timezone. */
  time: string
  country: string | null
  currency: string | null
  title: string
  impact: EventImpact
  actual: string | null
  forecast: string | null
  previous: string | null
}

export interface EconomicCalendarPayload {
  events: EconomicEvent[]
  generatedAt: string
  /** Present when no data could be retrieved. Drives the UI's setup notice. */
  unavailable?: { reason: string }
}

export interface EconomicCalendarConfig {
  /** Filter to these currency codes. Empty = no filter. */
  currencies?: string[]
  minImpact?: EventImpact
  lookaheadDays?: number
}

const IMPACT_RANK: Record<EventImpact, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 }

const REQUIRED_ENV = ['ECONOMIC_CALENDAR_API_URL', 'ECONOMIC_CALENDAR_API_KEY'] as const

/** Vendors send "High", "high", 3, "3", or a volatility word. */
function normaliseImpact(raw: unknown): EventImpact {
  if (typeof raw === 'number') return raw >= 3 ? 'HIGH' : raw === 2 ? 'MEDIUM' : 'LOW'
  const value = String(raw ?? '').trim().toUpperCase()
  if (value === 'HIGH' || value === '3') return 'HIGH'
  if (value === 'MEDIUM' || value === 'MODERATE' || value === '2') return 'MEDIUM'
  return 'LOW'
}

function normaliseEvent(raw: unknown, index: number): EconomicEvent | null {
  const row = asRow(raw)
  if (!row) return null

  const title = firstString(row, ['title', 'event', 'name', 'indicator'])
  const time = parseDate(firstString(row, ['time', 'date', 'datetime', 'timestamp', 'releaseDate']))
  if (!title || !time) return null

  return {
    id: firstString(row, ['id', 'eventId', 'calendarId']) ?? `${time.toISOString()}-${index}`,
    time: time.toISOString(),
    country: firstString(row, ['country', 'countryCode', 'region']),
    currency: firstString(row, ['currency', 'currencyCode', 'symbol'])?.toUpperCase() ?? null,
    title,
    impact: normaliseImpact(row.impact ?? row.importance ?? row.volatility),
    actual: firstString(row, ['actual', 'actualValue']),
    forecast: firstString(row, ['forecast', 'consensus', 'estimate']),
    previous: firstString(row, ['previous', 'prior', 'previousValue']),
  }
}

function unavailable(
  reason: string,
  ttlSec: number,
): DataFeedResult<EconomicCalendarPayload> {
  return {
    payload: { events: [], generatedAt: new Date().toISOString(), unavailable: { reason } },
    ttlSec,
  }
}

export const economicCalendarAdapter: DataFeedAdapter<
  EconomicCalendarConfig,
  EconomicCalendarPayload
> = {
  key: 'forex.economic-calendar',
  name: 'Economic Calendar (generic REST)',
  requiredEnv: [...REQUIRED_ENV],

  configFields: [
    {
      key: 'currencies',
      label: 'Currencies',
      type: 'multiselect',
      options: ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'INR', 'CNY'].map(
        (code) => ({ value: code, label: code }),
      ),
      help: 'Leave empty to show every currency.',
    },
    {
      key: 'minImpact',
      label: 'Minimum impact',
      type: 'select',
      options: [
        { value: 'LOW', label: 'All events' },
        { value: 'MEDIUM', label: 'Medium and high' },
        { value: 'HIGH', label: 'High impact only' },
      ],
      defaultValue: 'MEDIUM',
    },
    { key: 'lookaheadDays', label: 'Days ahead', type: 'number', min: 1, max: 30, defaultValue: 7 },
  ],

  async fetch(
    ctx: DataFeedContext<EconomicCalendarConfig>,
  ): Promise<DataFeedResult<EconomicCalendarPayload>> {
    const absent = missingEnv(ctx.env, REQUIRED_ENV)
    if (absent.length > 0) {
      return unavailable(
        `Economic calendar feed is not configured. Set ${absent.join(' and ')}.`,
        RETRY_UNCONFIGURED_SEC,
      )
    }

    const lookaheadDays = ctx.config.lookaheadDays ?? 7
    const from = new Date()
    const to = new Date(from.getTime() + lookaheadDays * 86_400_000)

    const outcome = await fetchJsonFeed({
      baseUrl: ctx.env.ECONOMIC_CALENDAR_API_URL!,
      apiKey: ctx.env.ECONOMIC_CALENDAR_API_KEY!,
      params: {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        currencies: ctx.config.currencies?.length
          ? ctx.config.currencies.join(',')
          : undefined,
      },
      signal: ctx.signal,
    })

    if (!outcome.ok) return unavailable(outcome.reason, outcome.ttlSec)

    const minRank = IMPACT_RANK[ctx.config.minImpact ?? 'LOW']
    const wanted = new Set((ctx.config.currencies ?? []).map((code) => code.toUpperCase()))

    const events = extractRows(outcome.body)
      .map(normaliseEvent)
      .filter((event): event is EconomicEvent => event !== null)
      .filter((event) => IMPACT_RANK[event.impact] >= minRank)
      .filter((event) => wanted.size === 0 || (event.currency && wanted.has(event.currency)))
      .sort((a, b) => a.time.localeCompare(b.time))

    return { payload: { events, generatedAt: new Date().toISOString() } }
  },
}
