import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ThemeError,
  auditBrandContrast,
  brandCssVariables,
  contrastRatio,
  meetsContrastAA,
  parseHexColor,
  readableForeground,
  relativeLuminance,
  toChannelString,
} from './theme'
import { type BrandInput, defineBrand } from './types'

const WHITE = { r: 255, g: 255, b: 255 }
const BLACK = { r: 0, g: 0, b: 0 }

describe('parseHexColor', () => {
  it('parses 6-digit hex with and without a hash', () => {
    assert.deepEqual(parseHexColor('#00ADEF'), { r: 0, g: 173, b: 239 })
    assert.deepEqual(parseHexColor('00adef'), { r: 0, g: 173, b: 239 })
  })

  it('expands 3-digit shorthand', () => {
    assert.deepEqual(parseHexColor('#fff'), WHITE)
    assert.deepEqual(parseHexColor('#f00'), { r: 255, g: 0, b: 0 })
  })

  it('rejects malformed input rather than silently defaulting', () => {
    for (const bad of ['', '#', 'ggg', '#12345', '#1234567', 'rgb(0,0,0)']) {
      assert.throws(() => parseHexColor(bad), ThemeError, `should reject ${bad}`)
    }
  })
})

describe('luminance and contrast', () => {
  it('anchors luminance at the extremes', () => {
    assert.equal(relativeLuminance(BLACK), 0)
    assert.equal(relativeLuminance(WHITE), 1)
  })

  it('gives white-on-black the maximum 21:1 ratio', () => {
    assert.ok(Math.abs(contrastRatio(WHITE, BLACK) - 21) < 0.01)
  })

  it('is order-independent', () => {
    const a = parseHexColor('#00ADEF')
    assert.equal(contrastRatio(a, WHITE), contrastRatio(WHITE, a))
  })
})

describe('readableForeground', () => {
  /**
   * The case that motivates the whole module: Nirlep's #00ADEF is a bright cyan.
   * A naive `text-white` button would be unreadable on it (about 2.5:1), while
   * dark text clears AA comfortably.
   */
  it('picks dark text on Nirlep bright cyan', () => {
    const primary = parseHexColor('#00ADEF')
    const fg = readableForeground(primary)
    assert.ok(fg.r < 128, 'expected a dark foreground')
    assert.ok(
      contrastRatio(primary, fg) > contrastRatio(primary, WHITE),
      'chosen foreground must beat white',
    )
    assert.equal(meetsContrastAA(primary, fg), true)
  })

  it('picks light text on a dark navy', () => {
    const navy = parseHexColor('#0B1F33')
    const fg = readableForeground(navy)
    assert.deepEqual(fg, WHITE)
    assert.equal(meetsContrastAA(navy, fg), true)
  })

  it('picks dark text on yellow, where a luminance threshold often guesses wrong', () => {
    const yellow = parseHexColor('#FFD400')
    assert.ok(readableForeground(yellow).r < 128)
    assert.equal(meetsContrastAA(yellow, readableForeground(yellow)), true)
  })

  it('always returns the better of the two options', () => {
    for (const hex of ['#000000', '#ffffff', '#808080', '#00ADEF', '#7f5af0', '#2563eb']) {
      const bg = parseHexColor(hex)
      const chosen = readableForeground(bg)
      const other = chosen.r === 255 ? { r: 12, g: 18, b: 32 } : WHITE
      assert.ok(
        contrastRatio(bg, chosen) >= contrastRatio(bg, other),
        `${hex}: chose the worse foreground`,
      )
    }
  })
})

describe('brandCssVariables', () => {
  const brand = defineBrand({
    key: 'test',
    name: 'Test',
    domain: 'test.local',
    supportEmail: 'a@test.local',
    logo: { light: '/l.svg' },
    theme: { primary: '#00ADEF', accent: '#0B1F33', radius: 'lg' },
    packs: [],
    integrations: { payments: 'manual', video: 's3', storage: 's3', email: 'smtp' },
    marketing: { tagline: 't', description: 'd', landingPages: [] },
  })

  it('emits channel triplets so Tailwind opacity modifiers work', () => {
    const vars = brandCssVariables(brand)
    assert.equal(vars['--brand-primary'], '0 173 239')
    assert.equal(vars['--brand-accent'], '11 31 51')
  })

  it('derives a readable foreground per colour, not one global default', () => {
    const vars = brandCssVariables(brand)
    // Dark text on the bright primary, white text on the dark accent.
    assert.equal(vars['--brand-primary-foreground'], '12 18 32')
    assert.equal(vars['--brand-accent-foreground'], '255 255 255')
  })

  it('maps the radius scale', () => {
    assert.equal(brandCssVariables(brand)['--brand-radius'], '0.75rem')
  })

  it('falls back to primary when no accent is given', () => {
    const noAccent = defineBrand({ ...brand, theme: { primary: '#2563eb' } })
    const vars = brandCssVariables(noAccent)
    assert.equal(vars['--brand-accent'], vars['--brand-primary'])
  })

  it('formats channels for CSS', () => {
    assert.equal(toChannelString({ r: 1, g: 2, b: 3 }), '1 2 3')
  })
})

describe('auditBrandContrast', () => {
  const base: Omit<BrandInput, 'theme'> = {
    key: 'test',
    name: 'Test',
    domain: 'test.local',
    supportEmail: 'a@test.local',
    logo: { light: '/l.svg' },
    packs: [],
    integrations: { payments: 'manual', video: 's3', storage: 's3', email: 'smtp' },
    marketing: { tagline: 't', description: 'd', landingPages: [] },
  }

  it('passes brand colours that can be made readable', () => {
    const brand = defineBrand({ ...base, theme: { primary: '#00ADEF' } })
    assert.deepEqual(auditBrandContrast(brand), [])
  })

  /**
   * #767676 is the well-known boundary grey — exactly 4.54:1 against white — so
   * it passes. The genuinely unusable band is slightly darker, where contrast
   * against white has fallen below AA but contrast against near-black has not yet
   * risen to meet it. #7A7A7A sits near that worst case at roughly 4.3:1 either
   * way, and no choice of foreground rescues it.
   */
  it('passes the boundary grey that clears AA against white', () => {
    const brand = defineBrand({ ...base, theme: { primary: '#767676' } })
    assert.deepEqual(auditBrandContrast(brand), [])
  })

  it('flags the worst-case mid-grey, which neither foreground can rescue', () => {
    const brand = defineBrand({ ...base, theme: { primary: '#7A7A7A' } })
    const warnings = auditBrandContrast(brand)
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0]?.token, 'theme.primary')
    assert.ok(warnings[0]!.ratio < 4.5, `ratio was ${warnings[0]?.ratio}`)
  })

  it('flags a failing accent independently of the primary', () => {
    const brand = defineBrand({
      ...base,
      theme: { primary: '#00ADEF', accent: '#7A7A7A' },
    })
    const warnings = auditBrandContrast(brand)
    assert.deepEqual(
      warnings.map((w) => w.token),
      ['theme.accent'],
    )
  })
})
