import type { Metadata, Viewport } from 'next'
import { Barlow_Condensed, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import { PWARegister } from '@/components/pwa-register'
import { themeScript } from '@/components/ui/theme-toggle'

// The Action Board's type: condensed caps for headings, Plex for reading, Plex Mono for site numbers and counts.
const displayFont = Barlow_Condensed({ variable: '--font-barlow', subsets: ['latin'], weight: ['600', '700'] })
const bodyFont = IBM_Plex_Sans({ variable: '--font-plex-sans', subsets: ['latin'], weight: ['400', '500', '600', '700'] })
const monoFont = IBM_Plex_Mono({ variable: '--font-plex-mono', subsets: ['latin'], weight: ['400', '500', '600'] })

export const metadata: Metadata = {
  title: 'RP Intelligence',
  description: 'RP Intelligence — Rappahannock Petroleum operations platform',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'RP Intel',
  },
  formatDetection: { telephone: false },
  icons: {
    apple: '/apple-touch-icon-v2.png',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111827' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* Sets light/dark before first paint so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <PWARegister />
        {children}
      </body>
    </html>
  )
}
