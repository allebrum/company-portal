import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import { AuthGate } from '@/components/shell/AuthGate';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hoppa',
  description: 'Hoppa — the calm workspace for client work.',
  // Files live in apps/web/public, so the static export copies them to the
  // site root and every route (including nested, trailing-slash ones) links
  // the same absolute URLs. Browsers pick the SVG where supported and fall
  // back to the PNG/ICO sizes; the 16/32px renders use a heavier mark so it
  // stays legible in a tab.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  manifest: '/site.webmanifest',
  appleWebApp: { title: 'Hoppa' },
};

export const viewport: Viewport = {
  themeColor: '#9333ea',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AuthGate>{children}</AuthGate>
        </Providers>
      </body>
    </html>
  );
}
