import NextAuth from 'next-auth'

import { edgeAuthConfig } from '@/server/auth/edge'

/**
 * Coarse route gating on the edge. The `authorized` callback in edgeAuthConfig
 * decides; see src/server/auth/rbac.ts for why this is a redirect optimization
 * and not the security boundary.
 */
export default NextAuth(edgeAuthConfig).auth

export const config = {
  matcher: [
    /**
     * Everything except Next internals, the auth endpoints themselves, and files
     * with an extension. Matching /api/auth would break the sign-in handshake,
     * and matching static assets would run middleware on every image request.
     */
    '/((?!api/auth|_next/static|_next/image|favicon.ico|brands/|.*\\.[\\w]+$).*)',
  ],
}
