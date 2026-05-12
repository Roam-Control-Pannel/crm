'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Flame, Clock, Snowflake, RefreshCw, ArrowRight, MapPin, Mail, MousePointerClick, CheckCircle, AlertCircle, MessageSquare } from 'lucide-react';
import type { AttentionContact } from '@/lib/types';

interface PipelineStages {
  notContacted: number;
  sent: number;
  followedUp: number;
  finalNudge: number;
  listed: number;
  cold: number;
  responded: number;
}

interface PipelineEngagement {
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
}

interface PipelineResponse {
  stages: PipelineStages;
  engagement: PipelineEngagement;
  attention: {
    hottest: AttentionContact[];
    stuck: AttentionContact[];
    goingCold: AttentionContact[];
    replied: AttentionContact[];
    hottestTotal: number;
    stuckTotal: number;
    goingColdTotal: number;
    repliedTotal: number;
  };
  totals: { contactsInResults: number; contactsTotal: number };
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export default function Dashboard() {
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline', { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error('Pipeline load failed:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Background refresh every 60s so the dashboard reflects fresh webhook
  // events without the user mashing F5. Webhooks fire within seconds of an
  // open/click in Brevo, so this gives near-real-time visibility.
  useEffect(() => {
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
  }

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const lastUpdatedLabel = lastUpdated
    ? (() => {
        const s = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
        if (s < 10) return 'just now';
        if (s < 60) return `${s}s ago`;
        if (s < 3600) return `${Math.floor(s / 60)}m ago`;
        return lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      })()
    : null;

  // The funnel visualises the dominant flow. Cold and responded are end-states
  // shown separately so they don't muddy the linear progression view.
  const funnel = data ? [
    { key: 'notContacted', label: 'Not Contacted', count: data.stages.notContacted, color: '#9e7e88' },
    { key: 'sent',         label: 'Email Sent',    count: data.stages.sent + data.stages.followedUp + data.stages.finalNudge, color: '#b06820' },
    { key: 'opened',       label: 'Opened',        count: data.engagement.opened, color: '#1a6b9a' },
    { key: 'clicked',      label: 'Clicked',       count: data.engagement.clicked, color: '#6a3d8c' },
    { key: 'listed',       label: 'Listed ✓',  count: data.stages.listed, color: '#2f7a4f' },
  ] : [];

  const endStates = data ? [
    { key: 'responded', label: 'Responded', count: data.stages.responded, color: '#2a5fa4' },
    { key: 'cold',      label: 'Cold',      count: data.stages.cold, color: '#7d6e70' },
    { key: 'bounced',   label: 'Bounced',   count: data.engagement.bounced, color: '#b53939' },
  ] : [];

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <h1 className="page-title">Growth Dashboard</h1>
          <p className="page-sub">{today} · Live data from Brevo{lastUpdatedLabel && ` · Updated ${lastUpdatedLabel}`}</p>
        </div>
        <div className="btn-row">
          <button onClick={handleRefresh} disabled={refreshing} className="btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <RefreshCw size={12} style={refreshing ? { animation: 'spin 0.8s linear infinite' } : undefined} />
            {refreshing ? 'Refreshing…' : 'Sync from Brevo'}
          </button>
          <Link href="/find" className="btn-ghost" style={{ fontSize: 12.5 }}>⚡ Find Businesses</Link>
          <Link href="/contacts" className="btn-primary" style={{ fontSize: 12.5 }}>+ Add Contact</Link>
        </div>
      </div>

      {/* Funnel visualisation */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-800)' }}>🗺 Outreach Pipeline</span>
          <Link href="/contacts" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--maroon-600)', textDecoration: 'none' }}>View all contacts →</Link>
        </div>
        <div style={{ padding: '20px', overflowX: 'auto' }}>
          {loading ? (
            <div style={{ color: 'var(--ink-400)', fontSize: 13, padding: 20 }}>Loading pipeline…</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, marginBottom: 20, minWidth: 600 }}>
                {funnel.map((s, i) => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'stretch', flex: 1 }}>
                    <Link
                      href={`/contacts?stage=${s.key}`}
                      style={{
                        flex: 1,
                        textAlign: 'center',
                        padding: '14px 8px',
                        background: `${s.color}11`,
                        border: `1px solid ${s.color}33`,
                        borderRadius: 'var(--r-md)',
                        textDecoration: 'none',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.background = `${s.color}22`; }}
                      onMouseOut={(e) => { e.currentTarget.style.background = `${s.color}11`; }}
                    >
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, color: s.color, lineHeight: 1 }}>{s.count}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-500)', marginTop: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{s.label}</div>
                    </Link>
                    {i < funnel.length - 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px', color: 'var(--ink-300)' }}>
                        <ArrowRight size={14} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, paddingTop: 14, borderTop: '1px solid var(--ink-100)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-400)', letterSpacing: '0.06em', textTransform: 'uppercase', alignSelf: 'center' }}>End states:</span>
                {endStates.map(s => (
                  <Link key={s.key} href={`/contacts?stage=${s.key}`} style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    background: `${s.color}14`,
                    border: `1px solid ${s.color}33`,
                    borderRadius: 'var(--r-pill)',
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: s.color,
                    textDecoration: 'none',
                  }}>
                    {s.label} <span style={{ fontWeight: 700 }}>{s.count}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Attention queues */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
        <AttentionCard
          title="Hottest leads"
          subtitle="Clicked but not yet listed"
          icon={<Flame size={14} color="#b53939" />}
          accent="#b53939"
          contacts={data?.attention.hottest || []}
          total={data?.attention.hottestTotal || 0}
          loading={loading}
          empty="No hot leads right now — send more outreach to start clicks flowing."
        />
        <AttentionCard
          title="Stuck mid-funnel"
          subtitle="Opened but didn't click · needs nudge"
          icon={<Clock size={14} color="#c47a1a" />}
          accent="#c47a1a"
          contacts={data?.attention.stuck || []}
          total={data?.attention.stuckTotal || 0}
          loading={loading}
          empty="Nothing stuck — your sequences are flowing."
        />
        <AttentionCard
          title="Going cold soon"
          subtitle="Final nudge sent · will auto-cold"
          icon={<Snowflake size={14} color="#7d6e70" />}
          accent="#7d6e70"
          contacts={data?.attention.goingCold || []}
          total={data?.attention.goingColdTotal || 0}
          loading={loading}
          empty="Nothing going cold this week."
        />
        <AttentionCard
          title="Replied"
          subtitle="Inbound reply received · needs follow-up"
          icon={<MessageSquare size={14} color="#3a7a4d" />}
          accent="#3a7a4d"
          contacts={data?.attention.replied || []}
          total={data?.attention.repliedTotal || 0}
          loading={loading}
          empty="No new replies. Send more outreach to spark conversations."
        />
      </div>

      {/* Quick stats row */}
      {data && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatTile icon={<Mail size={14}/>} label="Sent" value={data.stages.sent + data.stages.followedUp + data.stages.finalNudge + data.stages.listed + data.stages.cold + data.stages.responded} sub={`of ${data.totals.contactsTotal} contacts`} color="#b06820" />
          <StatTile icon={<CheckCircle size={14}/>} label="Delivered" value={data.engagement.delivered} sub={data.engagement.delivered ? 'Email landed in inbox' : 'No deliveries yet'} color="#2f7a4f" />
          <StatTile icon={<MousePointerClick size={14}/>} label="Clicks" value={data.engagement.clicked} sub={data.engagement.clicked ? 'Hot lead signals' : 'No clicks yet'} color="#1a6b9a" />
          <StatTile icon={<AlertCircle size={14}/>} label="Bounces" value={data.engagement.bounced} sub={data.engagement.bounced ? 'Invalid addresses' : 'No bounces'} color={data.engagement.bounced ? '#b53939' : '#7d6e70'} />
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function StatTile({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: number; sub: string; color: string }) {
  return (
    <div className="stat-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color }}>
        {icon}
        <div className="stat-label" style={{ margin: 0 }}>{label}</div>
      </div>
      <div className="stat-num" style={{ color }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2, fontWeight: 500 }}>{sub}</div>
    </div>
  );
}

function AttentionCard({ title, subtitle, icon, accent, contacts, total, loading, empty }: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: string;
  contacts: AttentionContact[];
  total: number;
  loading: boolean;
  empty: string;
}) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-header" style={{ borderLeft: `3px solid ${accent}` }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--ink-800)' }}>
            {icon}
            <span>{title}</span>
            {total > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-400)' }}>({total})</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>
      {loading ? (
        <div style={{ padding: 20, fontSize: 12, color: 'var(--ink-400)' }}>Loading…</div>
      ) : contacts.length === 0 ? (
        <div style={{ padding: 28, fontSize: 12, color: 'var(--ink-400)', textAlign: 'center', lineHeight: 1.6 }}>{empty}</div>
      ) : (
        <>
          <div style={{ flex: 1 }}>
            {contacts.map(c => (
              <Link
                key={c.email}
                href={`/contacts?search=${encodeURIComponent(c.email)}`}
                style={{
                  display: 'block',
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--ink-100)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    {c.town && (
                      <div style={{ fontSize: 10.5, color: 'var(--ink-400)', display: 'flex', alignItems: 'center', gap: 3, marginTop: 1 }}>
                        <MapPin size={9} /> {c.town}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: accent, marginTop: 4, fontWeight: 600 }}>{c.signal}</div>
                    {c.replyPreview && (
                      <div style={{ fontSize: 11, color: 'var(--ink-600)', marginTop: 6, padding: '6px 8px', background: 'var(--paper)', borderRadius: 'var(--r-sm)', fontStyle: 'italic', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {c.replyPreview}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-400)', whiteSpace: 'nowrap', fontWeight: 500 }}>
                    {timeAgo(c.signalAt)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
          {total > contacts.length && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--ink-100)', fontSize: 11.5, fontWeight: 600, color: 'var(--ink-400)', textAlign: 'center' }}>
              + {total - contacts.length} more
            </div>
          )}
        </>
      )}
    </div>
  );
}
