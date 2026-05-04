'use client';
import Link from 'next/link';
import { Calendar, Instagram, Linkedin, Twitter, Settings, ArrowRight, Sparkles } from 'lucide-react';

const platforms = [
  { name: 'Instagram', icon: Instagram, color: '#c96442', status: 'not_connected', desc: 'Town discovery content and business spotlights' },
  { name: 'LinkedIn', icon: Linkedin, color: '#2a5fa4', status: 'not_connected', desc: 'Reach local business owners and decision makers' },
  { name: 'X / Twitter', icon: Twitter, color: '#1a1213', status: 'not_connected', desc: 'Town announcements and discovery content' },
];

const ideas = [
  { town: 'Whitstable', type: 'Spotlight', text: 'Meet The Harbour Arms — serving fresh oysters since 1987. Now on Roam.' },
  { town: 'Darlington', type: 'Discovery', text: '10 independent businesses in Darlington you need to know about.' },
  { town: 'Aberfeldy', type: 'Town Feature', text: 'Aberfeldy is one of Scotland\'s best kept secrets. Here\'s why.' },
];

export default function SocialPage() {
  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <h1 className="page-title">Social Posts</h1>
          <p className="page-sub">Schedule and manage posts across Instagram, LinkedIn and X</p>
        </div>
      </div>

      {/* Connect banner */}
      <div style={{ background: 'linear-gradient(135deg, var(--maroon-900), var(--maroon-700))', borderRadius: 'var(--r-lg)', padding: '24px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ width: 48, height: 48, borderRadius: 'var(--r-md)', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Calendar size={22} color="white" />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'white', marginBottom: 4 }}>Social Scheduler</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>Connect your Instagram and LinkedIn accounts in Channels, then come back here to schedule and approve posts for each town.</div>
        </div>
        <Link href="/channels" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 'var(--r-md)', background: 'white', color: 'var(--maroon-700)', fontSize: 13, fontWeight: 700, textDecoration: 'none', flexShrink: 0 }}>
          <Settings size={14} /> Set up Channels <ArrowRight size={14} />
        </Link>
      </div>

      <div className="two-col" style={{ alignItems: 'start' }}>
        {/* Platform status */}
        <div className="card">
          <div className="card-header">Platform Status</div>
          <div style={{ padding: '8px 0' }}>
            {platforms.map(p => {
              const Icon = p.icon;
              return (
                <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1px solid var(--ink-100)' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 'var(--r-sm)', background: 'var(--ink-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={18} color={p.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 1 }}>{p.desc}</div>
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 'var(--r-pill)', background: 'var(--ink-100)', color: 'var(--ink-400)', fontSize: 10.5, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ink-300)', display: 'inline-block' }} />
                    Not connected
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Content ideas */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={14} color="var(--sun-500)" />
              <span>Content Ideas</span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 400 }}>AI-generated</span>
          </div>
          <div style={{ padding: '8px 0' }}>
            {ideas.map((idea, i) => (
              <div key={i} style={{ padding: '14px 20px', borderBottom: i < ideas.length - 1 ? '1px solid var(--ink-100)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--maroon-50)', color: 'var(--maroon-600)' }}>{idea.type}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{idea.town}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-800)', lineHeight: 1.5 }}>{idea.text}</div>
                <button style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: 'var(--maroon-600)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Schedule when connected →</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
