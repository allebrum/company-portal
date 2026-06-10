import type { Metadata } from 'next';
import { Providers } from './providers';
import { AuthGate } from '@/components/shell/AuthGate';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hoppa',
  description: 'Hoppa — the calm workspace for client work.',
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
