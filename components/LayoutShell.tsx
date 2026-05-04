'use client';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/login') {
    return <main style={{ flex: 1, minHeight: '100vh', overflowY: 'auto' }}>{children}</main>;
  }
  return (
    <>
      <Sidebar />
      <main style={{ flex: 1, overflowY: 'auto', background: 'var(--paper)' }}>
        {children}
      </main>
    </>
  );
}
