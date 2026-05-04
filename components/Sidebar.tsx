'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, CheckSquare, Users, Search,
  Mail, ArrowUp, Settings, Bell, X
} from 'lucide-react';
import NotificationCentre from './NotificationCentre';

const navSections = [
  {
    label: 'Overview',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', href: '/' },
      { icon: CheckSquare, label: "Today's Queue", href: '/queue' },
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
      { icon: ArrowUp, label: 'Social Posts', href: '/social' },
      { icon: Settings, label: 'Channels', href: '/channels' },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside style={{
      width: 224, background: 'var(--maroon-900)',
      display: 'flex', flexDirection: 'column',
      flexShrink: 0, height: '100vh', overflowY: 'auto',
    }}>
      {/* Logo + bell */}
      <div style={{
        padding: '16px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 12,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 'var(--r-sm)',
          overflow: 'hidden', flexShrink: 0, background: 'var(--white)',
        }}>
          <img src="/Roam-BD-CRMfav-icon.jpg" width={34} height={34} alt="Roam" style={{objectFit:'cover',display:'block'}}/>
        </div>
        <div style={{flex:1}}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 15, letterSpacing: '-0.3px' }}>roam</div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Growth Engine</div>
        </div>
        <NotificationCentre />
      </div>

      {/* Nav */}
      <div style={{ flex: 1, padding: '0 8px' }}>
        {navSections.map(section => (
          <div key={section.label} style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.3)', padding: '0 8px', marginBottom: 4, fontWeight: 500,
            }}>{section.label}</div>
            {section.items.map(item => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '7px 9px', borderRadius: 'var(--r-sm)',
                  fontSize: 13, textDecoration: 'none', marginBottom: 2,
                  background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: active ? '#fff' : 'rgba(255,255,255,0.6)',
                  transition: 'all 0.15s',
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 5,
                    background: active ? 'var(--maroon-500)' : 'rgba(255,255,255,0.08)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={13} />
                  </div>
                  <span style={{ flex: 1 }}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* User footer */}
      <div style={{
        padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', gap: 9,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: 'var(--maroon-600)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
        }}>RL</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>Roam Local</div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>Admin · All towns</div>
        </div>
      </div>
    </aside>
  );
}
