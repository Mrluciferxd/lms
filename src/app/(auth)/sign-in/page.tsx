import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { brand } from '@/lib/brand'
import { getCurrentUser } from '@/server/auth/rbac'
import { SignInForm } from './sign-in-form'

export const metadata: Metadata = { title: 'Sign in' }

const hasGoogle = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET)

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  // Already signed in — no reason to show the form again.
  if (await getCurrentUser()) redirect('/app')

  const { next } = await searchParams

  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold text-content">Sign in to {brand.name}</h1>
        <p className="text-sm text-content-muted">
          Enter the email address your enrollment was created with.
        </p>
      </div>

      <SignInForm next={next} />

      {hasGoogle && (
        <form action="/api/auth/signin/google" method="post" className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-surface-border" />
            <span className="text-xs uppercase tracking-wide text-content-muted">or</span>
            <span className="h-px flex-1 bg-surface-border" />
          </div>
          <button
            type="submit"
            className="w-full rounded-brand border border-surface-border px-4 py-2.5 text-sm font-medium text-content transition-colors hover:bg-surface-muted"
          >
            Continue with Google
          </button>
        </form>
      )}

      <p className="text-center text-xs text-content-muted">
        Trouble signing in? Contact{' '}
        <a className="text-primary underline" href={`mailto:${brand.supportEmail}`}>
          {brand.supportEmail}
        </a>
      </p>
    </div>
  )
}
