import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { blocksOfType, findBlock, invalidBlockIndexes, parseBlocks } from './blocks'

describe('parseBlocks', () => {
  it('returns nothing for a value that is not an array', () => {
    assert.deepEqual(parseBlocks(null), [])
    assert.deepEqual(parseBlocks({}), [])
    assert.deepEqual(parseBlocks('[]'), [])
  })

  it('keeps valid blocks and drops the rest, so one bad edit costs one section', () => {
    const blocks = parseBlocks([
      { type: 'faq', items: [{ question: 'When does it start?', answer: 'Every month.' }] },
      { type: 'faq', items: [] },
      { type: 'testimonials', items: [{ quote: 'Worth it.', name: 'Asha' }] },
    ])

    assert.equal(blocks.length, 2)
    assert.deepEqual(
      blocks.map((block) => block.type),
      ['faq', 'testimonials'],
    )
  })

  it('ignores a block type it does not know rather than throwing', () => {
    // Forward compatibility: a newer pack seeding a block this build predates
    // must not take down the client's home page.
    assert.deepEqual(parseBlocks([{ type: 'videoWall', items: [] }]), [])
  })

  it('trims whitespace and rejects fields that are only whitespace', () => {
    const [block] = parseBlocks([{ type: 'richText', heading: '  About us  ', body: 'Hello.' }])
    assert.equal(block?.type === 'richText' && block.heading, 'About us')

    assert.deepEqual(parseBlocks([{ type: 'richText', body: '   ' }]), [])
  })

  describe('link safety', () => {
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.example/phish',
      'http://evil.example',
    ]) {
      it(`rejects ${href} in a CTA href`, () => {
        assert.deepEqual(parseBlocks([{ type: 'cta', ctaLabel: 'Go', ctaHref: href }]), [])
      })
    }

    it('accepts an internal path and an https URL', () => {
      const blocks = parseBlocks([
        { type: 'cta', ctaHref: '/foundation-program' },
        { type: 'cta', ctaHref: 'https://example.com/apply' },
      ])
      assert.equal(blocks.length, 2)
    })
  })

  it('caps collection sizes so a runaway import cannot render a megabyte of markup', () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      question: `Q${index}`,
      answer: `A${index}`,
    }))
    assert.deepEqual(parseBlocks([{ type: 'faq', items }]), [])
  })
})

describe('findBlock', () => {
  const blocks = parseBlocks([
    { type: 'richText', body: 'First.' },
    { type: 'faq', items: [{ question: 'Q', answer: 'A' }] },
    { type: 'richText', body: 'Second.' },
  ])

  it('narrows to the requested block type', () => {
    const faq = findBlock(blocks, 'faq')
    assert.equal(faq?.items[0]?.question, 'Q')
  })

  it('returns the first when a type repeats', () => {
    assert.equal(findBlock(blocks, 'richText')?.body, 'First.')
  })

  it('returns null for an absent type', () => {
    assert.equal(findBlock(blocks, 'instructors'), null)
  })
})

describe('blocksOfType', () => {
  it('returns every block of a repeatable type in authored order', () => {
    const blocks = parseBlocks([
      { type: 'richText', body: 'First.' },
      { type: 'faq', items: [{ question: 'Q', answer: 'A' }] },
      { type: 'richText', body: 'Second.' },
    ])

    assert.deepEqual(
      blocksOfType(blocks, 'richText').map((block) => block.body),
      ['First.', 'Second.'],
    )
  })
})

describe('invalidBlockIndexes', () => {
  it('reports positions so an editor can be told which block failed', () => {
    assert.deepEqual(
      invalidBlockIndexes([
        { type: 'richText', body: 'Fine.' },
        { type: 'richText' },
        { type: 'cta', ctaHref: 'javascript:alert(1)' },
      ]),
      [1, 2],
    )
  })

  it('reports nothing for content that fully parses', () => {
    assert.deepEqual(invalidBlockIndexes([{ type: 'richText', body: 'Fine.' }]), [])
  })
})
