/**
 * Journal read queries.
 *
 * Reads only — every mutating call goes through ./actions.ts. The split
 * matches ../chat/channels.ts and ../assignments/assignments.ts: every
 * exported async in a `'use server'` module is a callable endpoint, so report
 * queries that take ids from the caller must not live there.
 *
 * Computed fields are evaluated here on read, against the entry's own data —
 * the sandboxed evaluator in expression.ts is the only path to evaluate
 * admin-authored expressions, and the invariants there are load-bearing (see
 * knowledge-base/decisions.md and the 13 containment tests). We never persist
 * a computed value, so an edit to `entryPrice` immediately re-flows `pnlAmount`.
 */

import { db } from '@/server/db'
import { evaluateExpression } from './expression'
import {
  decideEntryVisibility,
  decideJournalVisibility,
  type JournalViewer,
} from './access'
import type { JournalEntryStatus, JournalVisibility } from '@/generated/prisma/enums'
import type { JournalFieldSchema, JournalFieldType } from './validation'
import type { ExprValue } from './expression'

/** A viewable journal definition, with the field schema parsed from JSON. */
export interface ViewableJournalDefinition {
  id: string
  key: string
  name: string
  singular: string
  description: string | null
  icon: string | null
  fieldSchema: JournalFieldSchema[]
  computedFields: ComputedFieldSchema[]
  listColumns: string[]
  studentAuthored: boolean
  hasLifecycle: boolean
}

export interface ComputedFieldSchema {
  key: string
  label: string
  expr: string
  type?: 'number' | 'currency' | 'percent' | 'text'
  unit?: string
  precision?: number
}

/** Coerces the JSON-stored schema to our typed read; JsEnv is untyped JSON. */
function readFieldSchema(raw: unknown): JournalFieldSchema[] {
  if (!Array.isArray(raw)) return []
  return raw as unknown as JournalFieldSchema[]
}

function readComputed(raw: unknown): ComputedFieldSchema[] {
  if (!Array.isArray(raw)) return []
  return raw as unknown as ComputedFieldSchema[]
}

const DEFINITION_SELECT = {
  id: true,
  key: true,
  name: true,
  singular: true,
  description: true,
  icon: true,
  fieldSchema: true,
  computedFields: true,
  listColumns: true,
  studentAuthored: true,
  hasLifecycle: true,
  enabled: true,
  packKey: true,
} as const

/** All enabled journal definitions, ordered for the list. */
export async function listJournalDefinitions(
  viewer: JournalViewer | null,
): Promise<ViewableJournalDefinition[]> {
  const rows = await db.journalDefinition.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: DEFINITION_SELECT,
  })

  return rows
    .filter((row) => decideJournalVisibility(row, viewer).visible)
    .map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      singular: row.singular,
      description: row.description,
      icon: row.icon,
      fieldSchema: readFieldSchema(row.fieldSchema),
      computedFields: readComputed(row.computedFields),
      listColumns: row.listColumns,
      studentAuthored: row.studentAuthored,
      hasLifecycle: row.hasLifecycle,
    }))
}

/** Loads a single definition by key. Returns null when missing or invisible. */
export async function loadJournalDefinition(
  key: string,
  viewer: JournalViewer | null,
): Promise<ViewableJournalDefinition | null> {
  const row = await db.journalDefinition.findUnique({
    where: { key },
    select: DEFINITION_SELECT,
  })

  if (!row) return null
  if (!decideJournalVisibility(row, viewer).visible) return null

  return {
    id: row.id,
    key: row.key,
    name: row.name,
    singular: row.singular,
    description: row.description,
    icon: row.icon,
    fieldSchema: readFieldSchema(row.fieldSchema),
    computedFields: readComputed(row.computedFields),
    listColumns: row.listColumns,
    studentAuthored: row.studentAuthored,
    hasLifecycle: row.hasLifecycle,
  }
}

/** Like loadJournalDefinition but bypasses the visibility check — staff only. */
export async function loadJournalDefinitionForStaff(
  key: string,
): Promise<ViewableJournalDefinition | null> {
  const row = await db.journalDefinition.findUnique({
    where: { key },
    select: DEFINITION_SELECT,
  })
  if (!row) return null
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    singular: row.singular,
    description: row.description,
    icon: row.icon,
    fieldSchema: readFieldSchema(row.fieldSchema),
    computedFields: readComputed(row.computedFields),
    listColumns: row.listColumns,
    studentAuthored: row.studentAuthored,
    hasLifecycle: row.hasLifecycle,
  }
}

/** Public interface for DB rows (without computed fields; they are evaluated below). */
export interface ViewableJournalEntry {
  id: string
  status: JournalEntryStatus
  visibility: JournalVisibility
  data: Record<string, unknown>
  attachmentIds: string[]
  tags: string[]
  openedAt: Date
  closedAt: Date | null
  /** The computed fields evaluated for this entry against the definition. */
  computed: Record<string, ExprValue>
  authorId: string
  authorName: string
  batchId: string | null
  commentCount: number
  createdAt: Date
  updatedAt: Date
}

async function shapeEntry(
  row: JournalEntryRow,
  definition: ViewableJournalDefinition,
): Promise<ViewableJournalEntry> {
  // Computed fields are evaluated here, server-side, on read. Null-propagation
  // inside the evaluator handles partial entries; a throw is a malformed
  // expression, which the installer should have caught.
  const computed: Record<string, ExprValue> = {}
  for (const computedField of definition.computedFields) {
    try {
      computed[computedField.key] = evaluateExpression(computedField.expr, row.data)
    } catch {
      computed[computedField.key] = null
    }
  }

  return {
    id: row.id,
    status: row.status,
    visibility: row.visibility,
    data: row.data,
    attachmentIds: row.attachmentIds,
    tags: row.tags,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    computed,
    authorId: row.authorId,
    authorName: row.user.name,
    batchId: row.batchId,
    commentCount: row._count.comments,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

interface JournalEntryRow {
  id: string
  status: JournalEntryStatus
  visibility: JournalVisibility
  data: Record<string, unknown>
  attachmentIds: string[]
  tags: string[]
  openedAt: Date
  closedAt: Date | null
  authorId: string
  batchId: string | null
  user: { name: string }
  _count: { comments: number }
  createdAt: Date
  updatedAt: Date
}

const ENTRY_SELECT = {
  id: true,
  status: true,
  visibility: true,
  data: true,
  attachmentIds: true,
  tags: true,
  openedAt: true,
  closedAt: true,
  authorId: true,
  batchId: true,
  user: { select: { name: true } },
  _count: { select: { comments: true } },
  createdAt: true,
  updatedAt: true,
} as const

/**
 * Entries in a journal visible to this viewer. The query is a coarse prefilter
 * — every row it returns is still put through `decideEntryVisibility`, so there
 * is one implementation of visibility per rule. PRIVATE entries the author
 * alone can read are filtered out at the in-memory step.
 */
export async function listJournalEntries(
  definitionId: string,
  viewer: JournalViewer,
  definition: ViewableJournalDefinition,
): Promise<ViewableJournalEntry[]> {
  const rows = await db.journalEntry.findMany({
    where: { definitionId },
    orderBy: [{ openedAt: 'desc' }, { createdAt: 'desc' }],
    select: ENTRY_SELECT,
  })

  const visible = rows.filter((row) =>
    decideEntryVisibility(
      { authorId: row.authorId, visibility: row.visibility, batchId: row.batchId },
      viewer,
    ).visible,
  )

  return Promise.all(visible.map((row) => shapeEntry(row as JournalEntryRow, definition)))
}

/** Loads a single entry for a viewer; null when missing or not visible. */
export async function loadJournalEntry(
  entryId: string,
  viewer: JournalViewer,
  definition: ViewableJournalDefinition,
): Promise<ViewableJournalEntry | null> {
  const row = await db.journalEntry.findUnique({
    where: { id: entryId },
    select: ENTRY_SELECT,
  })

  if (!row) return null
  const decision = decideEntryVisibility(
    { authorId: row.authorId, visibility: row.visibility, batchId: row.batchId },
    viewer,
  )
  if (!decision.visible) return null
  return shapeEntry(row as JournalEntryRow, definition)
}

/** Loads a single entry for staff (the review console); bypasses visibility. */
export async function loadJournalEntryForStaff(
  entryId: string,
  definition: ViewableJournalDefinition,
): Promise<ViewableJournalEntry | null> {
  const row = await db.journalEntry.findUnique({
    where: { id: entryId },
    select: ENTRY_SELECT,
  })
  if (!row) return null
  return shapeEntry(row as JournalEntryRow, definition)
}

/**
 * All entries in a journal for the staff review console. The reviewer bypass in
 * access.ts lets a reviewer see every entry regardless of `visibility`, so the
 * query is unfiltered; the page renders status badges for triage.
 */
export async function listJournalEntriesForStaff(
  definitionId: string,
  _viewer: JournalViewer,
  definition: ViewableJournalDefinition,
): Promise<ViewableJournalEntry[]> {
  const rows = await db.journalEntry.findMany({
    where: { definitionId },
    orderBy: [{ openedAt: 'desc' }, { createdAt: 'desc' }],
    select: ENTRY_SELECT,
  })

  return Promise.all(
    rows.map((row) => shapeEntry(row as JournalEntryRow, definition)),
  )
}

// -----------------------------------------------------------------------------
// Comments
// -----------------------------------------------------------------------------

export interface ViewableJournalEntryComment {
  id: string
  body: string
  authorId: string
  authorName: string
  createdAt: Date
}

export async function listJournalEntryComments(
  entryId: string,
): Promise<ViewableJournalEntryComment[]> {
  const rows = await db.journalEntryComment.findMany({
    where: { entryId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      body: true,
      userId: true,
      user: { select: { name: true } },
      createdAt: true,
    },
  })

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    authorId: row.userId,
    authorName: row.user.name,
    createdAt: row.createdAt,
  }))
}

// Re-export the field type so the action/UI can build a per-type editor without
// importing the pack contract. See file header of validation.ts.
export type { JournalFieldSchema, JournalFieldType }
