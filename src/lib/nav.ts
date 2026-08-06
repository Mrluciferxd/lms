/**
 * Navigation composition.
 *
 * Core items are feature-gated and role-filtered; pack items are merged in by
 * `order`. This is the seam that lets the forex pack add "Live Market" and
 * "Trade Journal" to the sidebar without core knowing they exist — and lets a
 * deployment with `packs: []` render a complete, coherent menu anyway.
 */

import { packNavItems } from '@/lib/brand'
import { type LabelKey, t } from '@/lib/labels'
import { resolveFeatures } from '@/server/org/settings'
import { roleHasPermission } from '@/server/auth/roles'
import type { BrandFeatures } from '@/lib/brand/types'
import type { Permission } from '@/server/auth/roles'
import type { Role } from '@/generated/prisma/enums'

export interface NavItem {
  key: string
  label: string
  href: string
  icon?: string
  order: number
}

interface CoreNavDefinition {
  key: string
  labelKey: LabelKey
  href: string
  icon: string
  order: number
  /** Hidden unless this feature is enabled. */
  feature?: keyof BrandFeatures
  /** Hidden unless the role holds this permission. */
  permission?: Permission
  /** Hidden for these roles even when the checks above pass. */
  hideForRoles?: readonly Role[]
}

const APP_NAV: readonly CoreNavDefinition[] = [
  { key: 'dashboard', labelKey: 'nav.dashboard', href: '/app', icon: 'layout-dashboard', order: 10 },
  { key: 'courses', labelKey: 'nav.courses', href: '/app/courses', icon: 'book-open', order: 20 },
  {
    key: 'live',
    labelKey: 'nav.liveSessions',
    href: '/app/live',
    icon: 'radio',
    order: 30,
    feature: 'liveSessions',
  },
  {
    key: 'trackers',
    labelKey: 'nav.trackers',
    href: '/app/trackers',
    icon: 'activity',
    order: 50,
    feature: 'trackers',
  },
  {
    key: 'assignments',
    labelKey: 'nav.assignments',
    href: '/app/assignments',
    icon: 'clipboard-list',
    order: 60,
    feature: 'assignments',
  },
  {
    key: 'resources',
    labelKey: 'nav.resources',
    href: '/app/resources',
    icon: 'folder',
    order: 70,
    feature: 'resources',
  },
  {
    key: 'calendar',
    labelKey: 'nav.calendar',
    href: '/app/calendar',
    icon: 'calendar',
    order: 80,
    feature: 'calendar',
  },
  {
    key: 'community',
    labelKey: 'nav.community',
    href: '/app/community',
    icon: 'messages-square',
    order: 90,
    feature: 'chat',
  },
  {
    key: 'notifications',
    labelKey: 'nav.notifications',
    href: '/app/notifications',
    icon: 'bell',
    order: 95,
  },
  {
    key: 'billing',
    labelKey: 'nav.billing',
    href: '/app/billing',
    icon: 'receipt',
    order: 100,
    feature: 'feeInstallments',
    // Staff manage fees from the admin console, not their own billing page.
    hideForRoles: ['OWNER', 'ADMIN', 'STAFF'],
  },
]

const ADMIN_NAV: readonly CoreNavDefinition[] = [
  { key: 'overview', labelKey: 'nav.dashboard', href: '/admin', icon: 'gauge', order: 10 },
  {
    key: 'courses',
    labelKey: 'nav.courses',
    href: '/admin/courses',
    icon: 'book-open',
    order: 20,
    permission: 'course:read',
  },
  {
    key: 'batches',
    labelKey: 'nav.batches',
    href: '/admin/batches',
    icon: 'users',
    order: 30,
    permission: 'batch:manage',
  },
  {
    key: 'students',
    labelKey: 'nav.students',
    href: '/admin/students',
    icon: 'graduation-cap',
    order: 40,
    permission: 'student:read',
  },
  {
    key: 'attendance',
    labelKey: 'nav.attendance',
    href: '/admin/attendance',
    icon: 'check-square',
    order: 50,
    feature: 'attendance',
    permission: 'attendance:mark',
  },
  {
    key: 'payments',
    labelKey: 'nav.payments',
    href: '/admin/payments',
    icon: 'credit-card',
    order: 60,
    permission: 'payment:read',
  },
  {
    key: 'coupons',
    labelKey: 'nav.coupons',
    href: '/admin/coupons',
    icon: 'ticket',
    order: 65,
    permission: 'payment:manage',
  },
  {
    key: 'notifications',
    labelKey: 'nav.notifications',
    href: '/admin/notifications',
    icon: 'bell',
    order: 70,
    permission: 'notification:manage',
  },
  {
    key: 'community',
    labelKey: 'nav.community',
    href: '/admin/community',
    icon: 'messages-square',
    order: 75,
    feature: 'chat',
    permission: 'chat:moderate',
  },
  {
    key: 'journal-review',
    labelKey: 'nav.journals',
    href: '/admin/journal',
    icon: 'book-heart',
    order: 80,
    feature: 'journals',
    permission: 'journal:review',
  },
  {
    key: 'tracker-manage',
    labelKey: 'nav.trackers',
    href: '/admin/trackers',
    icon: 'activity',
    order: 82,
    feature: 'trackers',
    permission: 'tracker:manage',
  },
  {
    key: 'settings',
    labelKey: 'nav.settings',
    href: '/admin/settings',
    icon: 'settings',
    order: 100,
    permission: 'settings:manage',
  },
]

async function buildNav(
  definitions: readonly CoreNavDefinition[],
  role: Role,
  includePackItems: boolean,
): Promise<NavItem[]> {
  const features = await resolveFeatures()

  const coreItems: NavItem[] = definitions
    .filter((item) => (item.feature ? features[item.feature] : true))
    .filter((item) => (item.permission ? roleHasPermission(role, item.permission) : true))
    .filter((item) => !item.hideForRoles?.includes(role))
    .map((item) => ({
      key: item.key,
      label: t(item.labelKey),
      href: item.href,
      icon: item.icon,
      order: item.order,
    }))

  const fromPacks: NavItem[] = includePackItems
    ? packNavItems
        .filter((item) => !item.roles || item.roles.includes(role))
        .map((item) => ({
          key: item.key,
          label: item.label,
          href: item.href,
          icon: item.icon,
          order: item.order ?? 100,
        }))
    : []

  // Packs may legitimately want to replace a core entry (forex's "Live Market"
  // supersedes the generic "Live Sessions" link). Same href wins for the pack.
  const packHrefs = new Set(fromPacks.map((item) => item.href))

  return [...coreItems.filter((item) => !packHrefs.has(item.href)), ...fromPacks].sort(
    (a, b) => a.order - b.order || a.label.localeCompare(b.label),
  )
}

export function buildAppNav(role: Role): Promise<NavItem[]> {
  return buildNav(APP_NAV, role, true)
}

export function buildAdminNav(role: Role): Promise<NavItem[]> {
  // Pack nav items target the student-facing app, not the admin console.
  return buildNav(ADMIN_NAV, role, false)
}
