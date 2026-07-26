'use server'

/**
 * Public lead capture.
 *
 * The only write path in this product that accepts input from someone with no
 * account, so it is defended differently from everything else. There is no
 * permission to check — an enquiry form behind authorization would have no
 * purpose — and that absence is deliberate rather than an omission. What stands
 * in for it:
 *
 *   feature flag       `leadCapture` off means the action refuses, not just that
 *                      the form is hidden.
 *   honeypot           a field no human sees; filled means a bot, and the reply
 *                      is a normal success so the bot has nothing to tune against.
 *   rate limit         per client, per window, in process (see ./rate-limit.ts).
 *   duplicate window   the same contact details twice in minutes writes one row,
 *                      which also covers a double-click and a retried POST.
 *
 * Campaign parameters are sanitized in ./attribution.ts and land only in
 * `Lead.utm`. `courseId` is resolved server-side from the declared source
 * against the brand's configured landing pages — never read from the client —
 * so a crafted POST cannot attach an enquiry to an arbitrary course.
 */

import { headers } from 'next/headers'
import { z } from 'zod'

import { brand } from '@/lib/brand'
import { recordAudit } from '@/server/audit'
import { db } from '@/server/db'
import { isFeatureEnabled } from '@/server/org/settings'
import {
  HONEYPOT_FIELD,
  landingSlugFromSource,
  resolveLeadSource,
  sanitizeAttribution,
  type RawParams,
} from './attribution'
import { checkRateLimit, clientKey } from './rate-limit'
import { findLandingPage, landingSlugs } from './content'

export interface LeadFormState {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

const RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 }
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000

const leadSchema = z
  .object({
    name: z.string().trim().min(2, 'Please enter your name').max(120),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(200)
      .email('Enter a valid email address')
      .optional(),
    // Deliberately permissive: international formats vary far more than any
    // regex worth maintaining, and a rejected real number costs a sale.
    phone: z
      .string()
      .trim()
      .min(6, 'Enter a valid phone number')
      .max(32)
      .regex(/^[+0-9][0-9 ()\-.]*$/, 'Enter a valid phone number')
      .optional(),
    message: z.string().trim().max(2000).optional(),
    consent: z.literal(true, {
      errorMap: () => ({ message: 'Please agree before submitting' }),
    }),
  })
  .refine((data) => data.email !== undefined || data.phone !== undefined, {
    path: ['email'],
    message: 'Enter an email address or a phone number so we can reply',
  })

function optional(value: FormDataEntryValue | null): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : undefined
}

function firstIssues(error: z.ZodError): Record<string, string> {
  const flattened = error.flatten().fieldErrors
  return Object.fromEntries(
    Object.entries(flattened)
      .filter(([, messages]) => messages && messages.length > 0)
      .map(([field, messages]) => [field, messages![0]!]),
  )
}

/**
 * Best-effort client IP, matching how the audit log derives it. Absence is not
 * an error — behind some proxies there is no usable header, and outside a
 * request scope (tests, scripts) `headers()` throws. Both fall back to the
 * shared "unknown" rate-limit bucket rather than failing the enquiry.
 */
async function clientIp(): Promise<string | null> {
  try {
    const headerList = await headers()
    const forwardedFor = headerList.get('x-forwarded-for')
    return forwardedFor?.split(',')[0]?.trim() ?? headerList.get('x-real-ip') ?? null
  } catch {
    return null
  }
}

export async function submitLead(
  _previous: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  if (!(await isFeatureEnabled('leadCapture'))) {
    return { error: 'Enquiries are not being accepted right now.' }
  }

  /**
   * Answered before validation and before any write. A bot that fills every
   * field gets the same response a person does, so there is no signal telling it
   * which field gave it away.
   */
  if (optional(formData.get(HONEYPOT_FIELD)) !== undefined) return { ok: true }

  const parsed = leadSchema.safeParse({
    name: optional(formData.get('name')),
    email: optional(formData.get('email')),
    phone: optional(formData.get('phone')),
    message: optional(formData.get('message')),
    consent: formData.get('consent') === 'on',
  })

  if (!parsed.success) {
    return { error: 'Please correct the highlighted fields.', fieldErrors: firstIssues(parsed.error) }
  }

  const rateLimit = checkRateLimit(clientKey('lead', await clientIp()), RATE_LIMIT)
  if (!rateLimit.allowed) {
    return {
      error: `Too many enquiries from this connection. Try again in ${Math.ceil(rateLimit.retryAfterSec / 60)} minute(s), or email ${brand.supportEmail}.`,
    }
  }

  const source = resolveLeadSource(formData.get('source'), landingSlugs())
  const landingSlug = landingSlugFromSource(source)

  // The course is derived from configuration, not from the request. A form field
  // naming a course would let anyone file enquiries against any row.
  let courseId: string | null = null
  const landing = landingSlug ? findLandingPage(landingSlug) : null
  if (landing) {
    const course = await db.course.findUnique({
      where: { slug: landing.courseSlug },
      select: { id: true, status: true },
    })
    courseId = course && course.status === 'PUBLISHED' ? course.id : null
  }

  const { email, phone, name, message } = parsed.data

  /**
   * Duplicate suppression. Survives restarts and multiple instances, which the
   * in-process rate limiter does not, and it is what makes an impatient
   * double-submit a no-op rather than two rows for the sales team to reconcile.
   */
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS)

  /**
   * Written as an explicit null rather than relying on the schema's "email or
   * phone" refinement: an undefined value in a Prisma `where` means "no filter",
   * so a contact-less lead would match every recent row and silently suppress
   * every enquiry for ten minutes.
   */
  const contact = email ? { email } : phone ? { phone } : null

  if (contact) {
    const recent = await db.lead.findFirst({
      where: { createdAt: { gte: since }, ...contact },
      select: { id: true },
    })
    if (recent) return { ok: true }
  }

  const lead = await db.lead.create({
    data: {
      name,
      email: email ?? null,
      phone: phone ?? null,
      message: message ?? null,
      courseId,
      source,
      // Opaque data, and only data. Nothing downstream interpolates this.
      utm: sanitizeAttribution(Object.fromEntries(formData) as RawParams),
    },
    select: { id: true },
  })

  await recordAudit({
    actorId: null,
    action: 'lead.captured',
    entityType: 'Lead',
    entityId: lead.id,
    meta: { source, courseId },
  })

  return { ok: true }
}
