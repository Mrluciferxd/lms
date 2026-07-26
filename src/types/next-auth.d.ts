import type { DefaultSession } from 'next-auth'

import type { Role } from '@/generated/prisma/enums'

/**
 * Adds `id` and `role` to the session and JWT. Without this the role we set in
 * the callbacks is invisible to TypeScript and every read needs a cast.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: Role
    } & DefaultSession['user']
  }

  interface User {
    role?: Role
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: Role
  }
}

/**
 * Also augment the underlying @auth/core module. next-auth re-exports its JWT
 * type from here, and the `session` callback is typed against this one — so
 * augmenting only 'next-auth/jwt' leaves `token.role` as `{}` at that call site.
 */
declare module '@auth/core/jwt' {
  interface JWT {
    role?: Role
  }
}
