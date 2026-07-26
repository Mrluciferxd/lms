/**
 * Environment validation.
 *
 * Two goals. First, fail at boot with a named error rather than at the first
 * student's checkout — a missing Razorpay secret should not surface as a 500 in
 * production. Second, drive the admin setup checklist: because a brand config
 * declares which integrations it uses, we can say exactly which variables that
 * particular deployment still needs, which is most of the value during the
 * per-client onboarding in docs/04-white-label.md.
 */

import { z } from 'zod'

import type { BrandConfig } from '@/lib/brand/types'

/** Set in CI builds that have no secrets. Never set this at runtime. */
const SKIP_VALIDATION = process.env.SKIP_ENV_VALIDATION === 'true'

const isProduction = process.env.NODE_ENV === 'production'

// -----------------------------------------------------------------------------
// Client — must be referenced literally so Next can inline them at build time.
// -----------------------------------------------------------------------------

const clientSchema = z.object({
  NEXT_PUBLIC_BRAND: z.string().min(1, 'NEXT_PUBLIC_BRAND is required'),
  NEXT_PUBLIC_APP_URL: z.string().url('NEXT_PUBLIC_APP_URL must be an absolute URL'),
})

const rawClientEnv = {
  NEXT_PUBLIC_BRAND: process.env.NEXT_PUBLIC_BRAND,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
}

// -----------------------------------------------------------------------------
// Server
// -----------------------------------------------------------------------------

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection string'),
  /** Session-mode connection for Migrate when DATABASE_URL is pooled. */
  DIRECT_URL: z.string().url().optional(),

  AUTH_SECRET: z
    .string()
    .min(16, 'AUTH_SECRET must be at least 16 characters — generate with `openssl rand -base64 32`'),
  AUTH_URL: z.string().url().optional(),

  /** Shared secret for /api/cron/* endpoints. */
  CRON_SECRET: z.string().min(16).optional(),
})

/**
 * Integration credentials are validated separately: which ones are required
 * depends on the brand's `integrations` block, so they cannot be a flat required
 * set in the schema above.
 */
const INTEGRATION_ENV: Record<string, readonly string[]> = {
  'payments:razorpay': ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
  'payments:stripe': ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  'payments:manual': [],

  'video:bunny-stream': [
    'BUNNY_STREAM_LIBRARY_ID',
    'BUNNY_STREAM_API_KEY',
    'BUNNY_STREAM_TOKEN_AUTH_KEY',
    'BUNNY_STREAM_CDN_HOSTNAME',
  ],
  'video:mux': ['MUX_TOKEN_ID', 'MUX_TOKEN_SECRET', 'MUX_SIGNING_KEY_ID', 'MUX_SIGNING_KEY_PRIVATE'],
  'video:cloudflare-stream': ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_STREAM_TOKEN'],
  'video:s3': [],

  'storage:s3': ['S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
  'storage:r2': ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
  'storage:supabase': ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],

  'email:resend': ['RESEND_API_KEY', 'EMAIL_FROM'],
  'email:ses': ['AWS_SES_REGION', 'EMAIL_FROM'],
  'email:smtp': ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM'],

  'sms:msg91': ['MSG91_AUTH_KEY', 'MSG91_SENDER_ID'],
  'sms:twilio': ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],

  'whatsapp:meta-cloud': ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'],
  'whatsapp:gupshup': ['GUPSHUP_API_KEY', 'GUPSHUP_SOURCE_NUMBER'],

  'push:webpush': ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY'],
  'push:fcm': ['FCM_SERVICE_ACCOUNT_JSON'],
}

export interface IntegrationRequirement {
  /** e.g. "payments:razorpay" */
  integration: string
  missing: string[]
}

/**
 * Which declared integrations are missing credentials.
 *
 * Pack data feeds are deliberately excluded — those degrade to a setup notice by
 * design (see the economic calendar adapter), because the client owns those
 * subscriptions and a lapsed one must not present as our outage.
 */
export function checkIntegrationEnv(brand: BrandConfig): IntegrationRequirement[] {
  const declared: Array<[string, string | null | undefined]> = [
    ['payments', brand.integrations.payments],
    ['video', brand.integrations.video],
    ['storage', brand.integrations.storage],
    ['email', brand.integrations.email],
    ['sms', brand.integrations.sms],
    ['whatsapp', brand.integrations.whatsapp],
    ['push', brand.integrations.push],
  ]

  const requirements: IntegrationRequirement[] = []

  for (const [kind, provider] of declared) {
    if (!provider) continue
    const key = `${kind}:${provider}`
    const required = INTEGRATION_ENV[key]
    if (!required) {
      requirements.push({ integration: key, missing: ['(unknown provider — no env mapping)'] })
      continue
    }
    const missing = required.filter((name) => !process.env[name])
    if (missing.length > 0) {
      requirements.push({ integration: key, missing })
    }
  }

  return requirements
}

/**
 * Called from instrumentation at server start. Throws in production so a
 * misconfigured deployment refuses to serve rather than failing per-request;
 * warns in development so local work does not require every provider.
 */
export function assertIntegrationEnv(brand: BrandConfig): void {
  const requirements = checkIntegrationEnv(brand)
  if (requirements.length === 0) return

  const detail = requirements
    .map((r) => `  ${r.integration}: missing ${r.missing.join(', ')}`)
    .join('\n')

  const message =
    `Brand "${brand.key}" declares integrations without credentials:\n${detail}\n` +
    `See .env.example and docs/04-white-label.md.`

  if (isProduction) throw new Error(message)
  console.warn(`[env] ${message}`)
}

// -----------------------------------------------------------------------------
// Parse
// -----------------------------------------------------------------------------

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n')
}

function parseEnv() {
  if (SKIP_VALIDATION) {
    return {
      ...rawClientEnv,
      ...process.env,
    } as z.infer<typeof clientSchema> & z.infer<typeof serverSchema>
  }

  const client = clientSchema.safeParse(rawClientEnv)
  if (!client.success) {
    throw new Error(`Invalid public environment variables:\n${formatIssues(client.error)}`)
  }

  // On the client only NEXT_PUBLIC_* exists; skip the server half rather than
  // reporting every server variable as missing in the browser bundle.
  if (typeof window !== 'undefined') {
    return client.data as z.infer<typeof clientSchema> & z.infer<typeof serverSchema>
  }

  const server = serverSchema.safeParse(process.env)
  if (!server.success) {
    throw new Error(`Invalid server environment variables:\n${formatIssues(server.error)}`)
  }

  return { ...client.data, ...server.data }
}

export const env = parseEnv()
