import { PrismaAdapter } from '@auth/prisma-adapter'
import NextAuth, { type NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import type { Provider } from 'next-auth/providers'
import { z } from 'zod'

import { db } from '@/server/db'
import { edgeAuthConfig } from './edge'
import { burnPasswordComparison, hashPassword, needsRehash, verifyPassword } from './password'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

/**
 * Google is registered only when configured.
 *
 * A white-label deployment may or may not have OAuth set up, and an unconfigured
 * provider in the list renders a "Continue with Google" button that always errors.
 * Better to not show it.
 */
function buildProviders(): Provider[] {
  const providers: Provider[] = [
    Credentials({
      id: 'credentials',
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials)
        if (!parsed.success) return null

        const { email, password } = parsed.data
        const user = await db.user.findUnique({
          where: { email: email.toLowerCase() },
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            role: true,
            status: true,
            passwordHash: true,
          },
        })

        // Spend the same bcrypt time whether or not the account exists, so
        // response timing does not reveal which emails are enrolled.
        if (!user?.passwordHash) {
          await burnPasswordComparison(password)
          return null
        }

        // INVITED users have no usable password yet; they must complete the
        // invite flow. SUSPENDED and DEACTIVATED cannot sign in at all.
        if (user.status !== 'ACTIVE') {
          await burnPasswordComparison(password)
          return null
        }

        if (!(await verifyPassword(password, user.passwordHash))) return null

        // Opportunistically upgrade the hash's cost factor now that we hold the
        // plaintext and have already verified it.
        if (needsRehash(user.passwordHash)) {
          await db.user.update({
            where: { id: user.id },
            data: { passwordHash: await hashPassword(password) },
          })
        }

        await db.user.update({
          where: { id: user.id },
          data: { lastActiveAt: new Date() },
        })

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatarUrl,
          role: user.role,
        }
      },
    }),
  ]

  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
        allowDangerousEmailAccountLinking: false,
      }),
    )
  }

  return providers
}

export const authConfig: NextAuthConfig = {
  ...edgeAuthConfig,
  adapter: PrismaAdapter(db),
  providers: buildProviders(),

  callbacks: {
    ...edgeAuthConfig.callbacks,

    /**
     * OAuth sign-in gate.
     *
     * An academy is not an open signup product: students are enrolled, not
     * self-registered. So a Google sign-in only succeeds for an email that
     * already has a non-deactivated account — otherwise anyone with a Google
     * account could create a user row here.
     */
    async signIn({ user, account }) {
      if (account?.provider === 'credentials') return true

      const email = user.email?.toLowerCase()
      if (!email) return false

      const existing = await db.user.findUnique({
        where: { email },
        select: { id: true, status: true },
      })

      if (!existing) return false
      if (existing.status === 'SUSPENDED' || existing.status === 'DEACTIVATED') return false

      // First OAuth sign-in completes an invitation.
      if (existing.status === 'INVITED') {
        await db.user.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', emailVerified: new Date() },
        })
      }

      return true
    },

    /**
     * Carries id and role on the token so middleware can gate routes without a
     * database read. Refreshed on `updateAge`; page-level checks read the live
     * row, so a stale role here is a routing hint, never an authorization
     * decision.
     */
    async jwt({ token, user, trigger }) {
      if (user?.id) {
        token.sub = user.id
        token.role = user.role
        return token
      }

      // Re-read on explicit session update, and whenever role is absent (which
      // happens for OAuth sign-ins, where `user` comes from the adapter).
      if (trigger === 'update' || !token.role) {
        if (!token.sub) return token
        const fresh = await db.user.findUnique({
          where: { id: token.sub },
          select: { role: true, status: true },
        })
        if (!fresh || fresh.status !== 'ACTIVE') {
          // Force re-authentication on the next request.
          return null
        }
        token.role = fresh.role
      }

      return token
    },

    session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      if (token.role) session.user.role = token.role
      return session
    },
  },

  events: {
    async createUser({ user }) {
      if (user.id) {
        await db.auditLog.create({
          data: {
            actorId: user.id,
            action: 'user.created',
            entityType: 'User',
            entityId: user.id,
            meta: { via: 'oauth' },
          },
        })
      }
    },
  },

  trustHost: true,
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
