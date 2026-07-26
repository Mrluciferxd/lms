import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getCurrentUser } from '@/server/auth/rbac'
import { recordProgress } from '@/server/catalog/progress'

export const dynamic = 'force-dynamic'

const schema = z.object({
  lessonId: z.string().min(1),
  positionSec: z.number().int().min(0).max(24 * 60 * 60),
  completed: z.boolean(),
})

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid progress payload.' }, { status: 400 })
  }

  const result = await recordProgress({
    userId: user.id,
    lessonId: parsed.data.lessonId,
    positionSec: parsed.data.positionSec,
    completed: parsed.data.completed,
  })

  if (!result.ok) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: result.status })
  }

  return NextResponse.json(
    { percentComplete: result.percentComplete },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
