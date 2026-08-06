/**
 * Tracker read queries.
 *
 * Reads only — writes go through ./actions.ts, which re-checks
 * `decideCanUpdateRecord` against the live user row on every upsert. The stored
 * `value` Json is opaque out of the database, so every read re-parses it via
 * `parseRecordValue`; a corrupted or old-shape row degrades to a safe default
 * rather than throwing, the same posture widgets take with snapshots.
 *
 * "Relevant record" is scope-dependent:
 *   STUDENT — the viewer's own row.
 *   BATCH   — every row whose batch the viewer belongs to.
 *   GLOBAL  — the single org-wide row.
 */

import { db } from '@/server/db'
import {
  decideTrackerRead,
  loadTrackerViewer,
  type TrackerViewer,
} from './access'
import {
  parseRecordValue,
  parseTrackerConfig,
  trackerProgress,
  decideExpiryStatus,
  type ParsedRecordValue,
  type ParsedTrackerConfig,
  type TrackerProgress,
  type ExpiryStatus,
} from './validation'
import type { Role, TrackerScope, TrackerType } from '@/generated/prisma/enums'

export interface TrackerDefinitionView {
  id: string
  key: string
  name: string
  description: string | null
  type: TrackerType
  scope: TrackerScope
  unit: string | null
  config: ParsedTrackerConfig
  remindBeforeDays: number | null
  /**
   * True only when this viewer holds `tracker:manage` — the pages use it to
   * decide whether to surface the admin console link, not to authorize writes.
   */
  canManage: boolean
}

export interface TrackerRecordView {
  id: string | null
  /** Whose record this is, for display. null on GLOBAL, or a not-yet-created row. */
  subjectUserId: string | null
  subjectBatchId: string | null
  subjectLabel: string | null
  value: ParsedRecordValue
  progress: TrackerProgress | null
  expiry: ExpiryStatus | null
  expiresAt: Date | null
  updatedAt: Date | null
  /** Re-evaluated against the viewer at render time by the action; kept for UX. */
  canUpdate: boolean
}

export interface ViewableTracker {
  definition: TrackerDefinitionView
  records: TrackerRecordView[]
}

const DEFINITION_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  type: true,
  scope: true,
  unit: true,
  config: true,
  remindBeforeDays: true,
  enabled: true,
  sortOrder: true,
} as const

interface DefinitionRow {
  id: string
  key: string
  name: string
  description: string | null
  type: TrackerType
  scope: TrackerScope
  unit: string | null
  config: unknown
  remindBeforeDays: number | null
  enabled: boolean
  sortOrder: number
}

function shapeDefinition(row: DefinitionRow) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    type: row.type,
    scope: row.scope,
    unit: row.unit,
    config: parseTrackerConfig(row.config),
    remindBeforeDays: row.remindBeforeDays,
  }
}

function shapeRecord(
  record: {
    id: string
    userId: string | null
    batchId: string | null
    value: unknown
    expiresAt: Date | null
    updatedAt: Date
  } | null,
  type: TrackerType,
  scope: TrackerScope,
  config: ParsedTrackerConfig,
  viewer: TrackerViewer,
  subjectLabel: string | null,
): TrackerRecordView {
  const value = parseRecordValue(type, record?.value)
  return {
    id: record?.id ?? null,
    subjectUserId: record?.userId ?? null,
    subjectBatchId: record?.batchId ?? null,
    subjectLabel,
    value,
    progress: trackerProgress(type, config, value),
    expiry: type === 'EXPIRY' ? decideExpiryStatus(value, record?.expiresAt ?? null, new Date()) : null,
    expiresAt: record?.expiresAt ?? null,
    updatedAt: record?.updatedAt ?? null,
    canUpdate: record !== null
      ? decideCanUpdateForRead(type, scope, record.userId, record.batchId, viewer)
      : canCreateRecord(scope, viewer),
  }
}

function decideCanUpdateForRead(
  type: TrackerType,
  scope: TrackerScope,
  userId: string | null,
  batchId: string | null,
  viewer: TrackerViewer,
): boolean {
  if (viewer.canManage) return true
  return scope === 'STUDENT' && type !== 'EXPIRY' && userId === viewer.id
}

function canCreateRecord(scope: TrackerScope, viewer: TrackerViewer): boolean {
  if (viewer.canManage) return true
  // A student creating their own STUDENT record defaults to the empty-state
  // editor on the detail page. BATCH/GLOBAL create paths live in the admin
  // console, which is canManage-gated.
  return scope === 'STUDENT'
}

/** Returns the subject label for a STUDENT-scope definition's record. */
function studentLabelFor(
  userId: string | null,
  byId: Map<string, { name: string }>,
): string | null {
  if (!userId) return null
  const user = byId.get(userId)
  return user ? user.name : null
}

function batchLabelFor(
  batchId: string | null,
  byId: Map<string, { name: string }>,
): string | null {
  if (!batchId) return null
  const batch = byId.get(batchId)
  return batch ? batch.name : null
}

async function loadSubjectNames(
  records: { userId: string | null; batchId: string | null }[],
): Promise<{ users: Map<string, { name: string }>; batches: Map<string, { name: string }> }> {
  const userIds = new Set<string>()
  const batchIds = new Set<string>()
  for (const record of records) {
    if (record.userId) userIds.add(record.userId)
    if (record.batchId) batchIds.add(record.batchId)
  }

  const users = new Map<string, { name: string }>()
  const batches = new Map<string, { name: string }>()

  if (userIds.size > 0) {
    const rows = await db.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true },
    })
    for (const row of rows) users.set(row.id, { name: row.name })
  }

  if (batchIds.size > 0) {
    const rows = await db.batch.findMany({
      where: { id: { in: [...batchIds] } },
      select: { id: true, name: true },
    })
    for (const row of rows) batches.set(row.id, { name: row.name })
  }

  return { users, batches }
}

async function viewerRecords(
  definition: DefinitionRow,
  viewer: TrackerViewer,
): Promise<TrackerRecordView[]> {
  const where =
    definition.scope === 'STUDENT'
      ? { definitionId: definition.id, userId: viewer.id, batchId: null }
      : definition.scope === 'BATCH'
        ? { definitionId: definition.id, batchId: { in: [...viewer.batchIds] } }
        : { definitionId: definition.id, userId: null, batchId: null }

  const records = await db.trackerRecord.findMany({ where })

  const { users, batches } = await loadSubjectNames(records)

  return records.map((record) =>
    shapeRecord(
      record,
      definition.type,
      definition.scope,
      parseTrackerConfig(definition.config),
      viewer,
      definition.scope === 'BATCH'
        ? batchLabelFor(record.batchId, batches)
        : studentLabelFor(record.userId, users),
    ),
  )
}

/** All enabled trackers visible to the viewer, each with their relevant records. */
export async function listTrackers(viewer: TrackerViewer): Promise<ViewableTracker[]> {
  const rows = await db.trackerDefinition.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: DEFINITION_SELECT,
  })

  const visible = rows.filter((row) => decideTrackerRead(row, viewer).ok)

  const out: ViewableTracker[] = []
  for (const row of visible) {
    const definitionView = shapeDefinition(row)
    const records = await viewerRecords(row, viewer)
    out.push({
      definition: { ...definitionView, canManage: viewer.canManage },
      records,
    })
  }
  return out
}

/** A single tracker by key, with the viewer's relevant records; null if not visible. */
export async function loadTracker(
  key: string,
  viewer: TrackerViewer,
): Promise<ViewableTracker | null> {
  const row = await db.trackerDefinition.findUnique({
    where: { key },
    select: DEFINITION_SELECT,
  })

  if (!row || !decideTrackerRead(row, viewer).ok) return null

  const definitionView = shapeDefinition(row)
  const records = await viewerRecords(row, viewer)

  return {
    definition: { ...definitionView, canManage: viewer.canManage },
    records,
  }
}

// ─── Admin console reads ───────────────────────────────────────────────────

/** Every tracker definition (enabled or not), for the admin index. */
export async function listAllTrackerDefinitions(
  viewer: TrackerViewer,
): Promise<TrackerDefinitionView[]> {
  if (!viewer.canManage) return []

  const rows = await db.trackerDefinition.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: DEFINITION_SELECT,
  })

  return rows.map((row) => ({ ...shapeDefinition(row), canManage: true }))
}

/** Loads a single definition regardless of enabled, for the admin console. */
export async function loadTrackerForAdmin(
  key: string,
  viewer: TrackerViewer,
): Promise<ViewableTracker | null> {
  if (!viewer.canManage) return null

  const row = await db.trackerDefinition.findUnique({
    where: { key },
    select: DEFINITION_SELECT,
  })

  if (!row) return null

  const definitionView = shapeDefinition(row)

  switch (row.scope) {
    case 'GLOBAL': {
      const record = await db.trackerRecord.findFirst({
        where: { definitionId: row.id, userId: null, batchId: null },
      })
      const recordView = shapeRecord(record, row.type, 'GLOBAL', definitionView.config, viewer, null)
      return { definition: { ...definitionView, canManage: true }, records: [recordView] }
    }

    case 'BATCH': {
      // Render the full batch universe so an admin can create records for
      // batches that have none yet — same posture as the student universe below.
      const batches = await db.batch.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
      const existing = await db.trackerRecord.findMany({
        where: { definitionId: row.id },
      })
      const byBatch = new Map(existing.map((record) => [record.batchId, record]))
      const recordsView = batches.map((batch) =>
        shapeRecord(
          byBatch.get(batch.id) ?? null,
          row.type,
          'BATCH',
          definitionView.config,
          viewer,
          batch.name,
        ),
      )
      return { definition: { ...definitionView, canManage: true }, records: recordsView }
    }

    case 'STUDENT': {
      const students = await db.user.findMany({
        where: { role: 'STUDENT', status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
      const existing = await db.trackerRecord.findMany({
        where: { definitionId: row.id },
      })
      const byUser = new Map(existing.map((record) => [record.userId, record]))
      const recordsView = students.map((student) =>
        shapeRecord(
          byUser.get(student.id) ?? null,
          row.type,
          'STUDENT',
          definitionView.config,
          viewer,
          student.name,
        ),
      )
      return { definition: { ...definitionView, canManage: true }, records: recordsView }
    }
  }
}

export { loadTrackerViewer }
