/**
 * Demo Academy — the neutral reference deployment.
 *
 * Exists to keep the core honest: zero packs enabled, generic vocabulary,
 * no industry assumptions. If a feature only makes sense with the forex pack
 * on, it is in the wrong place. Use this brand for demos to prospects in any
 * industry, and as the CI target so pack-coupling regressions get caught.
 */

import { defineBrand } from '@/lib/brand/types'

export default defineBrand({
  key: 'demo-academy',
  name: 'Demo Academy',
  domain: 'demo.localhost',
  supportEmail: 'support@demo.localhost',

  logo: {
    light: '/brands/demo-academy/logo-light.svg',
  },

  theme: {
    primary: '#2563eb',
    radius: 'md',
    darkMode: true,
  },

  // Deliberately empty. Core must be complete on its own.
  packs: [],

  features: {
    quizzes: true,
    certificates: true,
  },

  integrations: {
    payments: 'manual',
    video: 's3',
    storage: 's3',
    email: 'smtp',
  },

  videoSecurity: {
    // Demo data is not worth protecting; keeps local dev free of DRM setup.
    drm: false,
    forensicWatermark: false,
    maxConcurrentStreams: 0,
    blockDownloads: false,
  },

  marketing: {
    tagline: 'Teach anything, to any cohort.',
    description:
      'A generic cohort-based learning platform: courses, batches, drip content, attendance, assignments and community.',
    landingPages: [
      {
        slug: 'sample-program',
        courseSlug: 'sample-program',
        headline: 'A sample programme landing page',
      },
    ],
  },
})
