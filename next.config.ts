import type { NextConfig } from 'next'

/**
 * A CSP is deliberately absent here. It needs per-request nonces to coexist with
 * Next's inline scripts and with the video provider's player, so it belongs in
 * middleware — scheduled with the rest of the hardening pass. The headers below
 * are the ones that are safe to set statically and worth having from day one.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    // No feature in the LMS needs these, and denying them shrinks the surface.
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  typescript: {
    // Type errors must fail the build. CI runs typecheck separately too.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },

  images: {
    remotePatterns: [
      // Video thumbnails from the configured provider.
      { protocol: 'https', hostname: '*.b-cdn.net' },
      { protocol: 'https', hostname: 'image.mux.com' },
    ],
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
