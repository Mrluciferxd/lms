'use server'

/**
 * Notification mutations.
 *
 * Every action re-checks its permission server-side. Server actions are directly
 * invocable endpoints, so a disabled toggle in the admin UI authorizes nothing —
 * see ../catalog/actions.ts, which this follows deliberately.
 *
 * The student actions are scoped by the caller's own id inside the query rather
 * than trusting an id from the form, so a forged notification id marks nothing.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { recordAudit } from '@/server/audit'
import { authorizeRequest, getCurrentUser } from '@/server/auth/rbac'
import { db } from '@/server/db'
import { markAllRead, markRead } from './inbox'
import { referencedVariables } from './render'

export interface ActionResult {
  ok: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

function fail(error: string, fieldErrors?: Record<string, string>): ActionResult {
  return { ok: false, error, fieldErrors }
}

function firstIssues(error: z.ZodError): Record<string, string> {
  const flattened = error.flatten().fieldErrors
  return Object.fromEntries(
    Object.entries(flattened)
      .filter(([, messages]) => messages && messages.length > 0)
      .map(([field, messages]) => [field, messages![0]!]),
  )
}

// -----------------------------------------------------------------------------
// Templates
// -----------------------------------------------------------------------------

const templateSchema = z.object({
  name: z.string().trim().min(3, 'Name must be at least 3 characters').max(200),
  subject: z.string().trim().max(300).optional(),
  body: z.string().trim().min(1, 'A template needs a body').max(20_000),
  channels: z
    .array(z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP']))
    .min(1, 'Pick at least one channel'),
})

export async function updateTemplate(
  templateId: string,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await authorizeRequest('notification:manage')
  if (!auth.ok) return fail('You do not have permission to edit notification templates.')

  const parsed = templateSchema.safeParse({
    name: formData.get('name'),
    subject: formData.get('subject') || undefined,
    body: formData.get('body'),
    channels: formData.getAll('channels').map(String),
  })

  if (!parsed.success) return fail('Please correct the highlighted fields.', firstIssues(parsed.error))

  const existing = await db.notificationTemplate.findUnique({
    where: { id: templateId },
    select: { key: true, packKey: true },
  })
  if (!existing) return fail('Template not found.')

  await db.notificationTemplate.update({
    where: { id: templateId },
    data: {
      name: parsed.data.name,
      subject: parsed.data.subject ?? null,
      body: parsed.data.body,
      channels: parsed.data.channels,
    },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: 'notification_template.updated',
    entityType: 'NotificationTemplate',
    entityId: templateId,
    meta: {
      key: existing.key,
      // Kept because a pack reinstall overwrites pack-owned templates: when an
      // admin's wording disappears, this is the record that it existed.
      packKey: existing.packKey,
      variables: referencedVariables({ subject: parsed.data.subject, body: parsed.data.body }),
    },
  })

  revalidatePath('/admin/notifications')
  revalidatePath(`/admin/notifications/templates/${templateId}`)
  return { ok: true }
}

// -----------------------------------------------------------------------------
// Rules
// -----------------------------------------------------------------------------

export async function setRuleEnabled(ruleId: string, enabled: boolean): Promise<ActionResult> {
  const auth = await authorizeRequest('notification:manage')
  if (!auth.ok) return fail('You do not have permission to change notification rules.')

  const rule = await db.notificationRule.findUnique({
    where: { id: ruleId },
    select: { key: true, name: true, trigger: true },
  })
  if (!rule) return fail('Rule not found.')

  await db.notificationRule.update({ where: { id: ruleId }, data: { enabled } })

  await recordAudit({
    actorId: auth.user.id,
    action: enabled ? 'notification_rule.enabled' : 'notification_rule.disabled',
    entityType: 'NotificationRule',
    entityId: ruleId,
    // Switching off a fee reminder is the kind of change somebody later needs to
    // be able to attribute.
    meta: { key: rule.key, trigger: rule.trigger },
  })

  revalidatePath('/admin/notifications')
  return { ok: true }
}

const offsetSchema = z.coerce
  .number()
  .int()
  .min(-43_200, 'Offsets beyond 30 days are almost always a typo')
  .max(43_200)

export async function setRuleOffset(ruleId: string, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeRequest('notification:manage')
  if (!auth.ok) return fail('You do not have permission to change notification rules.')

  const parsed = offsetSchema.safeParse(formData.get('offsetMinutes'))
  if (!parsed.success) {
    return fail('Enter the offset in minutes.', { offsetMinutes: parsed.error.issues[0]!.message })
  }

  const rule = await db.notificationRule.findUnique({
    where: { id: ruleId },
    select: { key: true, offsetMinutes: true },
  })
  if (!rule) return fail('Rule not found.')

  await db.notificationRule.update({
    where: { id: ruleId },
    data: { offsetMinutes: parsed.data },
  })

  await recordAudit({
    actorId: auth.user.id,
    action: 'notification_rule.retimed',
    entityType: 'NotificationRule',
    entityId: ruleId,
    meta: { key: rule.key, from: rule.offsetMinutes, to: parsed.data },
  })

  revalidatePath('/admin/notifications')
  return { ok: true }
}

// -----------------------------------------------------------------------------
// Student inbox
// -----------------------------------------------------------------------------

export async function markNotificationRead(notificationId: string): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return fail('Sign in to continue.')

  await markRead(user.id, notificationId)
  revalidatePath('/app/notifications')
  return { ok: true }
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return fail('Sign in to continue.')

  await markAllRead(user.id)
  revalidatePath('/app/notifications')
  return { ok: true }
}
