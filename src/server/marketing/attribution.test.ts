import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  LEAD_SOURCE_HUB,
  LEAD_SOURCE_UNKNOWN,
  landingSlugFromSource,
  landingSource,
  resolveLeadSource,
  sanitizeAttribution,
} from './attribution'

describe('sanitizeAttribution', () => {
  it('keeps the campaign parameters worth attributing spend with', () => {
    assert.deepEqual(
      sanitizeAttribution({
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'foundation-launch',
        gclid: 'abc123',
      }),
      {
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'foundation-launch',
        gclid: 'abc123',
      },
    )
  })

  it('drops keys outside the whitelist, including ones that look like fields', () => {
    assert.deepEqual(
      sanitizeAttribution({
        utm_source: 'newsletter',
        courseId: 'course_123',
        role: 'ADMIN',
        next: 'https://evil.example',
      }),
      { utm_source: 'newsletter' },
    )
  })

  it('takes the first value when a parameter is repeated in the query string', () => {
    assert.deepEqual(sanitizeAttribution({ utm_source: ['first', 'second'] }), {
      utm_source: 'first',
    })
  })

  it('omits blank and whitespace-only values instead of storing empty strings', () => {
    assert.deepEqual(sanitizeAttribution({ utm_source: '   ', utm_medium: '' }), {})
  })

  it('strips control characters that would forge a line in a CSV export', () => {
    const injected = sanitizeAttribution({ utm_campaign: 'spring\r\nadmin,yes' })
    assert.equal(injected.utm_campaign, 'spring admin,yes')
  })

  it('truncates a value long enough to be a payload rather than a campaign name', () => {
    const long = sanitizeAttribution({ utm_term: 'x'.repeat(5000) })
    assert.equal(long.utm_term?.length, 200)
  })

  it('survives non-string and missing input', () => {
    assert.deepEqual(sanitizeAttribution(null), {})
    assert.deepEqual(sanitizeAttribution(undefined), {})
    assert.deepEqual(sanitizeAttribution({ utm_source: undefined }), {})
  })
})

describe('resolveLeadSource', () => {
  const slugs = ['foundation-program', 'advanced-program']

  it('accepts the hub', () => {
    assert.equal(resolveLeadSource(LEAD_SOURCE_HUB, slugs), LEAD_SOURCE_HUB)
  })

  it('accepts a landing page this deployment actually publishes', () => {
    assert.equal(
      resolveLeadSource('landing:foundation-program', slugs),
      landingSource('foundation-program'),
    )
  })

  it('rejects a landing slug the brand does not configure', () => {
    // Otherwise a crafted POST decides what the column contains.
    assert.equal(resolveLeadSource('landing:competitor-page', slugs), LEAD_SOURCE_UNKNOWN)
  })

  for (const hostile of [
    'landing:../../etc/passwd',
    'https://evil.example',
    '<script>alert(1)</script>',
    42,
    null,
    undefined,
    {},
  ]) {
    it(`falls back to unknown for ${JSON.stringify(hostile)}`, () => {
      assert.equal(resolveLeadSource(hostile, slugs), LEAD_SOURCE_UNKNOWN)
    })
  }
})

describe('landingSlugFromSource', () => {
  it('recovers the slug so the action can resolve the course server-side', () => {
    assert.equal(landingSlugFromSource('landing:advanced-program'), 'advanced-program')
  })

  it('returns null for the hub and for unknown', () => {
    assert.equal(landingSlugFromSource(LEAD_SOURCE_HUB), null)
    assert.equal(landingSlugFromSource(LEAD_SOURCE_UNKNOWN), null)
  })
})
