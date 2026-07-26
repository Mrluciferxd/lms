import type { Config } from 'tailwindcss'

/**
 * Colours resolve through CSS custom properties set per brand in the root layout
 * (see src/lib/brand/theme.ts). The `rgb(var(--x) / <alpha-value>)` form is what
 * makes opacity modifiers like `bg-primary/10` work off a variable.
 *
 * `primary-foreground` is computed from the brand colour's WCAG luminance rather
 * than hardcoded, so a client with a bright or pale brand colour gets readable
 * button text automatically.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}', './brands/**/*.ts'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'rgb(var(--brand-primary) / <alpha-value>)',
          foreground: 'rgb(var(--brand-primary-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--brand-accent) / <alpha-value>)',
          foreground: 'rgb(var(--brand-accent-foreground) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          muted: 'rgb(var(--surface-muted) / <alpha-value>)',
          border: 'rgb(var(--surface-border) / <alpha-value>)',
        },
        content: {
          DEFAULT: 'rgb(var(--content) / <alpha-value>)',
          muted: 'rgb(var(--content-muted) / <alpha-value>)',
        },
        danger: 'rgb(var(--danger) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
      },
      borderRadius: {
        brand: 'var(--brand-radius)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
