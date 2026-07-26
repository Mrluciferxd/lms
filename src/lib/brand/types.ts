/**
 * White-label brand configuration.
 *
 * Deployment model: one deployment per client. `BRAND` selects which config in
 * brands/ is active; everything client-specific lives there and nothing
 * client-specific lives in src/.
 *
 * These values are the build-time source of truth. At seed time they are
 * mirrored into OrgSettings so admins can adjust the safe subset (name, colors,
 * logos, support contacts, feature flags) without a redeploy. Where the two
 * disagree at runtime, OrgSettings wins for those mirrored fields; everything
 * else — packs, integrations, security posture — stays build-time only.
 */

export interface BrandTheme {
  primary: string
  accent?: string
  /** Maps to the Tailwind radius scale. */
  radius?: 'none' | 'sm' | 'md' | 'lg' | 'xl'
  font?: {
    sans?: string
    display?: string
  }
  /** Offer a dark-mode toggle. */
  darkMode?: boolean
}

/**
 * Feature switches. Everything defaults on except assessment/certificate
 * features, which are phase 2. Turning one off removes its navigation, routes
 * and scheduled jobs — it is not merely hidden.
 */
export interface BrandFeatures {
  liveSessions: boolean
  attendance: boolean
  assignments: boolean
  resources: boolean
  chat: boolean
  calendar: boolean
  journals: boolean
  trackers: boolean
  dataWidgets: boolean
  feeInstallments: boolean
  leadCapture: boolean
  quizzes: boolean
  certificates: boolean
  /** Public course catalog vs invite-only academy. */
  publicCatalog: boolean
  selfServeCheckout: boolean
}

export interface BrandIntegrations {
  payments: 'razorpay' | 'stripe' | 'manual'
  video: 'mux' | 'cloudflare-stream' | 'bunny-stream' | 's3'
  storage: 's3' | 'r2' | 'supabase'
  email: 'resend' | 'ses' | 'smtp'
  sms?: 'msg91' | 'twilio' | null
  whatsapp?: 'meta-cloud' | 'gupshup' | null
  push?: 'webpush' | 'fcm' | null
}

/**
 * Video protection posture.
 *
 * Note on scope: there is no browser API that prevents OS-level screen
 * capture, and any vendor claiming otherwise is describing something else.
 * What these settings actually buy you is (a) DRM, which blocks capture
 * outright on Safari/Edge and forces attackers off the easy path everywhere
 * else, (b) forensic watermarking, so a leaked file identifies the account it
 * came from, and (c) concurrency and TTL limits that make credential sharing
 * impractical. See docs/06-video-security.md.
 */
export interface BrandVideoSecurity {
  /** Widevine / FairPlay / PlayReady via the configured video provider. */
  drm: boolean
  /** Burn viewer identity into the played stream. */
  forensicWatermark: boolean
  /** Template for the burned-in overlay. */
  watermarkTemplate: string
  /** Simultaneous streams per account. 0 = unlimited. */
  maxConcurrentStreams: number
  /** Lifetime of an issued playback token. Keep short. */
  signedUrlTtlSec: number
  /** Strip download affordances and refuse direct asset URLs for lectures. */
  blockDownloads: boolean
}

export interface BrandLandingPage {
  slug: string
  /** Course this page sells. */
  courseSlug: string
  headline: string
  subheadline?: string
}

export interface BrandMarketing {
  tagline: string
  description: string
  landingPages: BrandLandingPage[]
  social?: Partial<
    Record<'instagram' | 'youtube' | 'telegram' | 'x' | 'linkedin' | 'whatsapp', string>
  >
  /** Shown in the footer where regulators expect it (financial verticals). */
  riskDisclaimer?: string
}

export interface BrandLegal {
  termsUrl?: string
  privacyUrl?: string
  refundUrl?: string
  /** Registered entity address for invoices. */
  address?: string
  gstin?: string
}

export interface BrandConfig {
  key: string
  name: string
  legalName?: string
  domain: string
  supportEmail: string
  supportPhone?: string
  locale: string
  currency: string
  timezone: string
  logo: {
    light: string
    dark?: string
    favicon?: string
  }
  theme: BrandTheme
  /**
   * Vertical pack keys to enable, resolved against src/packs/registry.ts.
   * Readonly because a brand config is a build-time constant — nothing should
   * be enabling a pack at runtime.
   */
  packs: readonly string[]
  features: BrandFeatures
  integrations: BrandIntegrations
  videoSecurity: BrandVideoSecurity
  marketing: BrandMarketing
  legal?: BrandLegal
}

/** Everything a brand file must state explicitly; the rest has sane defaults. */
export type BrandInput = Omit<
  BrandConfig,
  'features' | 'videoSecurity' | 'locale' | 'currency' | 'timezone'
> & {
  locale?: string
  currency?: string
  timezone?: string
  features?: Partial<BrandFeatures>
  videoSecurity?: Partial<BrandVideoSecurity>
}

export const DEFAULT_FEATURES: BrandFeatures = {
  liveSessions: true,
  attendance: true,
  assignments: true,
  resources: true,
  chat: true,
  calendar: true,
  journals: true,
  trackers: true,
  dataWidgets: true,
  feeInstallments: true,
  leadCapture: true,
  quizzes: false,
  certificates: false,
  publicCatalog: true,
  selfServeCheckout: true,
}

export const DEFAULT_VIDEO_SECURITY: BrandVideoSecurity = {
  drm: true,
  forensicWatermark: true,
  watermarkTemplate: '{{name}} · {{email}}',
  maxConcurrentStreams: 1,
  signedUrlTtlSec: 300,
  blockDownloads: true,
}

/**
 * Declares a brand. Fills defaults so brand files stay short and only state
 * what actually differs from the platform baseline.
 */
export function defineBrand(input: BrandInput): BrandConfig {
  return {
    ...input,
    locale: input.locale ?? 'en-IN',
    currency: input.currency ?? 'INR',
    timezone: input.timezone ?? 'Asia/Kolkata',
    features: { ...DEFAULT_FEATURES, ...input.features },
    videoSecurity: { ...DEFAULT_VIDEO_SECURITY, ...input.videoSecurity },
  }
}
