import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Roam Growth Engine',
  description: 'Business outreach platform for Roam Local',
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

function Sidebar() {
  const navSections = [
    {
      label: 'Overview',
      items: [
        { icon: '◆', label: 'Dashboard', href: '/' },
        { icon: '✓', label: "Today's Queue", href: '/queue', badge: true },
      ],
    },
    {
      label: 'Businesses',
      items: [
        { icon: '🏪', label: 'Contact Manager', href: '/contacts' },
        { icon: '⚡', label: 'Find Businesses', href: '/find' },
        { icon: '✉', label: 'Email Sequences', href: '/sequences' },
      ],
    },
    {
      label: 'Content',
      items: [
        { icon: '↑', label: 'Social Posts', href: '/social' },
        { icon: '⚙', label: 'Channels', href: '/channels' },
      ],
    },
  ];

  return (
    <aside style={{
      width: 224,
      background: 'var(--maroon-900)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      height: '100vh',
      overflowY: 'auto',
    }}>
      {/* Logo */}
      <div style={{
        padding: '18px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        marginBottom: 12,
      }}>
        <div style={{
          width: 34, height: 34,
          background: 'var(--sun-500)',
          borderRadius: 'var(--r-sm)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, flexShrink: 0,
        }}>🦁</div>
        <div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 15, letterSpacing: '-0.3px' }}>roam</div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Growth Engine</div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ flex: 1, padding: '0 8px' }}>
        {navSections.map(section => (
          <div key={section.label} style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.3)', padding: '0 8px', marginBottom: 4, fontWeight: 500,
            }}>{section.label}</div>
            {section.items.map(item => (
              <a key={item.href} href={item.href} style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '7px 9px', borderRadius: 'var(--r-sm)',
                fontSize: 13, color: 'rgba(255,255,255,0.6)',
                textDecoration: 'none', marginBottom: 2,
                transition: 'all 0.15s',
              }}
              onMouseOver={e => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)';
                (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.9)';
              }}
              onMouseOut={e => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
                (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)';
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 5,
                  background: 'rgba(255,255,255,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, flexShrink: 0,
                }}>{item.icon}</div>
                <span style={{ flex: 1 }}>{item.label}</span>
              </a>
            ))}
          </div>
        ))}
      </div>

      {/* User footer */}
      <div style={{
        padding: '12px 14px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', gap: 9,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: 'var(--maroon-600)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
        }}>RL</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#fff', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Roam Local</div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>Admin · All towns</div>
        </div>
      </div>
    </aside>
  );
}
