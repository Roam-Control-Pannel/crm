import type { Metadata } from 'next';
import './globals.css';
import LayoutShell from '@/components/LayoutShell';
import SessionWrapper from '@/components/SessionWrapper';

export const metadata: Metadata = {
  title: 'Roam Growth Engine',
  description: 'Business outreach platform for Roam Local',
  icons: {
    icon: '/Roam-BD-CRMfav-icon.jpg',
    apple: '/Roam-BD-CRMfav-icon.jpg',
  },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ display: 'flex', height: '100vh', overflow: 'hidden', margin: 0 }}>
        <SessionWrapper>
          <LayoutShell>{children}</LayoutShell>
        </SessionWrapper>
      </body>
    </html>
  );
}
