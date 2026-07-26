'use server'

import { AuthError } from 'next-auth'
import { z } from 'zod'

import { signIn } from '@/server/auth/config'

export interface SignInState {
  error?: string
  fieldErrors?: { email?: string; password?: string }
}

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  next: z.string().optional(),
})

/**
 * Only relative, single-slash paths are accepted as a post-sign-in destination.
 * Without this an attacker can hand a student a link that authenticates them and
 * then bounces them to a lookalike domain — the classic open-redirect phish.
 */
function safeRedirect(next: string | undefined): string {
  if (!next) return '/app'
  if (!next.startsWith('/') || next.startsWith('//')) return '/app'
  return next
}

export async function signInWithCredentials(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  })

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors
    return {
      fieldErrors: {
        email: flattened.email?.[0],
        password: flattened.password?.[0],
      },
    }
  }

  try {
    await signIn('credentials', {
      email: parsed.data.email.toLowerCase(),
      password: parsed.data.password,
      redirectTo: safeRedirect(parsed.data.next),
    })
  } catch (error) {
    // AuthError means the credentials failed. Everything else — notably the
    // NEXT_REDIRECT that a successful signIn throws — must propagate untouched.
    if (error instanceof AuthError) {
      // Deliberately identical for unknown email, wrong password and suspended
      // account: distinguishing them would confirm which emails are enrolled.
      return { error: 'Those details did not match an active account.' }
    }
    throw error
  }

  return {}
}
