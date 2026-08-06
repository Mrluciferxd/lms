/**
 * Tracker server actions — the only path to mutate a tracker record. Every
 * action re-checks `decideCanUpdateRecord` against the live user row before the
 * upsert, because a server action is a directly invocable endpoint and the
 * client passing ids is a hint, not authority. The convention matches
 * ../journals/actions.ts and ../assignments/actions.ts.
 *
 * One action covers every type: the input is tagged by `TrackerType` and
 * `normalizeTrackerUpdate` is the single source of truth for what gets stored.
 */

'use server'

import { db } from '@/server/db'
import { getCurrentUser } from '@/server/auth/rbac'
import {
  decideCanUpdateRecord,
  loadTrackerViewer,
  type TrackerViewer,
} from './access'
import {
  normalizeTrackerUpdate,
  parseTrackerConfig,
  type TrackerUpdate,
} from './validation'
import type { TrackerScope, TrackerType } from '@/generated/prisma/enums'

export type ActionResult =
  | { ok: true; data?: { recordId: string } }
  | { ok: false; reason: string }

const NOT_AUTH = { ok: false, reason: 'You must be signed in.' } as const
const NOT_FOUND = { ok: false, reason: 'Tracker not found.' } as const
const NOT_ALLOWED = { ok: false, reason: 'You cannot update this tracker.' } as const

type Json = Parameters<typeof db.trackerRecord.create>[0]['data']['value']

function asJson(value: Record<string, unknown>): Json {
  return value as Json
}

async function loadViewer(): Promise<TrackerViewer | null> {
  const user = await getCurrentUser()
  if (!user) return null
  return loadTrackerViewer(user.id)
}

interface ResolvedSubject {
  scope: TrackerScope
  type: TrackerType
  userId: string | null
  batchId: string | null
}

function resolveSubject(
  scope: TrackerScope,
  type: TrackerType,
  viewer: TrackerViewer,
  input: { subjectUserId?: string | null; subjectBatchId?: string | null },
): ResolvedSubject | null {
  switch (scope) {
    case 'STUDENT':
      // An admin may target any student; otherwise the viewer's own row.
      return { scope, type, userId: input.subjectUserId ?? viewer.id, batchId: null }
    case 'BATCH':
      if (!input.subjectBatchId) return null
      return { scope, type, userId: null, batchId: input.subjectBatchId }
    case 'GLOBAL':
      return { scope, type, userId: null, batchId: null }
  }
}

/**
 * Updates (or creates) a tracker record. The action is scope-aware:
 * STUDENT defaults to the viewer; BATCH requires `subjectBatchId`; GLOBAL has
 * no subject. `tracker:manage` is the only path for BATCH, GLOBAL and any
 * EXPIRY — a non-manager self-editing a STUDENT counter/checklist/gauge/
 * boolean is the student "self-log progress" surface.
 */
export async function updateTracker(input: {
  definitionKey: string
  subjectUserId?: string | null
  subjectBatchId?: string | null
  update: TrackerUpdate
}): Promise<ActionResult> {
  const viewer = await loadViewer()
  if (!viewer) return NOT_AUTH

  const definition = await db.trackerDefinition.findUnique({
    where: { key: input.definitionKey },
    select: {
      id: true,
      key: true,
      type: true,
      scope: true,
      enabled: true,
      config: true,
    },
  })

  if (!definition || !definition.enabled) return NOT_FOUND

  const subject = resolveSubject(definition.scope, definition.type, viewer, input)
  if (!subject) {
    return { ok: false, reason: 'A batch is required for a BATCH-scope tracker.' }
  }

  const decision = decideCanUpdateRecord(subject, viewer)
  if (!decision.ok) return NOT_ALLOWED

  const config = parseTrackerConfig(definition.config)
  const normalized = normalizeTrackerUpdate(definition.type, config, input.update)
  if (!normalized.ok) return { ok: false, reason: normalized.error }

  // The unique specifier is a composite across nullable fields, so there is no
  // `where: { definitionId_userId_batchId: ... }` shortcut — findFirst is the
  // single-record authority, then update-or-create.
  const existing = await db.trackerRecord.findFirst({
    where: {
      definitionId: definition.id,
      userId: subject.userId,
      batchId: subject.batchId,
    },
    select: { id: true },
  })

  if (existing) {
    await db.trackerRecord.update({
      where: { id: existing.id },
      data: {
        value: asJson(normalized.value),
        expiresAt: normalized.expiresAt,
        updatedById: viewer.id,
      },
    })
    return { ok: true, data: { recordId: existing.id } }
  }

  const created = await db.trackerRecord.create({
    data: {
      definitionId: definition.id,
      userId: subject.userId,
      batchId: subject.batchId,
      value: asJson(normalized.value),
      expiresAt: normalized.expiresAt,
      updatedById: viewer.id,
    },
    select: { id: true },
  })

  return { ok: true, data: { recordId: created.id } }
}
