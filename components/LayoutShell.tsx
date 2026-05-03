'use client';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === '/login';
  if (isAuthPage) {
    return <main style={{ minHeight: '100vh' }}>{children}</main>;
  }
  return (
    <>
      <Sidebar />
      <main className="app-main">{children}</main>
    </>
  );
}
