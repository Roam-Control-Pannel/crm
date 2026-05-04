'use client';
import { Mail, Instagram, Linkedin, Twitter, Settings, FileText, Zap } from 'lucide-react';

const channels = [
  {
    name: 'Brevo Email', handle: 'hello@roam-everywhere.com',
    Icon: Mail, status: 'live', health: 97, iconBg: 'var(--maroon-50)', iconColor: 'var(--maroon-600)',
    desc: 'Transactional outreach emails — 3-step sequence to roam-local.co.uk',
    stats: [
      { label: 'Sender', value: 'hello@roam-everywhere.com' },
      { label: 'Domain', value: 'roam-everywhere.com ✓' },
      { label: 'Links to', value: 'roam-local.co.uk' },
      { label: 'Sequence', value: 'Day 1 · Day 2 · Day 7' },
    ],
  },
  {
    name: 'Instagram', handle: '@roamlocal',
    Icon: Instagram, status: 'not_connected', health: 0, iconBg: '#fdf0e8', iconColor: '#c96442',
    desc: 'Post town discovery content and business spotlights', stats: [],
  },
  {
    name: 'LinkedIn', handle: 'Roam Local',
    Icon: Linkedin, status: 'not_connected', health: 0, iconBg: '#e8f0fb', iconColor: '#2a5fa4',
    desc: 'Reach local business owners and decision makers', stats: [],
  },
  {
    name: 'X / Twitter', handle: 'Not connected',
    Icon: Twitter, status: 'not_connected', health: 0, iconBg: 'var(--ink-100)', iconColor: 'var(--ink-700)',
    desc: 'Town announcements and discovery content', stats: [],
  },
];

export default function ChannelsPage() {
  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <h1 className="page-title">Channels</h1>
          <p className="page-sub">Manage your connected publishing and outreach channels</p>
        </div>
      </div>

      {/* Single column on mobile, 2-col on tablet+ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 16 }}>
        {channels.map(ch => {
          const Icon = ch.Icon;
          return (
            <div key={ch.name} className="card">
              {/* Header */}
              <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--ink-100)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 'var(--r-md)', background: ch.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon size={20} color={ch.iconColor} />
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-900)' }}>{ch.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 2 }}>{ch.handle}</div>
                    </div>
                  </div>
                  {ch.status === 'live'
                    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 'var(--r-pill)', background: '#e8f5ee', color: 'var(--ok)', fontSize: 11, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }} />Live
                      </span>
                    : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 'var(--r-pill)', background: 'var(--ink-100)', color: 'var(--ink-400)', fontSize: 11, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink-300)', display: 'inline-block' }} />Not connected
                      </span>
                  }
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-500)', lineHeight: 1.5 }}>{ch.desc}</div>
              </div>

              {/* Stats grid */}
              {ch.stats.length > 0 && (
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--ink-100)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {ch.stats.map((s: { label: string; value: string }) => (
                    <div key={s.label}>
                      <div style={{ fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-400)', fontWeight: 600, marginBottom: 3 }}>{s.label}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-800)', wordBreak: 'break-word' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Health bar */}
              {ch.health > 0 && (
                <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--ink-100)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-400)', marginBottom: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Zap size={11} /> Channel health</span>
                    <span style={{ fontWeight: 700, color: 'var(--ok)' }}>{ch.health}%</span>
                  </div>
                  <div style={{ background: 'var(--ink-100)', borderRadius: 'var(--r-pill)', height: 5, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: ch.health + '%', borderRadius: 'var(--r-pill)', background: 'var(--ok)', transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ padding: '12px 20px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ch.status === 'live'
                  ? <>
                      <button className="btn-primary" style={{ fontSize: 11.5, padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Settings size={12} /> Configure
                      </button>
                      <button className="btn-ghost" style={{ fontSize: 11.5, padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <FileText size={12} /> View logs
                      </button>
                    </>
                  : <button className="btn-primary" style={{ fontSize: 11.5, padding: '7px 14px' }}>
                      + Connect {ch.name}
                    </button>
                }
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
