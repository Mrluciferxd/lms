/**
 * Brand theming.
 *
 * A brand config supplies hex colours; Tailwind needs RGB channel triplets so
 * that opacity modifiers (`bg-primary/50`) work. This module does that
 * conversion and — more importantly — picks a readable foreground colour for
 * each brand colour automatically.
 *
 * That last part is load-bearing for a white-label product. Client colours are
 * chosen by their designer, not by us: a bright cyan or a yellow needs dark text
 * on buttons while a navy needs white. Hardcoding `text-white` on primary
 * buttons ships an unreadable UI to some future client, and nobody notices until
 * they do. Computing it from WCAG relative luminance means every brand gets it
 * right without anyone thinking about it.
 */

import type { BrandConfig } from './types'

export interface RgbChannels {
  r: number
  g: number
  b: number
}

/** Foreground used on dark backgrounds. Not pure white — softer on the eye. */
const LIGHT_FOREGROUND: RgbChannels = { r: 255, g: 255, b: 255 }
/** Foreground used on light backgrounds. Near-black rather than pure black. */
const DARK_FOREGROUND: RgbChannels = { r: 12, g: 18, b: 32 }

export class ThemeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ThemeError'
  }
}

/** Accepts `#abc`, `#aabbcc`, `abc`, `aabbcc`. */
export function parseHexColor(input: string): RgbChannels {
  const hex = input.trim().replace(/^#/, '')

  if (!/^[0-9a-fA-F]+$/.test(hex) || (hex.length !== 3 && hex.length !== 6)) {
    throw new ThemeError(
      `Invalid hex colour "${input}". Expected 3 or 6 hex digits, optionally prefixed with #.`,
    )
  }

  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

/** Tailwind's `rgb(var(--x) / <alpha-value>)` form expects "R G B". */
export function toChannelString({ r, g, b }: RgbChannels): string {
  return `${r} ${g} ${b}`
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance({ r, g, b }: RgbChannels): number {
  const linearize = (channel: number): number => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** WCAG contrast ratio, 1:1 to 21:1. Order-independent. */
export function contrastRatio(a: RgbChannels, b: RgbChannels): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Picks whichever of the two foregrounds contrasts better against `background`.
 * Compares actual contrast ratios rather than thresholding luminance, because
 * mid-tone brand colours sit right where a naive threshold guesses wrong.
 */
export function readableForeground(background: RgbChannels): RgbChannels {
  return contrastRatio(background, LIGHT_FOREGROUND) >=
    contrastRatio(background, DARK_FOREGROUND)
    ? LIGHT_FOREGROUND
    : DARK_FOREGROUND
}

/** Whether a colour pairing clears WCAG AA for normal-size text. */
export function meetsContrastAA(a: RgbChannels, b: RgbChannels): boolean {
  return contrastRatio(a, b) >= 4.5
}

const RADIUS_REM: Record<NonNullable<BrandConfig['theme']['radius']>, string> = {
  none: '0',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
}

/**
 * The CSS custom properties injected on `<html>`. Consumed by tailwind.config.ts,
 * so every `bg-primary` / `text-primary-foreground` in the app resolves per brand
 * with no per-brand stylesheet.
 */
export function brandCssVariables(brand: BrandConfig): Record<string, string> {
  const primary = parseHexColor(brand.theme.primary)
  const accent = brand.theme.accent ? parseHexColor(brand.theme.accent) : primary

  return {
    '--brand-primary': toChannelString(primary),
    '--brand-primary-foreground': toChannelString(readableForeground(primary)),
    '--brand-accent': toChannelString(accent),
    '--brand-accent-foreground': toChannelString(readableForeground(accent)),
    '--brand-radius': RADIUS_REM[brand.theme.radius ?? 'md'],
  }
}

/** Serialized for a `<style>` tag; avoids a hydration-mismatched inline style. */
export function brandCssText(brand: BrandConfig): string {
  const entries = Object.entries(brandCssVariables(brand))
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n')
  return `:root {\n${entries}\n}`
}

export interface ContrastWarning {
  token: string
  ratio: number
}

/**
 * Reports brand colour pairings that fail WCAG AA. Surfaced by the seed script
 * so a client's colour choice gets flagged at onboarding rather than after a
 * student complains they cannot read the buttons.
 */
export function auditBrandContrast(brand: BrandConfig): ContrastWarning[] {
  const warnings: ContrastWarning[] = []
  const checks: Array<[string, string | undefined]> = [
    ['theme.primary', brand.theme.primary],
    ['theme.accent', brand.theme.accent],
  ]

  for (const [token, hex] of checks) {
    if (!hex) continue
    const colour = parseHexColor(hex)
    const ratio = contrastRatio(colour, readableForeground(colour))
    if (ratio < 4.5) {
      warnings.push({ token, ratio: Math.round(ratio * 100) / 100 })
    }
  }

  return warnings
}
