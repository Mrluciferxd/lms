import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CORE_LABELS } from '@/lib/labels'
import { validateExpression } from '@/server/journals/expression'
import { coachingPack } from './coaching'
import { forexPack } from './forex'
import {
  collectDataAdapters,
  collectNavItems,
  getPack,
  listAvailablePacks,
  mergePackLabels,
  resolvePacks,
} from './registry'
import type { VerticalPack } from './types'

describe('resolvePacks', () => {
  it('resolves an empty list, which is a valid deployment', () => {
    assert.deepEqual(resolvePacks([]), [])
  })

  it('resolves known keys in the order given', () => {
    assert.deepEqual(
      resolvePacks(['forex']).map((pack) => pack.key),
      ['forex'],
    )
  })

  /**
   * A typo in brand.config.ts must not silently drop features — a client would
   * be left wondering where their trade journal went.
   */
  it('throws on an unknown key rather than degrading quietly', () => {
    assert.throws(() => resolvePacks(['fx']), /Unknown vertical pack/)
    assert.throws(() => resolvePacks(['forex', 'nope']), /nope/)
  })

  it('lists available packs and looks them up by key', () => {
    assert.ok(listAvailablePacks().length >= 1)
    assert.equal(getPack('forex')?.key, 'forex')
    assert.equal(getPack('absent'), undefined)
  })
})

describe('mergePackLabels', () => {
  it('is empty with no packs, so core defaults apply', () => {
    assert.deepEqual(mergePackLabels([]), {})
  })

  it('lets a later pack win a collision', () => {
    const a = { key: 'a', name: 'A', version: '1', labels: { 'nav.courses': 'From A' } }
    const b = { key: 'b', name: 'B', version: '1', labels: { 'nav.courses': 'From B' } }
    assert.equal(mergePackLabels([a, b])['nav.courses'], 'From B')
  })

  it('picks up the forex relabelling of generic broadcasts', () => {
    const labels = mergePackLabels([forexPack])
    assert.equal(labels['liveSession.kind.BROADCAST'], 'Live Market Session')
  })
})

describe('collectNavItems', () => {
  it('sorts by order, defaulting unspecified items to the end', () => {
    const packs: VerticalPack[] = [
      {
        key: 'p',
        name: 'P',
        version: '1',
        navItems: [
          { key: 'c', label: 'C', href: '/c', order: 50 },
          { key: 'a', label: 'A', href: '/a', order: 10 },
          { key: 'z', label: 'Z', href: '/z' },
          { key: 'b', label: 'B', href: '/b', order: 20 },
        ],
      },
    ]
    assert.deepEqual(
      collectNavItems(packs).map((item) => item.key),
      ['a', 'b', 'c', 'z'],
    )
  })

  it('returns nothing for a packless deployment', () => {
    assert.deepEqual(collectNavItems([]), [])
  })
})

describe('collectDataAdapters', () => {
  it('indexes adapters by key', () => {
    const adapters = collectDataAdapters([forexPack])
    assert.ok(adapters.has('forex.economic-calendar'))
  })

  /**
   * Two packs claiming one adapter key is a packaging mistake, and silently
   * picking one would make widget behaviour depend on pack order.
   */
  it('throws when two enabled packs claim the same adapter key', () => {
    const makePack = (key: string): VerticalPack => ({
      key,
      name: key,
      version: '1',
      dataAdapters: [
        {
          key: 'shared.feed',
          name: 'Shared',
          fetch: async () => ({ payload: null }),
        } as never,
      ],
    })

    assert.throws(
      () => collectDataAdapters([makePack('one'), makePack('two')]),
      /Duplicate data adapter key/,
    )
  })
})

/**
 * Applied to every registered pack rather than to forex specifically, so a future
 * vertical inherits these guarantees without anyone remembering to add tests.
 * This is the same validation the installer runs before writing anything —
 * running it here means a broken pack fails in CI rather than at deploy.
 */
describe('every registered pack', () => {
  const packs = listAvailablePacks()

  it('registers at least two unrelated verticals', () => {
    // If this ever drops to one, the "industry-agnostic core" claim is untested.
    assert.ok(packs.length >= 2, 'expected multiple verticals to keep core honest')
  })

  it('has unique pack keys', () => {
    const keys = packs.map((pack) => pack.key)
    assert.equal(new Set(keys).size, keys.length, `duplicate pack keys in ${keys.join(', ')}`)
  })

  for (const pack of packs) {
    describe(pack.key, () => {
      it('declares every widget adapter it references', () => {
        const adapters = collectDataAdapters([pack])
        for (const widget of pack.dataWidgets ?? []) {
          assert.ok(
            adapters.has(widget.adapterKey),
            `widget ${widget.key} references missing adapter ${widget.adapterKey}`,
          )
        }
      })

      it('declares every template its rules reference', () => {
        const templates = new Set((pack.notificationTemplates ?? []).map((t) => t.key))
        for (const rule of pack.notificationRules ?? []) {
          assert.ok(
            templates.has(rule.templateKey),
            `rule ${rule.key} references missing template ${rule.templateKey}`,
          )
        }
      })

      it('declares requiredEnv on data adapters so setup gaps are reportable', () => {
        for (const adapter of pack.dataAdapters ?? []) {
          assert.ok(
            (adapter.requiredEnv?.length ?? 0) > 0,
            `adapter ${adapter.key} should declare requiredEnv`,
          )
        }
      })

      it('has valid journal field schemas', () => {
        for (const journal of pack.journals ?? []) {
          const keys = journal.fields.map((field) => field.key)
          assert.equal(
            new Set(keys).size,
            keys.length,
            `journal ${journal.key} has duplicate field keys`,
          )

          for (const field of journal.fields) {
            if (field.type === 'select' || field.type === 'multiselect') {
              assert.ok(
                (field.options?.length ?? 0) > 0,
                `journal ${journal.key} field ${field.key} is ${field.type} with no options`,
              )
            }
          }
        }
      })

      it('has computed expressions that parse and reference only real fields', () => {
        for (const journal of pack.journals ?? []) {
          const fieldKeys = journal.fields.map((field) => field.key)
          for (const computed of journal.computed ?? []) {
            const result = validateExpression(computed.expr, fieldKeys)
            assert.equal(
              result.ok,
              true,
              `journal ${journal.key} computed ${computed.key}: ${result.error}`,
            )
          }
        }
      })

      it('lists only columns that exist', () => {
        for (const journal of pack.journals ?? []) {
          const known = new Set([
            ...journal.fields.map((field) => field.key),
            ...(journal.computed ?? []).map((computed) => computed.key),
          ])
          for (const column of journal.listColumns ?? []) {
            assert.ok(known.has(column), `journal ${journal.key} lists unknown column ${column}`)
          }
        }
      })

      /**
       * A label override whose key does not exist in core silently does nothing —
       * exactly the kind of dead config that survives a core rename unnoticed.
       */
      it('overrides only label keys that core defines', () => {
        for (const key of Object.keys(pack.labels ?? {})) {
          assert.ok(key in CORE_LABELS, `label override "${key}" matches no core label`)
        }
      })
    })
  }
})

describe('packs are mutually independent', () => {
  const packs = listAvailablePacks()

  it('can all be enabled together without key collisions', () => {
    const all = resolvePacks(packs.map((pack) => pack.key))

    const journalKeys = all.flatMap((pack) => (pack.journals ?? []).map((j) => j.key))
    assert.equal(new Set(journalKeys).size, journalKeys.length, 'journal key collision')

    const trackerKeys = all.flatMap((pack) => (pack.trackers ?? []).map((t) => t.key))
    assert.equal(new Set(trackerKeys).size, trackerKeys.length, 'tracker key collision')

    const widgetKeys = all.flatMap((pack) => (pack.dataWidgets ?? []).map((w) => w.key))
    assert.equal(new Set(widgetKeys).size, widgetKeys.length, 'widget key collision')

    // Would throw on a duplicate adapter key.
    assert.doesNotThrow(() => collectDataAdapters(all))
  })

  it('relabels the same core key differently per vertical', () => {
    // The clearest demonstration that core owns a neutral concept and packs only
    // name it: one BROADCAST session, two industries, two words.
    assert.equal(
      mergePackLabels([forexPack])['liveSession.kind.BROADCAST'],
      'Live Market Session',
    )
    assert.equal(mergePackLabels([coachingPack])['liveSession.kind.BROADCAST'], 'Live Class')
  })

  it('shares no vocabulary between unrelated verticals', () => {
    const forexLabels = Object.values(forexPack.labels ?? {}).join(' ').toLowerCase()
    const coachingLabels = Object.values(coachingPack.labels ?? {}).join(' ').toLowerCase()

    assert.ok(forexLabels.includes('market'), 'forex should use trading vocabulary')
    assert.ok(!coachingLabels.includes('market'), 'coaching must not inherit trading vocabulary')
    assert.ok(coachingLabels.includes('class'), 'coaching should use classroom vocabulary')
  })
})
