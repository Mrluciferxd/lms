import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { brand } from '@/lib/brand'

/**
 * Placeholder home page. The real marketing site — hub page plus the two course
 * landing pages from section 2.1 of the proposal — is week 4 of the roadmap.
 * This exists so the app runs end to end and so brand theming is visibly wired.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center justify-between px-6">
        <span className="text-lg font-semibold text-content">{brand.name}</span>
        <Link href="/sign-in">
          <Button variant="secondary" size="sm">
            Sign in
          </Button>
        </Link>
      </header>

      <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center px-6 py-16">
        <p className="text-sm font-medium uppercase tracking-wide text-primary">
          {brand.marketing.tagline}
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-content sm:text-5xl">
          {brand.name}
        </h1>
        <p className="mt-4 text-lg text-content-muted">{brand.marketing.description}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/sign-in">
            <Button size="lg">Sign in to your account</Button>
          </Link>
        </div>

        <p className="mt-12 rounded-brand border border-surface-border bg-surface-muted px-4 py-3 text-sm text-content-muted">
          Marketing site and course landing pages are scheduled for week 4 — see
          <code className="mx-1 font-mono text-xs">docs/05-roadmap.md</code>.
        </p>
      </main>

      <footer className="space-y-3 border-t border-surface-border px-6 py-8 text-xs text-content-muted">
        <p>
          © {new Date().getFullYear()} {brand.legalName ?? brand.name}
        </p>
        {brand.marketing.riskDisclaimer && (
          <p className="max-w-3xl leading-relaxed">{brand.marketing.riskDisclaimer}</p>
        )}
      </footer>
    </div>
  )
}
