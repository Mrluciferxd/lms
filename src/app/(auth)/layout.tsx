import Link from 'next/link'

import { brand } from '@/lib/brand'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-surface-border px-6 py-4">
        <Link href="/" className="text-lg font-semibold text-content">
          {brand.name}
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">{children}</main>

      <footer className="px-6 py-6 text-center text-xs text-content-muted">
        © {new Date().getFullYear()} {brand.legalName ?? brand.name}
      </footer>
    </div>
  )
}
