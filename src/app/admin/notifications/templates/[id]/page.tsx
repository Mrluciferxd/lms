import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requirePermission } from '@/server/auth/rbac'
import { availableChannels } from '@/server/notifications/channels'
import { buildOrgContext, sampleContext } from '@/server/notifications/context'
import { db } from '@/server/db'
import { isScheduledTrigger, type ScheduledTrigger } from '@/server/notifications/schedule'
import { VARIABLE_DESCRIPTIONS, buildVariables } from '@/server/notifications/variables'
import { updateTemplate } from '@/server/notifications/actions'
import { TemplateEditor } from './template-editor'

export const metadata: Metadata = { title: 'Edit template' }

/**
 * Fixed preview instant.
 *
 * The preview is about wording, not about today's date, and a real clock would
 * make the server render and the first client render disagree — which surfaces
 * as a hydration warning that reads like the template is broken.
 */
const PREVIEW_AT = new Date('2026-07-26T09:00:00Z')

/** Fallback when no rule uses the template yet and there is no trigger to sample. */
const DEFAULT_PREVIEW_TRIGGER: ScheduledTrigger = 'CLASS_REMINDER'

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requirePermission('notification:manage', `/admin/notifications/templates/${id}`)

  const template = await db.notificationTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      key: true,
      name: true,
      subject: true,
      body: true,
      channels: true,
      packKey: true,
      rules: { select: { id: true, name: true, trigger: true, enabled: true } },
    },
  })

  if (!template) notFound()

  /**
   * Which trigger to preview against. A template is only ever rendered for the
   * triggers whose rules point at it, so previewing against anything else would
   * show variables that can never be populated in practice.
   */
  const previewTrigger =
    template.rules.map((rule) => rule.trigger).find(isScheduledTrigger) ??
    DEFAULT_PREVIEW_TRIGGER

  const org = await buildOrgContext()
  const sampleVariables = buildVariables(
    sampleContext(previewTrigger, org, PREVIEW_AT),
    PREVIEW_AT,
  )

  const catalog = Object.keys(sampleVariables)
    .sort()
    .map((key) => ({
      key,
      description: VARIABLE_DESCRIPTIONS[key] ?? null,
      example: sampleVariables[key] ?? '',
    }))

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/admin/notifications" className="text-content-muted hover:text-content">
          ← Notifications
        </Link>
      </nav>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-content">{template.name}</h1>
          <p className="mt-0.5 font-mono text-xs text-content-muted">{template.key}</p>
        </div>
        {template.packKey && (
          <p className="max-w-sm text-xs text-warning">
            Owned by the <strong>{template.packKey}</strong> pack. Re-running{' '}
            <code className="font-mono">npm run packs:install</code> overwrites this wording — copy
            it somewhere before a pack upgrade.
          </p>
        )}
      </div>

      {template.rules.length > 0 && (
        <p className="text-sm text-content-muted">
          Used by {template.rules.map((rule) => rule.name).join(', ')}. Previewing against{' '}
          <span className="font-mono">{previewTrigger}</span>.
        </p>
      )}

      <TemplateEditor
        action={(formData) => updateTemplate(template.id, formData)}
        initial={{
          name: template.name,
          subject: template.subject,
          body: template.body,
          channels: template.channels,
        }}
        availableChannels={availableChannels()}
        sampleVariables={sampleVariables}
        catalog={catalog}
      />
    </div>
  )
}
