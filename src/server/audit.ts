/**
 * Audit logging.
 *
 * Records who did what to which entity. Worth having from week one rather than
 * retrofitted: the operations this platform performs — waiving a fee, changing a
 * role, revoking a device, deleting a submission — are exactly the ones a client
 * will later ask "who did this?" about, and that question is unanswerable
 * retroactively.
 *
 * Never throws. An audit write failing must not roll back the operation it
 * describes; a lost log line is better than a failed refund.
 */

import { headers } from 'next/headers'

import { db } from '@/server/db'

export interface AuditInput {
  actorId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  meta?: Record<string, unknown>
}

/** Best-effort client IP from the usual proxy headers. */
async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const headerList = await headers()
    const forwardedFor = headerList.get('x-forwarded-for')
    return {
      ip: forwardedFor?.split(',')[0]?.trim() ?? headerList.get('x-real-ip') ?? null,
      userAgent: headerList.get('user-agent'),
    }
  } catch {
    // Outside a request scope (scripts, jobs) there are no headers.
    return { ip: null, userAgent: null }
  }
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const { ip, userAgent } = await requestContext()
    await db.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        meta: (input.meta ?? {}) as never,
        ip,
        userAgent,
      },
    })
  } catch (error) {
    console.error('[audit] failed to record entry', input.action, error)
  }
}
