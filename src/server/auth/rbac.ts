/**
 * Authorization helpers.
 *
 * The security boundary lives here, not in middleware. Middleware gates on the
 * JWT, which is a cached claim that can be up to `updateAge` stale — a student
 * promoted or suspended a minute ago still carries the old role. So every
 * protected page and server action funnels through these helpers, which read the
 * live `User` row and enforce `status` on each request.
 *
 * `cache()` dedupes that read across every server component in a single render,
 * so the cost is one query per request regardless of how many components ask.
 */

import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'

import { db } from '@/server/db'
import { auth } from './config'
import { type Permission, isStaffRole, roleHasPermission } from './roles'
import type { Role } from '@/generated/prisma/enums'

export interface CurrentUser {
  id: string
  email: string | null
  name: string
  avatarUrl: string | null
  role: Role
  timezone: string | null
}

/**
 * The signed-in, active user — or null.
 *
 * Returns null for suspended and deactivated accounts even when their token is
 * still valid, which is what makes suspension take effect immediately rather
 * than at the next token refresh.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      role: true,
      status: true,
      timezone: true,
    },
  })

  if (!user || user.status !== 'ACTIVE') return null

  const { status: _status, ...currentUser } = user
  return currentUser
})

/** Redirects to sign-in, preserving the destination. */
export async function requireUser(returnTo?: string): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) {
    const target = returnTo ? `/sign-in?next=${encodeURIComponent(returnTo)}` : '/sign-in'
    redirect(target)
  }
  return user
}

export async function can(permission: Permission): Promise<boolean> {
  const user = await getCurrentUser()
  return user ? roleHasPermission(user.role, permission) : false
}

/**
 * Requires a permission, responding 404 rather than 403 when it is absent.
 *
 * Deliberate: a student probing /admin/payments should not learn that the route
 * exists. Only surfaces whose existence is already public should prefer a 403.
 */
export async function requirePermission(
  permission: Permission,
  returnTo?: string,
): Promise<CurrentUser> {
  const user = await requireUser(returnTo)
  if (!roleHasPermission(user.role, permission)) notFound()
  return user
}

/** Any non-student role. Gate for the /admin shell itself. */
export async function requireStaff(returnTo?: string): Promise<CurrentUser> {
  const user = await requireUser(returnTo)
  if (!isStaffRole(user.role)) notFound()
  return user
}

/**
 * Permission check for API routes and server actions, which need a status code
 * rather than a navigation side effect.
 */
export async function authorizeRequest(
  permission: Permission,
): Promise<{ ok: true; user: CurrentUser } | { ok: false; status: 401 | 403 }> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, status: 401 }
  if (!roleHasPermission(user.role, permission)) return { ok: false, status: 403 }
  return { ok: true, user }
}
