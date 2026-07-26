import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  absoluteUrl,
  courseJsonLd,
  faqJsonLd,
  isIndexable,
  minorToDecimalString,
  organizationJsonLd,
  serializeJsonLd,
  summarize,
} from './seo'

describe('isIndexable', () => {
  it('permits indexing only in production', () => {
    assert.equal(isIndexable('production'), true)
    assert.equal(isIndexable('development'), false)
    assert.equal(isIndexable('test'), false)
    // A staging build with no NODE_ENV must not fall through to indexable.
    assert.equal(isIndexable(undefined), false)
  })
})

describe('minorToDecimalString', () => {
  it('renders paise as an unlocalized decimal, with no symbol or grouping', () => {
    assert.equal(minorToDecimalString(4_999_900), '49999.00')
    assert.equal(minorToDecimalString(150), '1.50')
    assert.equal(minorToDecimalString(5), '0.05')
    assert.equal(minorToDecimalString(0), '0.00')
  })

  it('never produces a float artefact', () => {
    // 8_675_309 / 100 is 86753.09 exactly in decimal but not in binary.
    assert.equal(minorToDecimalString(8_675_309), '86753.09')
    assert.equal(minorToDecimalString(1_000_000_007), '10000000.07')
  })
})

describe('summarize', () => {
  it('collapses whitespace', () => {
    assert.equal(summarize('  Structured   preparation.\nMeasurable progress. '), 'Structured preparation. Measurable progress.')
  })

  it('truncates on a word boundary', () => {
    const summary = summarize('the quick brown fox jumps over the lazy dog', 20)
    assert.ok(summary!.length <= 20)
    assert.ok(!summary!.includes('jum…'))
  })

  it('returns undefined for empty input so a meta tag is omitted, not blank', () => {
    assert.equal(summarize(null), undefined)
    assert.equal(summarize('   '), undefined)
  })
})

describe('serializeJsonLd', () => {
  it('escapes < so admin-authored copy cannot close the script element', () => {
    const serialized = serializeJsonLd({ description: 'Buy now </script><script>alert(1)</script>' })
    assert.ok(!serialized.includes('</script>'))
    assert.ok(serialized.includes('\\u003c'))
  })

  it('stays valid JSON after escaping', () => {
    const value = { description: 'a < b </script>' }
    assert.deepEqual(JSON.parse(serializeJsonLd(value)), value)
  })
})

describe('absoluteUrl', () => {
  it('resolves a path against the site base', () => {
    assert.equal(absoluteUrl('/foundation-program', 'https://example.com'), 'https://example.com/foundation-program')
  })

  it('does not double the slash when the base carries one', () => {
    assert.equal(absoluteUrl('/', 'https://example.com/'), 'https://example.com/')
  })
})

describe('courseJsonLd', () => {
  const base = {
    name: 'Foundation Programme',
    description: 'Eight weeks of structured curriculum.',
    url: 'https://example.com/foundation-program',
    provider: { name: 'Example Academy', url: 'https://example.com' },
  }

  it('emits a Course with its provider', () => {
    const jsonLd = courseJsonLd(base)
    assert.equal(jsonLd['@type'], 'Course')
    assert.deepEqual(jsonLd.provider, {
      '@type': 'EducationalOrganization',
      name: 'Example Academy',
      url: 'https://example.com',
    })
  })

  it('prices from minor units and marks the offer category', () => {
    const offers = courseJsonLd({ ...base, priceMinor: 4_999_900, currency: 'INR' }).offers as Record<
      string,
      unknown
    >
    assert.equal(offers.price, '49999.00')
    assert.equal(offers.priceCurrency, 'INR')
    assert.equal(offers.category, 'Paid')
  })

  it('marks a zero price as free rather than omitting the offer', () => {
    const offers = courseJsonLd({ ...base, priceMinor: 0 }).offers as Record<string, unknown>
    assert.equal(offers.category, 'Free')
    assert.equal(offers.price, '0.00')
  })

  it('omits offers when the course is not directly purchasable', () => {
    assert.equal(courseJsonLd({ ...base, priceMinor: null }).offers, undefined)
  })

  it('emits one CourseInstance per open batch, date-only', () => {
    const instances = courseJsonLd({
      ...base,
      instances: [
        { startDate: new Date('2026-09-01T03:30:00Z'), endDate: new Date('2026-10-27T03:30:00Z') },
        { startDate: new Date('2026-11-01T03:30:00Z'), endDate: null },
      ],
    }).hasCourseInstance as Array<Record<string, unknown>>

    assert.equal(instances.length, 2)
    assert.equal(instances[0]?.startDate, '2026-09-01')
    assert.equal(instances[0]?.endDate, '2026-10-27')
    assert.equal(instances[1]?.endDate, undefined)
  })

  it('describes a course with no batches as self-paced rather than emitting none', () => {
    // Google rejects a Course without hasCourseInstance, and a self-paced course
    // legitimately has no cohort rows.
    const instances = courseJsonLd(base).hasCourseInstance as Array<Record<string, unknown>>
    assert.equal(instances.length, 1)
    assert.equal(instances[0]?.courseSchedule, 'Self-Paced')
  })

  it('leaves out properties it has no value for', () => {
    const jsonLd = courseJsonLd({ ...base, description: null, imageUrl: null })
    assert.ok(!('description' in jsonLd))
    assert.ok(!('image' in jsonLd))
  })
})

describe('organizationJsonLd', () => {
  it('emits an EducationalOrganization for any vertical', () => {
    const jsonLd = organizationJsonLd({
      name: 'Example Academy',
      url: 'https://example.com',
      sameAs: ['https://instagram.com/example'],
    })

    assert.equal(jsonLd['@type'], 'EducationalOrganization')
    assert.deepEqual(jsonLd.sameAs, ['https://instagram.com/example'])
  })

  it('omits an empty social list rather than emitting an empty array', () => {
    assert.ok(!('sameAs' in organizationJsonLd({ name: 'A', url: 'https://a.example', sameAs: [] })))
  })
})

describe('faqJsonLd', () => {
  it('maps questions to the FAQPage shape', () => {
    const jsonLd = faqJsonLd([{ question: 'Is there a demo?', answer: 'Yes.' }])!
    const entities = jsonLd.mainEntity as Array<Record<string, unknown>>

    assert.equal(jsonLd['@type'], 'FAQPage')
    assert.equal(entities[0]?.name, 'Is there a demo?')
    assert.deepEqual(entities[0]?.acceptedAnswer, { '@type': 'Answer', text: 'Yes.' })
  })

  it('returns null with no questions, so no empty entity is emitted', () => {
    assert.equal(faqJsonLd([]), null)
  })
})
