import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'

import { brand } from '@/lib/brand'
import { brandCssText } from '@/lib/brand/theme'

import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

/**
 * Metadata comes from the active brand, so a per-client build carries that
 * client's identity with no per-brand code.
 */
export const metadata: Metadata = {
  title: {
    default: `${brand.name} — ${brand.marketing.tagline}`,
    template: `%s · ${brand.name}`,
  },
  description: brand.marketing.description,
  applicationName: brand.name,
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? `https://${brand.domain}`),
  icons: brand.logo.favicon ? { icon: brand.logo.favicon } : undefined,
  openGraph: {
    type: 'website',
    siteName: brand.name,
    title: brand.name,
    description: brand.marketing.description,
    locale: brand.locale.replace('-', '_'),
  },
  robots: {
    // Staging deployments must not be indexed.
    index: process.env.NODE_ENV === 'production',
    follow: process.env.NODE_ENV === 'production',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang={brand.locale} data-theme="light" suppressHydrationWarning>
      <head>
        {/*
          Brand colours as CSS variables. A <style> tag rather than an inline
          style attribute on <html>: the value is a build-time constant, so this
          is stable across server and client and cannot hydration-mismatch.
        */}
        <style
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: brandCssText(brand) }}
        />
      </head>
      <body className={`${inter.variable} font-sans`}>{children}</body>
    </html>
  )
}
