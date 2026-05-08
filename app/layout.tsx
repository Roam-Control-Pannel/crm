import type { Metadata, Viewport } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';
import SessionWrapper from '@/components/SessionWrapper';

export const metadata: Metadata = {
  title: 'Roam Growth Engine',
  description: 'Business outreach platform for Roam Local',
  icons: { icon: '/logo-lionFav-icon.png', apple: '/logo-lionFav-icon.png' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionWrapper>
          <AppShell>{children}</AppShell>
        </SessionWrapper>
      </body>
    </html>
  );
}
