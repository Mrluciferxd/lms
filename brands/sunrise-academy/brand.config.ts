/**
 * Sunrise Academy — reference deployment for the coaching vertical.
 *
 * Not a real client. It exists so the coaching pack has a brand to run under, and
 * so the resale story is demonstrable rather than hypothetical: this file plus a
 * deployment is the entire cost of a client in a new industry.
 *
 * Note how little differs from nirlep-forex — a different pack, a different
 * colour, no risk disclaimer, WhatsApp instead of SMS. No code.
 */

import { defineBrand } from '@/lib/brand/types'

export default defineBrand({
  key: 'sunrise-academy',
  name: 'Sunrise Academy',
  legalName: 'Sunrise Academy Educational Services',
  domain: 'sunriseacademy.example',
  supportEmail: 'help@sunriseacademy.example',

  locale: 'en-IN',
  currency: 'INR',
  timezone: 'Asia/Kolkata',

  logo: {
    light: '/brands/sunrise-academy/logo-light.svg',
  },

  theme: {
    primary: '#E8590C',
    accent: '#1F2933',
    radius: 'lg',
    darkMode: true,
  },

  packs: ['coaching'],

  features: {
    // Coaching institutes live on assessments and certificates, unlike the
    // trading academy where these are out of initial scope.
    quizzes: true,
    certificates: true,
    // Trade/practice journalling is replaced by the mock-test log, still a journal.
    journals: true,
    // Fee installments matter even more here — annual coaching fees are staged.
    feeInstallments: true,
  },

  integrations: {
    payments: 'razorpay',
    video: 'bunny-stream',
    storage: 's3',
    email: 'resend',
    whatsapp: 'meta-cloud',
    push: 'webpush',
  },

  videoSecurity: {
    drm: true,
    forensicWatermark: true,
    watermarkTemplate: '{{name}} · {{email}}',
    // Students often study across a phone and a laptop, so allow two.
    maxConcurrentStreams: 2,
    signedUrlTtlSec: 300,
    blockDownloads: true,
  },

  marketing: {
    tagline: 'Structured preparation, measurable progress.',
    description:
      'Batch-based exam preparation with live classes, mock test analytics, syllabus tracking and mentor-led doubt sessions.',
    landingPages: [
      {
        slug: 'foundation-batch',
        courseSlug: 'foundation-batch',
        headline: 'Build your foundation early',
        subheadline: 'Two-year structured programme with weekly tests and doubt support.',
      },
      {
        slug: 'target-batch',
        courseSlug: 'target-batch',
        headline: 'One year to your target rank',
        subheadline: 'Intensive coverage, full-syllabus mocks and personalised analytics.',
      },
    ],
  },

  legal: {
    termsUrl: '/legal/terms',
    privacyUrl: '/legal/privacy',
    refundUrl: '/legal/refunds',
  },
})
