/**
 * Edge-safe auth configuration.
 *
 * Middleware runs on the edge runtime, which cannot load Prisma or bcrypt. So the
 * config is split: this half carries only what middleware needs — JWT decoding
 * and the route-authorization rule — while the full config with the database
 * adapter and providers lives in ./config.ts.
 *
 * Both halves must use the same AUTH_SECRET, which they do by reading the same
 * environment variable.
 */

import type { NextAuthConfig } from 'next-auth'

import { STAFF_ROLES } from './roles'

/** Route prefixes requiring any authenticated user. */
const AUTHENTICATED_PREFIXES = ['/app']
/** Route prefixes requiring a non-student role. */
const STAFF_PREFIXES = ['/admin']

export const edgeAuthConfig: NextAuthConfig = {
  // Providers are registered in the full config; middleware only decodes tokens.
  providers: [],

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
    // How often the JWT is refreshed, which is also the window within which a
    // role change or suspension propagates into the token.
    updateAge: 24 * 60 * 60,
  },

  pages: {
    signIn: '/sign-in',
    error: '/sign-in',
  },

  callbacks: {
    /**
     * Coarse route gating only. This is a fast redirect for the common case, not
     * the security boundary — the edge token is a cached claim, so pages and
     * server actions still call `requireUser` / `requirePermission`, which read
     * the live user row. A user suspended one minute ago still holds a valid
     * token; middleware would let them through and the page-level check stops
     * them.
     */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl
      const role = auth?.user?.role

      if (STAFF_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
        return role !== undefined && STAFF_ROLES.includes(role)
      }

      if (AUTHENTICATED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
        return Boolean(auth?.user)
      }

      return true
    },
  },
}
