/**
 * Journal server actions — the only path to mutate journal entries and
 * comments. Every action re-checks auth + definition visibility + write
 * permission, because a server action is a directly invocable endpoint, not a
 * navigation. Hiding a form is not authorization. The convention matches
 * ../chat/actions.ts and ../assignments/actions.ts.
 *
 * ── ENTRY LIFECYCLE ──────────────────────────────────────────────────────
 *   OPEN  ──close──>  CLOSED           (close is only valid if the definition
 *   CLOSED ──reopen──> OPEN              declared `hasLifecycle: true`)
 *                                        - THE CLOSE transition is identity
 *                                          on a definition without lifecycle;
 *                                          not forbidden by data but inert.
 *
 * CLOSED is not a hard delete — entries remain visible under the visibility
 * rule and surface in the list with a CLOSED badge. Mentors see the row in
 * the review console forever, so a "win/loss" journal entry becomes a record.
 * ──────────────────────────────────────────────────────────────────────────
 */

'use server'

import { db } from '@/server/db'
import { getCurrentUser } from '@/server/auth/rbac'
import { roleHasPermission } from '@/server/auth/roles'
import {
  decideCanAuthor,
  decideCanComment,
  decideEntryVisibility,
  decideJournalVisibility,
  loadJournalViewer,
  type JournalViewer,
} from './access'
import {
  isJournalEntryValid,
  validateAttachmentIds,
  validateComment,
  validateJournalEntry,
  validateTags,
} from './validation'
import { loadJournalDefinition, loadJournalEntry } from './journals'
import type { JournalVisibility } from '@/generated/prisma/enums'

export type ActionResult<T = void> =
  | ({ ok: true; data?: T })
  | { ok: false; reason: string }

const NOT_AUTH = { ok: false, reason: 'You must be signed in.' } as const
const NOT_FOUND = { ok: false, reason: 'Journal not found.' } as const
const NOT_ALLOWED = { ok: false, reason: 'You cannot do that here.' } as const

async function loadDefinition(definitionId: string) {
  return db.journalDefinition.findUnique({
    where: { id: definitionId },
    select: {
      id: true,
      enabled: true,
      studentAuthored: true,
      hasLifecycle: true,
    },
  })
}

async function loadDefinitionByKey(key: string) {
  return db.journalDefinition.findUnique({
    where: { key },
    select: {
      id: true,
      key: true,
      enabled: true,
      studentAuthored: true,
      hasLifecycle: true,
    },
  })
}

async function loadViewer(): Promise<JournalViewer | null> {
  const user = await getCurrentUser()
  if (!user) return null
  return loadJournalViewer(user.id)
}

/** Prisma's JSON input type is structurally awkward; this keeps call sites clean. */
type Json = Parameters<typeof db.journalEntry.create>[0]['data']['data']

function asJson(value: Record<string, unknown>): Json {
  return value as Json
}

// ─── ENTRY CREATE ─────────────────────────────────────────────────────────────

export interface CreatedEntry {
  id: string
}

/**
 * Creates a journal entry. The author must satisfy `decideCanAuthor` for the
 * definition — a student-authored journal accepts any viewer, an instructor-
 * only journal needs `journal:define`. `subjectUserId` lets an instructor log
 * on a student's behalf; the author is the instructor and the student is named
 * so in the entry.
 */
export async function createJournalEntry(input: {
  journalKey: string
  data: Record<string, unknown>
  attachmentIds?: string[]
  tags?: string[]
  visibility?: JournalVisibility
  batchId?: string | null
  subjectUserId?: string | null
}): Promise<ActionResult<CreatedEntry>> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const viewer = await loadViewer()
  if (!viewer) return NOT_AUTH

  const definition = await loadDefinitionByKey(input.journalKey)
  if (!definition) return NOT_FOUND

  if (!decideJournalVisibility(definition, viewer).visible) return NOT_FOUND
  if (!decideCanAuthor(definition, viewer)) {
    return { ok: false, reason: 'You cannot author entries in this journal.' }
  }

  // The field schema lives as JSON in the definition; the installer wrote it as
  // the pack contract. Coercion at the read site is okay — a malformed admin
  // edit at runtime is the only way this is not a `PackJournalField[]`.
  const fieldSchema = await db.journalDefinition
    .findUnique({ where: { id: definition.id }, select: { fieldSchema: true } })
    .then((row) => (row ? (Array.isArray(row.fieldSchema) ? row.fieldSchema : []) : []))

  const issues = validateJournalEntry({ fields: fieldSchema, data: input.data })
  if (issues.length > 0) return { ok: false, reason: issues[0]!.message }

  if (input.tags) {
    const tagsIssue = validateTags(input.tags)
    if (tagsIssue) return { ok: false, reason: tagsIssue }
  }

  if (input.attachmentIds) {
    const attachmentIssue = validateAttachmentIds(input.attachmentIds)
    if (attachmentIssue) return { ok: false, reason: attachmentIssue }
  }

  // visibility defaults to PRIVATE — the conservative posture; an entry is
  // invisible to everyone except the author and reviewers unless the student
  // deliberately shares it.
  const visibility: JournalVisibility = input.visibility ?? 'PRIVATE'

  const now = new Date()
  const created = await db.journalEntry.create({
    data: {
      definitionId: definition.id,
      authorId: user.id,
      subjectUserId: input.subjectUserId ?? null,
      courseId: null,
      batchId: input.batchId ?? null,
      data: asJson(input.data),
      status: 'OPEN',
      visibility,
      attachmentIds: input.attachmentIds ?? [],
      tags: input.tags ?? [],
      openedAt: now,
    },
    select: { id: true },
  })

  return { ok: true, data: { id: created.id } }
}

// ─── ENTRY UPDATE ────────────────────────────────────────────────────────────

/**
 * Updates a journal entry. The author or a staff reviewer (`journal:review`)
 * may update — editors catch typos in a student's record during a review the
 * same way the author catches their own on a re-read.
 */
export async function updateJournalEntry(input: {
  entryId: string
  data?: Record<string, unknown>
  attachmentIds?: string[]
  tags?: string[]
  visibility?: JournalVisibility
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const viewer = await loadViewer()
  if (!viewer) return NOT_AUTH

  const row = await db.journalEntry.findUnique({
    where: { id: input.entryId },
    select: {
      id: true,
      definitionId: true,
      authorId: true,
      visibility: true,
      status: true,
      batchId: true,
    },
  })
  if (!row) return NOT_FOUND

  // The author can always edit their own. A reviewer can edit (the review
  // flow). Anyone else is refused.
  const isAuthor = row.authorId === user.id
  if (!isAuthor && !viewer.canReview) return NOT_ALLOWED

  // Validation: every key in `data` must still be present in the schema. The
  // definition may have dropped a field since the entry was written; we refuse
  // rather than storing a hidden value, matching validateJournalEntry.
  if (input.data) {
    const definitionSchema = await db.journalDefinition
      .findUnique({ where: { id: row.definitionId }, select: { fieldSchema: true } })
      .then((r) => (r ? (Array.isArray(r.fieldSchema) ? r.fieldSchema : []) : []))

    const issues = validateJournalEntry({ fields: definitionSchema, data: input.data })
    if (issues.length > 0) return { ok: false, reason: issues[0]!.message }
  }

  if (input.tags) {
    const tagsIssue = validateTags(input.tags)
    if (tagsIssue) return { ok: false, reason: tagsIssue }
  }

  if (input.attachmentIds) {
    const attachmentIssue = validateAttachmentIds(input.attachmentIds)
    if (attachmentIssue) return { ok: false, reason: attachmentIssue }
  }

  const data: Record<string, unknown> = {}
  if (input.data) data.data = asJson(input.data)
  if (input.tags) data.tags = input.tags
  if (input.attachmentIds) data.attachmentIds = input.attachmentIds
  if (input.visibility) data.visibility = input.visibility

  await db.journalEntry.update({ where: { id: row.id }, data })
  return { ok: true }
}

// ─── ENTRY LIFECYCLE ─────────────────────────────────────────────────────────

/**
 * Closes a lifecycle entry (a position is no longer open). The author or a
 * staff reviewer may close. Closing a non-lifecycle entry is a no-op rather
 * than an error — the call is inert, the row stays OPEN, and the caller knows
 * without a separate fetch whether to show the transition at all.
 */
export async function closeJournalEntry(input: {
  entryId: string
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const viewer = await loadViewer()
  if (!viewer) return NOT_AUTH

  const row = await db.journalEntry.findUnique({
    where: { id: input.entryId },
    select: { id: true, authorId: true, status: true, definitionId: true },
  })
  if (!row) return NOT_FOUND

  const isAuthor = row.authorId === user.id
  if (!isAuthor && !viewer.canReview) return NOT_ALLOWED

  if (row.status === 'CLOSED') return { ok: true }

  await db.journalEntry.update({
    where: { id: row.id },
    data: { status: 'CLOSED', closedAt: new Date() },
  })
  return { ok: true }
}

/**
 * Reopens a closed lifecycle entry (e.g. a position that re-opened). Mirror of
 * `closeJournalEntry`: author + reviewer only.
 */
export async function reopenJournalEntry(input: {
  entryId: string
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const viewer = await loadViewer()
  if (!viewer) return NOT_AUTH

  const row = await db.journalEntry.findUnique({
    where: { id: input.entryId },
    select: { id: true, authorId: true, status: true },
  })
  if (!row) return NOT_FOUND

  const isAuthor = row.authorId === user.id
  if (!isAuthor && !viewer.canReview) return NOT_ALLOWED

  if (row.status === 'OPEN') return { ok: true }

  await db.journalEntry.update({
    where: { id: row.id },
    data: { status: 'OPEN', closedAt: null },
  })
  return { ok: true }
}

// ─── ENTRY DELETE ────────────────────────────────────────────────────────────

/**
 * Deletes a journal entry. The author can delete their own; a reviewer can
 * delete anything (an entry that violates policy). Deleting throws away the
 * review history, so the default is *close*, not delete.
 */
export async function deleteJournalEntry(input: {
  entryId: string
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const viewer = await loadViewer()
  if (!viewer) return NOT_AUTH

  const row = await db.journalEntry.findUnique({
    where: { id: input.entryId },
    select: { id: true, authorId: true },
  })
  if (!row) return NOT_FOUND

  const isAuthor = row.authorId === user.id
  if (!isAuthor && !viewer.canReview) return NOT_ALLOWED

  await db.journalEntry.delete({ where: { id: row.id } })
  return { ok: true }
}

// ─── COMMENT ─────────────────────────────────────────────────────────────────

export interface CreatedComment {
  id: string
}

export async function addJournalEntryComment(input: {
  entryId: string
  body: string
}): Promise<ActionResult<CreatedComment>> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH

  const viewer = await loadViewer()
  if (!viewer) return NOT_AUTH

  const issue = validateComment(input.body)
  if (issue) return { ok: false, reason: issue }

  const row = await db.journalEntry.findUnique({
    where: { id: input.entryId },
    select: { id: true, authorId: true, visibility: true, batchId: true },
  })
  if (!row) return NOT_FOUND

  const commentDecision = decideCanComment(
    { authorId: row.authorId, visibility: row.visibility, batchId: row.batchId },
    viewer,
  )
  if (!commentDecision.ok) {
    return { ok: false, reason: 'You cannot comment on this entry.' }
  }

  const created = await db.journalEntryComment.create({
    data: {
      entryId: row.id,
      userId: user.id,
      body: input.body.trim(),
    },
    select: { id: true },
  })

  return { ok: true, data: { id: created.id } }
}

// ─── DEFINITION ADMIN ────────────────────────────────────────────────────────

/**
 * Toggles a journal definition `enabled` state. `journal:define` only — staff
 * can switch a journal off without uninstalling the pack, which is how a pulled
 * pack contribution survives a reinstall without re-enabling against an admin's
 * deliberate off switch (see vertical-packs.md "enabled flags are admin-owned").
 */
export async function setJournalDefinitionEnabled(input: {
  journalKey: string
  enabled: boolean
}): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return NOT_AUTH
  if (!roleHasPermission(user.role, 'journal:define')) return NOT_ALLOWED

  const existing = await db.journalDefinition.findUnique({
    where: { key: input.journalKey },
    select: { id: true },
  })
  if (!existing) return NOT_FOUND

  await db.journalDefinition.update({
    where: { id: existing.id },
    data: { enabled: input.enabled },
  })
  return { ok: true }
}
