/**
 * Nirlep Forex — first white-label deployment.
 *
 * PLACEHOLDERS: values marked `TODO(client)` are waiting on the "Asset Assembly"
 * step in the proposal (brand guidelines, curriculum structure, credentials).
 * They are safe defaults, not final copy.
 */

import { defineBrand } from '@/lib/brand/types'

export default defineBrand({
  key: 'nirlep-forex',
  name: 'Nirlep Forex',
  legalName: undefined, // TODO(client): registered entity name for invoices
  domain: 'nirlepforex.com', // TODO(client): confirm production domain
  supportEmail: 'support@nirlepforex.com', // TODO(client)
  supportPhone: undefined, // TODO(client)

  locale: 'en-IN',
  currency: 'INR',
  timezone: 'Asia/Kolkata',

  logo: {
    light: '/brands/nirlep-forex/logo-light.svg', // TODO(client): supply assets
    dark: '/brands/nirlep-forex/logo-dark.svg',
    favicon: '/brands/nirlep-forex/favicon.png',
  },

  theme: {
    // Sampled from the proposal document's accent colour.
    primary: '#00ADEF',
    accent: '#0B1F33',
    radius: 'md',
    darkMode: true,
  },

  packs: ['forex'],

  features: {
    // Phase 2 per the roadmap — schema exists, UI is not in the 1-month scope.
    quizzes: false,
    certificates: false,
  },

  integrations: {
    // Named in the proposal.
    payments: 'razorpay',
    // Chosen for native DRM + per-viewer watermarking at India-friendly egress cost.
    video: 'bunny-stream',
    storage: 's3',
    email: 'resend',
    // WhatsApp carries fee and class reminders far better than email in this market.
    whatsapp: 'meta-cloud',
    sms: 'msg91',
    push: 'webpush',
  },

  videoSecurity: {
    drm: true,
    forensicWatermark: true,
    // Identifies the account behind any leaked recording.
    watermarkTemplate: '{{name}} · {{email}} · {{ip}}',
    maxConcurrentStreams: 1,
    signedUrlTtlSec: 180,
    blockDownloads: true,
  },

  marketing: {
    tagline: 'Trade with structure, not guesswork.', // TODO(client): approve copy
    description:
      'Structured forex education with live market sessions, mentor-reviewed trade journalling and batch-paced curriculum.',
    // Two landing pages, per section 2.1 of the proposal.
    landingPages: [
      {
        slug: 'foundation-program',
        courseSlug: 'foundation-program', // TODO(client): confirm programme names
        headline: 'Build your trading foundation',
        subheadline: 'Eight weeks of structured curriculum, live sessions and journalled practice.',
      },
      {
        slug: 'advanced-program',
        courseSlug: 'advanced-program', // TODO(client)
        headline: 'Trade funded capital with confidence',
        subheadline: 'Advanced risk management, mentor review and prop-firm challenge preparation.',
      },
    ],
    social: {}, // TODO(client)
    // Financial-education deployments should not ship without this.
    riskDisclaimer:
      'Trading foreign exchange carries a high level of risk and may not be suitable for all investors. ' +
      'Past performance is not indicative of future results. Nothing on this platform constitutes ' +
      'investment advice or a recommendation to trade. Educational content only.',
  },

  legal: {
    // TODO(client): supply final policy URLs and GSTIN before go-live.
    termsUrl: '/legal/terms',
    privacyUrl: '/legal/privacy',
    refundUrl: '/legal/refunds',
  },
})
