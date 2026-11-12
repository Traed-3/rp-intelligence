import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { PWARegister } from '@/components/pwa-register'
import { themeScript } from '@/components/ui/theme-toggle'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

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
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* Sets light/dark before first paint so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <PWARegister />
        {children}
      </body>
    </html>
  )
}
