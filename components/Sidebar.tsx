'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type NavItem = { label: string; icon: string; href: string; badgeKey?: 'queue' };
type NavGroup = { section: string; items: NavItem[] };

const nav: NavGroup[] = [
  { section: 'Overview', items: [
    { label: 'Dashboard', icon: '◈', href: '/' },
    { label: "Today's Queue", icon: '✓', href: '/queue', badgeKey: 'queue' },
  ]},
  { section: 'Businesses', items: [
    { label: 'Contact Manager', icon: '🏪', href: '/contacts' },
    { label: 'Find Businesses', icon: '⚡', href: '/find' },
    { label: 'Email Sequences', icon: '✉', href: '/sequences' },
  ]},
  { section: 'Content', items: [
    { label: 'Social Posts', icon: '↑', href: '/social' },
  ]},
  { section: 'Settings', items: [
    { label: 'Channels', icon: '⚙', href: '/channels' },
  ]},
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [queueCount, setQueueCount] = useState<number | null>(null);

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d && typeof d.followUpsDue === 'number') setQueueCount(d.followUpsDue); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pathname]);

  const badgeFor = (key?: 'queue') => key === 'queue' ? queueCount : null;

  return (
    <>
      <button
        type="button"
        aria-label="Toggle navigation menu"
        aria-expanded={open}
        className="mobile-menu-btn"
        onClick={() => setOpen(o => !o)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {open
            ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
            : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>
          }
        </svg>
      </button>
      <div className={`sidebar-backdrop${open ? ' open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className={`app-sidebar${open ? ' open' : ''}`} style={{ width: 240, background: '#1a0d12', position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 200, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -60, left: -60, width: 220, height: 220, background: 'radial-gradient(circle, rgba(139,26,58,0.3) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ padding: '20px 18px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg, #6B1230, #8B1A3A)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, boxShadow: '0 2px 8px rgba(139,26,58,0.4)', flexShrink: 0 }}>🦁</div>
            <div>
              <div style={{ fontFamily: 'Nunito, sans-serif', fontWeight: 900, fontSize: 19, color: '#fff', letterSpacing: -0.5 }}>roam</div>
              <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginTop: 1 }}>Growth Engine</div>
            </div>
          </div>
        </div>
        <nav style={{ padding: '14px 0', flex: 1, overflowY: 'auto' }}>
          {nav.map(group => (
            <div key={group.section}>
              <div style={{ padding: '10px 18px 4px', fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)' }}>
                {group.section}
              </div>
              {group.items.map(item => {
                const active = pathname === item.href;
                const badge = badgeFor(item.badgeKey);
                return (
                  <div
                    key={item.href}
                    onClick={() => router.push(item.href)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 18px', margin: '1px 8px', borderRadius: 8, fontSize: 13, fontWeight: 600, color: active ? '#f5c0cc' : 'rgba(255,255,255,0.48)', background: active ? 'rgba(139,26,58,0.12)' : 'transparent', border: active ? '1px solid rgba(139,26,58,0.28)' : '1px solid transparent', cursor: 'pointer', position: 'relative' }}
                  >
                    {active && (
                      <div style={{ position: 'absolute', left: -8, top: '50%', transform: 'translateY(-50%)', width: 3, height: '60%', background: '#C44060', borderRadius: '0 2px 2px 0' }} />
                    )}
                    <span style={{ width: 16, textAlign: 'center', fontSize: 14 }}>{item.icon}</span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {badge !== null && badge > 0 && (
                      <span style={{ background: '#8B1A3A', color: '#fff', fontSize: 9.5, fontWeight: 800, padding: '1px 7px', borderRadius: 20 }}>{badge}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
        <div style={{ padding: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #8B1A3A, #C44060)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff' }}>RL</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Roam Local</div>
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.28)' }}>Admin · All towns</div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
