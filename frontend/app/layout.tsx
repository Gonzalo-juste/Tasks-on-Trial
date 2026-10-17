import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { DM_Sans, Playfair_Display } from 'next/font/google'
import './globals.css'
import './trial-experience.css'
import './professional-template.css'

const courtSerif = Playfair_Display({ subsets: ['latin'], variable: '--font-court-serif', display: 'swap' })
const courtSans = DM_Sans({ subsets: ['latin'], variable: '--font-court-sans', display: 'swap' })

export const metadata: Metadata = {
  title: 'Tasks on Trial — Your tasks must earn their place',
  description: 'A thoughtful daily planner where every task makes its case. Recover your time, then follow a practical court-ordered plan.',
  applicationName: 'Tasks on Trial',
  generator: 'Next.js',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#172c3a',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${courtSerif.variable} ${courtSans.variable} antialiased`}>
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
