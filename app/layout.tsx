import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'Roam Growth Engine',
  description: 'Business outreach platform for Roam Local',
  icons: {
    icon: '/roam-icon.jpg',
    apple: '/roam-icon.jpg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Sidebar />
        <main style={{ flex: 1, overflowY: 'auto', background: 'var(--paper)' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
