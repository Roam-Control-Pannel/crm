import type { Metadata } from 'next';
import './globals.css';
import LayoutShell from '@/components/LayoutShell';
import SessionWrapper from '@/components/SessionWrapper';

export const metadata: Metadata = {
  title: 'Roam Growth Engine',
  description: 'Business outreach platform for Roam Local',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionWrapper>
          <LayoutShell>{children}</LayoutShell>
        </SessionWrapper>
      </body>
    </html>
  );
}
