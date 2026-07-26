/**
 * Exam calendar data feed — application windows, admit cards, exam and result
 * dates for the exams an institute prepares students for.
 *
 * Structurally the same as the forex pack's economic calendar, and about a third
 * of the length, because the transport and field-probing live in
 * ../shared/rest-feed. That ratio is the point: the second vertical is cheap.
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

export type ExamMilestone =
  | 'APPLICATION_OPENS'
  | 'APPLICATION_CLOSES'
  | 'ADMIT_CARD'
  | 'EXAM'
  | 'RESULT'
  | 'COUNSELLING'
  | 'OTHER'

export interface ExamDate {
  id: string
  /** ISO 8601. The UI localises to the org timezone. */
  date: string
  title: string
  exam: string | null
  milestone: ExamMilestone
  board: string | null
  url: string | null
}

export interface ExamCalendarPayload {
  dates: ExamDate[]
  generatedAt: string
  unavailable?: { reason: string }
}

export interface ExamCalendarConfig {
  /** Restrict to the exams this institute coaches for. Empty = all. */
  exams?: string[]
  lookaheadDays?: number
}

const REQUIRED_ENV = ['EXAM_CALENDAR_API_URL', 'EXAM_CALENDAR_API_KEY'] as const

const MILESTONE_PATTERNS: Array<[RegExp, ExamMilestone]> = [
  [/admit\s*card|hall\s*ticket/i, 'ADMIT_CARD'],
  [/result|score\s*card/i, 'RESULT'],
  [/counsel/i, 'COUNSELLING'],
  [/(applicat|registrat).*(close|last|end|deadline)|last\s*date/i, 'APPLICATION_CLOSES'],
  [/(applicat|registrat).*(open|start|begin)/i, 'APPLICATION_OPENS'],
  [/exam|paper|test/i, 'EXAM'],
]

/**
 * Feeds rarely publish a machine-readable milestone type, so it is inferred from
 * an explicit field when present and from the title otherwise. Order matters:
 * "last date to apply" must match the closes pattern before the generic one.
 */
function inferMilestone(row: Record<string, unknown>, title: string): ExamMilestone {
  const explicit = firstString(row, ['milestone', 'type', 'eventType', 'category'])
  const haystack = `${explicit ?? ''} ${title}`
  for (const [pattern, milestone] of MILESTONE_PATTERNS) {
    if (pattern.test(haystack)) return milestone
  }
  return 'OTHER'
}

function normaliseDate(raw: unknown, index: number): ExamDate | null {
  const row = asRow(raw)
  if (!row) return null

  const title = firstString(row, ['title', 'event', 'name', 'description'])
  const date = parseDate(firstString(row, ['date', 'eventDate', 'datetime', 'time', 'deadline']))
  if (!title || !date) return null

  return {
    id: firstString(row, ['id', 'eventId']) ?? `${date.toISOString()}-${index}`,
    date: date.toISOString(),
    title,
    exam: firstString(row, ['exam', 'examName', 'examination']),
    milestone: inferMilestone(row, title),
    board: firstString(row, ['board', 'authority', 'conductedBy', 'organisation']),
    url: firstString(row, ['url', 'link', 'officialUrl']),
  }
}

function unavailable(reason: string, ttlSec: number): DataFeedResult<ExamCalendarPayload> {
  return {
    payload: { dates: [], generatedAt: new Date().toISOString(), unavailable: { reason } },
    ttlSec,
  }
}

export const examCalendarAdapter: DataFeedAdapter<ExamCalendarConfig, ExamCalendarPayload> = {
  key: 'coaching.exam-calendar',
  name: 'Exam Calendar (generic REST)',
  requiredEnv: [...REQUIRED_ENV],

  configFields: [
    {
      key: 'exams',
      label: 'Exams tracked',
      type: 'multiselect',
      options: ['JEE Main', 'JEE Advanced', 'NEET', 'CUET', 'UPSC CSE', 'CAT', 'GATE', 'CLAT'].map(
        (name) => ({ value: name, label: name }),
      ),
      help: 'Leave empty to show every exam the feed returns.',
    },
    { key: 'lookaheadDays', label: 'Days ahead', type: 'number', min: 7, max: 365, defaultValue: 90 },
  ],

  async fetch(
    ctx: DataFeedContext<ExamCalendarConfig>,
  ): Promise<DataFeedResult<ExamCalendarPayload>> {
    const absent = missingEnv(ctx.env, REQUIRED_ENV)
    if (absent.length > 0) {
      return unavailable(
        `Exam calendar feed is not configured. Set ${absent.join(' and ')}.`,
        RETRY_UNCONFIGURED_SEC,
      )
    }

    const lookaheadDays = ctx.config.lookaheadDays ?? 90
    const from = new Date()
    const to = new Date(from.getTime() + lookaheadDays * 86_400_000)

    const outcome = await fetchJsonFeed({
      baseUrl: ctx.env.EXAM_CALENDAR_API_URL!,
      apiKey: ctx.env.EXAM_CALENDAR_API_KEY!,
      params: {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        exams: ctx.config.exams?.length ? ctx.config.exams.join(',') : undefined,
      },
      signal: ctx.signal,
    })

    if (!outcome.ok) return unavailable(outcome.reason, outcome.ttlSec)

    const wanted = new Set((ctx.config.exams ?? []).map((name) => name.toLowerCase()))

    const dates = extractRows(outcome.body)
      .map(normaliseDate)
      .filter((entry): entry is ExamDate => entry !== null)
      .filter((entry) => wanted.size === 0 || (entry.exam && wanted.has(entry.exam.toLowerCase())))
      .sort((a, b) => a.date.localeCompare(b.date))

    return { payload: { dates, generatedAt: new Date().toISOString() } }
  },
}
