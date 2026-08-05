/**
 * Shared gate for cron entrypoints.
 *
 * Every scheduled job route — notifications, widget refresh — is unauthenticated
 * by design (Vercel Cron and external schedulers cannot hold a session) and
 * mutates state, so each one must prove `CRON_SECRET` before doing work.
 * The two routes share the constant-time comparison and the refusal shape;
 * keeping them in one place stops the next cron from copying a weaker variant.
 */

import { timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function presentedSecret(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7)
  return request.headers.get('x-cron-secret')
}

/**
 * Returns a `NextResponse` (503 / 401) when the request is not authorized to
 * run a cron job, or `null` when it may proceed. Constant-time comparison: the
 * secret is long-lived and the endpoint is unauthenticated by design, so a
 * timing oracle is worth closing even though the window is narrow.
 */
export function authorizeCron(request: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET

  if (!expected) {
    // Refusing is the only safe answer. An unset secret must not degrade into an
    // open endpoint that anyone can use to drain the queue or spam a cohort.
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on this deployment.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const presented = presentedSecret(request)
  if (!presented || !secretMatches(presented, expected)) {
    return NextResponse.json(
      { error: 'Not authorized.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return null
}
