/**
 * Pack installer.
 *
 * Writes the enabled packs' declarative contributions — journals, trackers, data
 * widgets, notification templates and rules — into the database, then runs each
 * pack's `onInstall` hook.
 *
 * Idempotent by `key` upserts, so it is safe to re-run after enabling a pack or
 * editing a pack definition. Re-running is in fact the intended way to roll a
 * pack change out to a deployment.
 *
 * Validation happens before any write: a bad computed-field expression or an
 * unresolvable adapter key aborts the whole run rather than leaving a pack
 * half-installed.
 */

import 'dotenv/config'

import { activePacks, brand, dataAdapters } from '../src/lib/brand'
import { orphanedPackLabels } from '../src/lib/labels'
import { validateExpression } from '../src/server/journals/expression'
import { db } from '../src/server/db'
import { ORG_SETTINGS_ID } from '../src/server/org/settings'
import type { PackInstallContext, VerticalPack } from '../src/packs/types'
import { slugify } from '../src/lib/utils'

/** Prisma's JSON input type is structurally awkward; this keeps call sites clean. */
type Json = Parameters<typeof db.journalDefinition.create>[0]['data']['fieldSchema']

function asJson(value: unknown): Json {
  return value as Json
}

// -----------------------------------------------------------------------------
// Validation — everything that can fail, before anything is written
// -----------------------------------------------------------------------------

function validatePacks(packs: readonly VerticalPack[]): string[] {
  const errors: string[] = []

  for (const pack of packs) {
    for (const journal of pack.journals ?? []) {
      const fieldKeys = journal.fields.map((field) => field.key)

      const duplicates = fieldKeys.filter((key, index) => fieldKeys.indexOf(key) !== index)
      if (duplicates.length > 0) {
        errors.push(
          `[${pack.key}] journal "${journal.key}" has duplicate field keys: ${[...new Set(duplicates)].join(', ')}`,
        )
      }

      for (const field of journal.fields) {
        if (
          (field.type === 'select' || field.type === 'multiselect') &&
          (!field.options || field.options.length === 0)
        ) {
          errors.push(
            `[${pack.key}] journal "${journal.key}" field "${field.key}" is ${field.type} but declares no options`,
          )
        }
      }

      /**
       * Computed expressions resolve against raw field values only — computed
       * results are not in scope for one another (see buildScope in
       * expression.ts). Validating against fieldKeys alone is therefore correct,
       * and catches a computed field that tries to chain off another.
       */
      for (const computed of journal.computed ?? []) {
        const result = validateExpression(computed.expr, fieldKeys)
        if (!result.ok) {
          errors.push(
            `[${pack.key}] journal "${journal.key}" computed "${computed.key}": ${result.error}`,
          )
        }
      }

      const computedKeys = new Set((journal.computed ?? []).map((c) => c.key))
      const known = new Set([...fieldKeys, ...computedKeys])
      for (const column of journal.listColumns ?? []) {
        if (!known.has(column)) {
          errors.push(
            `[${pack.key}] journal "${journal.key}" listColumns references unknown key "${column}"`,
          )
        }
      }
    }

    for (const widget of pack.dataWidgets ?? []) {
      if (!dataAdapters.has(widget.adapterKey)) {
        errors.push(
          `[${pack.key}] widget "${widget.key}" references adapter "${widget.adapterKey}", which no enabled pack provides`,
        )
      }
    }

    // Rules may reference a template from this pack or one already in the DB;
    // cross-pack references are resolved at write time, not here.
    const packTemplateKeys = new Set((pack.notificationTemplates ?? []).map((t) => t.key))
    for (const rule of pack.notificationRules ?? []) {
      if (!packTemplateKeys.has(rule.templateKey)) {
        errors.push(
          `[${pack.key}] rule "${rule.key}" references template "${rule.templateKey}", which this pack does not define`,
        )
      }
    }
  }

  return errors
}

// -----------------------------------------------------------------------------
// Writers
// -----------------------------------------------------------------------------

async function installJournals(pack: VerticalPack): Promise<number> {
  for (const journal of pack.journals ?? []) {
    const data = {
      name: journal.name,
      singular: journal.singular,
      description: journal.description ?? null,
      packKey: pack.key,
      icon: journal.icon ?? null,
      fieldSchema: asJson(journal.fields),
      computedFields: asJson(journal.computed ?? []),
      listColumns: journal.listColumns ?? [],
      studentAuthored: journal.studentAuthored ?? true,
      hasLifecycle: journal.hasLifecycle ?? false,
    }

    await db.journalDefinition.upsert({
      where: { key: journal.key },
      // `enabled` is admin-owned: if they switched a journal off, reinstalling
      // the pack must not silently switch it back on.
      update: data,
      create: { key: journal.key, ...data },
    })
  }
  return pack.journals?.length ?? 0
}

async function installTrackers(pack: VerticalPack): Promise<number> {
  for (const tracker of pack.trackers ?? []) {
    const data = {
      name: tracker.name,
      description: tracker.description ?? null,
      type: tracker.type,
      scope: tracker.scope ?? 'STUDENT',
      packKey: pack.key,
      unit: tracker.unit ?? null,
      config: asJson(tracker.config ?? {}),
      remindBeforeDays: tracker.remindBeforeDays ?? null,
    }

    await db.trackerDefinition.upsert({
      where: { key: tracker.key },
      update: data,
      create: { key: tracker.key, ...data },
    })
  }
  return pack.trackers?.length ?? 0
}

async function installDataWidgets(pack: VerticalPack): Promise<number> {
  for (const widget of pack.dataWidgets ?? []) {
    const data = {
      name: widget.name,
      description: widget.description ?? null,
      packKey: pack.key,
      adapterKey: widget.adapterKey,
      config: asJson(widget.config ?? {}),
      refreshIntervalSec: widget.refreshIntervalSec ?? 900,
      surfaces: widget.surfaces ?? [],
    }

    await db.dataWidgetDefinition.upsert({
      where: { key: widget.key },
      update: data,
      create: { key: widget.key, ...data },
    })
  }
  return pack.dataWidgets?.length ?? 0
}

async function installNotifications(pack: VerticalPack): Promise<number> {
  for (const template of pack.notificationTemplates ?? []) {
    const data = {
      name: template.name,
      subject: template.subject ?? null,
      body: template.body,
      channels: template.channels,
      variables: asJson(template.variables ?? []),
      packKey: pack.key,
    }

    await db.notificationTemplate.upsert({
      where: { key: template.key },
      update: data,
      create: { key: template.key, ...data },
    })
  }

  for (const rule of pack.notificationRules ?? []) {
    const template = await db.notificationTemplate.findUnique({
      where: { key: rule.templateKey },
      select: { id: true },
    })

    if (!template) {
      throw new Error(
        `[${pack.key}] rule "${rule.key}" references template "${rule.templateKey}", which is not in the database`,
      )
    }

    const data = {
      name: rule.name,
      trigger: rule.trigger,
      templateId: template.id,
      channels: rule.channels,
      offsetMinutes: rule.offsetMinutes ?? 0,
      packKey: pack.key,
    }

    await db.notificationRule.upsert({
      where: { key: rule.key },
      // `enabled` omitted deliberately — an admin who paused a rule keeps it
      // paused across reinstalls.
      update: data,
      create: { key: rule.key, ...data, enabled: rule.enabled ?? true },
    })
  }

  return (pack.notificationTemplates?.length ?? 0) + (pack.notificationRules?.length ?? 0)
}

/** Narrow context handed to `onInstall` so packs cannot reach arbitrary tables. */
function buildInstallContext(pack: VerticalPack): PackInstallContext {
  return {
    async seedChannel({ slug, name, description }) {
      const normalized = slugify(slug)
      await db.channel.upsert({
        where: { slug: normalized },
        update: { name, description: description ?? null },
        create: {
          slug: normalized,
          name,
          description: description ?? null,
          type: 'TOPIC',
        },
      })
    },

    async seedPage({ slug, title, blocks }) {
      const normalized = slugify(slug)
      await db.page.upsert({
        where: { slug: normalized },
        // Never overwrite published page content that an admin may have edited.
        update: {},
        create: { slug: normalized, title, blocks: asJson(blocks), status: 'DRAFT' },
      })
    },

    log(message: string) {
      console.log(`  ${pack.key}: ${message}`)
    },
  }
}

// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Installing packs for brand "${brand.key}"…`)

  if (activePacks.length === 0) {
    console.log('No packs enabled — this deployment runs the neutral core.')
    await db.orgSettings.update({
      where: { id: ORG_SETTINGS_ID },
      data: { enabledPacks: [] },
    })
    return
  }

  const errors = validatePacks(activePacks)
  if (errors.length > 0) {
    console.error('Pack validation failed — nothing was written:')
    for (const error of errors) console.error(`  ✗ ${error}`)
    throw new Error(`${errors.length} pack validation error(s)`)
  }

  for (const pack of activePacks) {
    console.log(`\n▸ ${pack.name} v${pack.version}`)
    const journals = await installJournals(pack)
    const trackers = await installTrackers(pack)
    const widgets = await installDataWidgets(pack)
    const notifications = await installNotifications(pack)

    console.log(
      `  ${journals} journal(s), ${trackers} tracker(s), ${widgets} widget(s), ${notifications} notification object(s)`,
    )

    if (pack.onInstall) {
      await pack.onInstall(buildInstallContext(pack))
    }
  }

  await db.orgSettings.update({
    where: { id: ORG_SETTINGS_ID },
    data: { enabledPacks: activePacks.map((pack) => pack.key) },
  })

  const orphaned = orphanedPackLabels()
  if (orphaned.length > 0) {
    console.warn(
      `\n⚠ ${orphaned.length} pack label override(s) no longer match a core label key and have no effect:`,
    )
    for (const key of orphaned) console.warn(`    ${key}`)
    console.warn('  Usually left behind by a core label rename — remove them from the pack.')
  }

  /**
   * Adapters whose credentials are absent. Not an error: the client owns these
   * subscriptions per section 3 of the proposal, and widgets degrade to a setup
   * notice rather than failing.
   */
  const unconfigured = [...dataAdapters.values()].filter((adapter) =>
    (adapter.requiredEnv ?? []).some((name) => !process.env[name]),
  )
  if (unconfigured.length > 0) {
    console.log('\nℹ Data feeds awaiting client credentials:')
    for (const adapter of unconfigured) {
      const missing = (adapter.requiredEnv ?? []).filter((name) => !process.env[name])
      console.log(`    ${adapter.key} — needs ${missing.join(', ')}`)
    }
    console.log('  Their widgets will render a setup notice until these are set.')
  }

  console.log('\n✓ Packs installed')
}

main()
  .catch((error: unknown) => {
    console.error('\nPack install failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    void db.$disconnect()
  })
