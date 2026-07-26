/**
 * The `test` script pins NEXT_PUBLIC_BRAND to demo-academy — the reference
 * deployment with `packs: []`. That makes this file the regression guard for the
 * central architectural claim: with no packs enabled, core vocabulary is
 * complete and industry-neutral.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { activePacks, brand } from './brand'
import { CORE_LABELS, allLabels, liveSessionKindLabel, orphanedPackLabels, t } from './labels'

describe('neutral deployment', () => {
  it('runs against the packless reference brand', () => {
    assert.equal(
      brand.key,
      'demo-academy',
      'tests must run with NEXT_PUBLIC_BRAND=demo-academy — see the `test` script',
    )
    assert.deepEqual(brand.packs, [])
    assert.deepEqual(activePacks, [])
  })

  it('resolves core defaults when no pack overrides exist', () => {
    assert.equal(t('liveSession.kind.BROADCAST'), 'Live Session')
    assert.equal(t('nav.liveSessions'), 'Live Sessions')
    assert.equal(t('course.level.BEGINNER'), 'Beginner')
  })

  it('reports no orphaned overrides', () => {
    assert.deepEqual(orphanedPackLabels(), [])
  })
})

describe('core vocabulary is industry-neutral', () => {
  /**
   * Guards against a vertical term leaking into core during a rushed change. If
   * a core label ever needs one of these words, the feature belongs in a pack —
   * that is the whole premise of the architecture.
   */
  const VERTICAL_TERMS = [
    'forex',
    'trade',
    'trading',
    'market',
    'currency',
    'pip',
    'candlestick',
    'portfolio',
    'workout',
    'patient',
    'clinical',
    'recipe',
  ]

  it('contains no vertical-specific terms', () => {
    const offenders: string[] = []

    for (const [key, value] of Object.entries(CORE_LABELS)) {
      const haystack = value.toLowerCase()
      for (const term of VERTICAL_TERMS) {
        // Word-boundary match so "Marketing" does not trip on "market".
        if (new RegExp(`\\b${term}s?\\b`).test(haystack)) {
          offenders.push(`${key}: "${value}" contains "${term}"`)
        }
      }
    }

    assert.deepEqual(offenders, [], `core labels must stay neutral:\n${offenders.join('\n')}`)
  })

  it('gives every core label a non-empty string', () => {
    for (const [key, value] of Object.entries(CORE_LABELS)) {
      assert.equal(typeof value, 'string', `${key} must be a string`)
      assert.notEqual(value.trim(), '', `${key} must not be empty`)
    }
  })
})

describe('interpolation', () => {
  it('substitutes named variables', () => {
    assert.equal(t('dashboard.welcome', { name: 'Asha' }), 'Welcome back, Asha')
  })

  it('leaves an unsupplied placeholder visible rather than blanking it', () => {
    // A silently-empty greeting is harder to notice in review than a literal
    // {{name}}, which is why the placeholder survives.
    assert.equal(t('dashboard.welcome'), 'Welcome back, {{name}}')
  })

  it('substitutes numbers', () => {
    assert.equal(t('access.unlocksOn', { date: 5 }), 'Unlocks 5')
  })

  it('ignores extra variables', () => {
    assert.equal(t('nav.courses', { unused: 'x' }), 'Courses')
  })
})

describe('liveSessionKindLabel', () => {
  it('resolves singular and plural forms', () => {
    assert.equal(liveSessionKindLabel('CLASS'), 'Class')
    assert.equal(liveSessionKindLabel('CLASS', 'plural'), 'Classes')
    assert.equal(liveSessionKindLabel('WEBINAR'), 'Webinar')
  })

  it('covers every session kind in the schema', () => {
    const kinds = ['CLASS', 'BROADCAST', 'WEBINAR', 'DOUBT_CLEARING', 'EVENT'] as const
    for (const kind of kinds) {
      assert.notEqual(liveSessionKindLabel(kind), undefined, `${kind} has no singular label`)
      assert.notEqual(
        liveSessionKindLabel(kind, 'plural'),
        undefined,
        `${kind} has no plural label`,
      )
    }
  })
})

describe('allLabels', () => {
  it('returns core labels unchanged for a packless deployment', () => {
    assert.deepEqual(allLabels(), { ...CORE_LABELS })
  })
})
