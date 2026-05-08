'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, CheckSquare, Users, Search, Mail, ArrowUpCircle, Settings, Menu, X, Brain, ListTodo, BookUser, BookOpen, Database } from 'lucide-react';
import NotificationCentre from './NotificationCentre';

const navSections = [
  {
    label: 'Overview',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', href: '/' },
      { icon: Brain, label: 'Roam-io Assistant', href: '/hub' },
      { icon: ListTodo, label: 'Tasks', href: '/tasks' },
      { icon: CheckSquare, label: "Today's Queue", href: '/queue' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { icon: Database, label: 'Roam-io Brain', href: '/brain' },
    ],
  },
  {
    label: 'Businesses',
    items: [
      { icon: Users, label: 'Contact Manager', href: '/contacts' },
      { icon: Search, label: 'Find Businesses', href: '/find' },
      { icon: Mail, label: 'Email Sequences', href: '/sequences' },
    ],
  },
  {
    label: 'Content',
    items: [
      { icon: ArrowUpCircle, label: 'Social Calendar', href: '/social' },
      { icon: BookOpen, label: 'Briefs', href: '/briefs' },
      { icon: BookUser, label: 'Social Accounts', href: '/accounts' },
      { icon: Settings, label: 'Channels', href: '/channels' },
    ],
  },
];

function Sidebar({ onClose, isOpen }: { onClose?: () => void; isOpen?: boolean }) {
  const pathname = usePathname();
  return (
    <aside className={`app-sidebar${isOpen ? ' open' : ''}`}>
      {/* Logo */}
      <div className="sidebar-logo" style={{
        padding: '16px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 12, flexShrink: 0,
      }}>
        <div style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', overflow: 'hidden', flexShrink: 0, background: 'var(--white)' }}>
          <img src="/logo-lionFav-icon.png" width={34} height={34} alt="Roam" style={{ objectFit: 'cover', display: 'block' }}/>
        </div>
        <div className="sidebar-logo-text" style={{ flex: 1 }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 15, letterSpacing: '-0.3px' }}>roam</div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Growth Engine</div>
        </div>
        <NotificationCentre />
        {/* Close button on mobile */}
        {onClose && (
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 'var(--r-sm)', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', flexShrink: 0 }}>
            <X size={16}/>
          </button>
        )}
      </div>

      {/* Nav */}
      <div style={{ flex: 1, padding: '0 8px', overflowY: 'auto' }}>
        {navSections.map(section => (
          <div key={section.label} style={{ marginBottom: 20 }}>
            <div className="sidebar-section-label" style={{
              fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.3)', padding: '0 8px', marginBottom: 4, fontWeight: 500,
            }}>{section.label}</div>
            {section.items.map(item => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} onClick={onClose} className="sidebar-nav-item" style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '7px 9px', borderRadius: 'var(--r-sm)',
                  fontSize: 13, textDecoration: 'none', marginBottom: 2,
                  background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: active ? '#fff' : 'rgba(255,255,255,0.6)',
                  transition: 'all 0.15s',
                }}>
                  <div className="sidebar-nav-icon" style={{
                    width: 22, height: 22, borderRadius: 5,
                    background: active ? '#d03050' : 'rgba(255,255,255,0.08)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <Icon size={13}/>
                  </div>
                  <span className="sidebar-label" style={{ flex: 1 }}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* User footer */}
      <div className="sidebar-user" style={{
        padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%', background: '#9b2752',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
        }}>RL</div>
        <div className="sidebar-user-info" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>Roam Local</div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>Admin · All towns</div>
        </div>
      </div>
    </aside>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isLogin = pathname === '/login';

  // Close sidebar on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Prevent body scroll when sidebar open on mobile
  useEffect(() => {
    if (mobileOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  if (isLogin) return <>{children}</>;

  // Current page title for mobile header
  const currentItem = navSections.flatMap(s => s.items).find(i => i.href === pathname);

  return (
    <div className="app-layout">
      {/* Mobile overlay */}
      <div className={`sidebar-overlay${mobileOpen ? ' open' : ''}`} onClick={() => setMobileOpen(false)} style={{WebkitBackdropFilter:'none',backdropFilter:'none',willChange:'opacity'}}/>

      {/* Sidebar */}
      <Sidebar onClose={() => setMobileOpen(false)} isOpen={mobileOpen}/>

      {/* Main */}
      <main className="app-main" style={{}}>
        {/* Mobile top bar */}
        <div className="mobile-header">
          <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)}>
            <Menu size={18}/>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, overflow: 'hidden', background: 'var(--white)' }}>
              <img src="/logo-lionFav-icon.png" width={24} height={24} alt="Roam" style={{ objectFit: 'cover', display: 'block' }}/>
            </div>
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>
              {currentItem?.label || 'Roam'}
            </span>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
