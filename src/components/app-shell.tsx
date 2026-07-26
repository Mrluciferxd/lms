import Link from 'next/link'

import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import { initials } from '@/lib/utils'
import type { NavItem } from '@/lib/nav'
import { ROLE_LABELS } from '@/server/auth/roles'
import { signOutAction } from '@/server/auth/actions'
import type { CurrentUser } from '@/server/auth/rbac'

/**
 * Shared chrome for the authenticated areas. Takes its nav as a prop rather than
 * building it, so /app and /admin can compose different menus from the same shell.
 */
export function AppShell({
  user,
  nav,
  orgName,
  logoUrl,
  children,
  adminLink,
}: {
  user: CurrentUser
  nav: NavItem[]
  orgName: string
  logoUrl: string | null
  children: React.ReactNode
  adminLink?: boolean
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-surface-border bg-surface/95 backdrop-blur">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
          <Link href="/app" className="flex items-center gap-2 font-semibold text-content">
            <BrandLogo src={logoUrl} orgName={orgName} className="h-7 w-auto" />
          </Link>

          <div className="ml-auto flex items-center gap-3">
            {adminLink && (
              <Link
                href="/admin"
                className="hidden text-sm text-content-muted hover:text-content sm:block"
              >
                Admin
              </Link>
            )}

            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
              >
                {initials(user.name)}
              </span>
              <span className="hidden text-sm leading-tight sm:block">
                <span className="block text-content">{user.name}</span>
                <span className="block text-xs text-content-muted">
                  {ROLE_LABELS[user.role]}
                </span>
              </span>
            </div>

            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <nav
          aria-label="Main"
          className="border-b border-surface-border p-3 md:w-56 md:shrink-0 md:border-b-0 md:border-r"
        >
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {nav.map((item) => (
              <li key={item.key} className="shrink-0 md:shrink">
                <Link
                  href={item.href}
                  className="block whitespace-nowrap rounded-brand px-3 py-2 text-sm text-content-muted transition-colors hover:bg-surface-muted hover:text-content"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
