import { AppShell } from '@/components/app-shell'
import { buildAppNav } from '@/lib/nav'
import { requireUser } from '@/server/auth/rbac'
import { isStaffRole } from '@/server/auth/roles'
import { getOrgDisplay } from '@/server/org/settings'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The real authorization check. Middleware only did a coarse token check.
  const user = await requireUser('/app')
  const [nav, org] = await Promise.all([buildAppNav(user.role), getOrgDisplay()])

  return (
    <AppShell
      user={user}
      nav={nav}
      orgName={org.name}
      logoUrl={org.logoLightUrl}
      adminLink={isStaffRole(user.role)}
    >
      {children}
    </AppShell>
  )
}
