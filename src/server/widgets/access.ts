/**
 * Widget access authorization.
 *
 * Widgets are read-mostly dashboard data: the access surface is thin compared
 * to journals or assignments because the only writes happen on the cron side,
 * which never runs as a user. What must hold:
 *  - A disabled widget 404s, not merely hides — the pack nav links a direct URL
 *    and hiding a link is not gating.
 *  - The standalone page only serves widgets that declared the `standalone`
 *    surface. A feed meant for a dashboard card has no business on its own
 *    route.
 *  - Every reader is a signed-in active member; there is no anonymous preview
 *    of a feed the client pays for.
 */

import { db } from '@/server/db'
import { isStaffRole } from '@/server/auth/roles'
import type { Role } from '@/generated/prisma/enums'

export type WidgetVisibilityDenialReason =
  | 'NOT_AUTHENTICATED'
  | 'WIDGET_DISABLED'

export interface WidgetDefinitionSubject {
  enabled: boolean
  surfaces: readonly string[]
}

export interface WidgetViewer {
  id: string
  role: Role
  isStaff: boolean
}

/**
 * May the viewer see this widget's snapshot? Enabled + signed-in. There is no
 * per-role visibility — the feed is cohort-wide data, so a student sees the
 * same economic calendar an instructor does.
 */
export function decideWidgetVisibility(
  definition: WidgetDefinitionSubject,
  viewer: WidgetViewer | null,
): { visible: true } | { visible: false; reason: WidgetVisibilityDenialReason } {
  if (!definition.enabled) return { visible: false, reason: 'WIDGET_DISABLED' }
  if (!viewer) return { visible: false, reason: 'NOT_AUTHENTICATED' }
  return { visible: true }
}

/** Does the definition declare the standalone page surface? */
export function isStandaloneWidget(definition: WidgetDefinitionSubject): boolean {
  return definition.surfaces.includes('standalone')
}

/** Loads the per-page widget viewer — the active user row, one query. */
export async function loadWidgetViewer(viewerId: string | null): Promise<WidgetViewer | null> {
  if (!viewerId) return null

  const user = await db.user.findUnique({
    where: { id: viewerId },
    select: { id: true, role: true, status: true },
  })

  if (!user || user.status !== 'ACTIVE') return null

  return { id: user.id, role: user.role, isStaff: isStaffRole(user.role) }
}
