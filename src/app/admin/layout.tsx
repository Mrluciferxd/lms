import { AppShell } from '@/components/app-shell'
import { buildAdminNav } from '@/lib/nav'
import { requireStaff } from '@/server/auth/rbac'
import { getOrgDisplay } from '@/server/org/settings'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // 404s rather than 403s for students — see requirePermission in rbac.ts.
  const user = await requireStaff('/admin')
  const [nav, org] = await Promise.all([buildAdminNav(user.role), getOrgDisplay()])

  return (
    <AppShell user={user} nav={nav} orgName={`${org.name} Admin`} logoUrl={org.logoLightUrl}>
      {children}
    </AppShell>
  )
}
