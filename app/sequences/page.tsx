'use client';
import { useState, useEffect, useCallback } from 'react';
import { Mail, Settings, TrendingUp, CheckCircle, AlertCircle, Clock, Play } from 'lucide-react';

interface Stats {
  total: number;
  emailSent: number;
  followUpDue: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  listed: number;
  unsubscribed: number;
}

interface CronRunRecord {
  ranAt: string;
  ok: boolean;
  day2Sent: number;
  day7Sent: number;
  day14Cold: number;
  errors: number;
  capped: boolean;
  message: string;
}

interface CronStatusResponse {
  lastRun: CronRunRecord | null;
  history: CronRunRecord[];
  sendsToday: number;
  dailyCap: number;
  capRemaining: number;
}

const SEQUENCE = [
  {
    step: 1,
    active: true,
    title: 'First Contact — Introduction',
    timing: 'Sent on approval · Personalised per town',
    subject: 'Free listing for [Business] on Roam',
    body: 'Hi there,\n\nWe\u2019ve built a dedicated page for [Town] on Roam — a free local discovery app helping people find the best independent businesses in their area.\n\n[Town] is known for [known_for], and we\u2019d love [Business] to be one of the first businesses featured.\n\nListing takes 90 seconds and is completely free — no subscription, no catch.\n\n[List Business for free →]\n\nAny questions, just reply to this email.\n\nBest wishes,\n— Roam Local Team\nroam-local.co.uk',
  },
  {
    step: 2,
    active: true,
    title: 'Follow-up — Social proof',
    timing: 'Day 2 if no response · Sent automatically by daily cron',
    subject: 'Just checking in — [Town] on Roam',
    body: 'Hi there,\n\nJust a quick follow-up — we\u2019d love to have [Business] on Roam\u2019s [Town] page.\n\nIt\u2019s completely free and takes 90 seconds. Businesses across [Town] are already signing up.\n\n[Get listed now →]\n\nBest wishes,\n— Roam Local Team\nroam-local.co.uk',
  },
  {
    step: 3,
    active: true,
    title: 'Final Nudge — Last chance',
    timing: 'Day 7 if no response · Sent automatically by daily cron',
    subject: 'Last one from us — [Business]',
    body: 'Hi there,\n\nWe won\u2019t chase again after this — promise!\n\nIf you\u2019d like [Business] featured on Roam\u2019s [Town] page for free, it only takes 90 seconds.\n\n[List for free →]\n\nBest wishes,\n— Roam Local Team\nroam-local.co.uk',
  },
  {
    step: 4,
    active: true,
    title: 'Mark as Cold',
    timing: 'Day 14 · Archived automatically',
    subject: null as string | null,
    body: 'Business is marked cold in the pipeline. Can be re-activated after 90 days.',
  },
];

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

function pct(numerator: number, denominator: number): string {
  if (!denominator) return '—';
  const v = (numerator / denominator) * 100;
  return v >= 10 ? `${Math.round(v)}%` : `${v.toFixed(1)}%`;
}

export default function SequencesPage() {
  const [stats, setStats] = useState<Stats>({
    total: 0, emailSent: 0, followUpDue: 0,
    delivered: 0, opened: 0, clicked: 0, bounced: 0, listed: 0, unsubscribed: 0,
  });
  const [cronStatus, setCronStatus] = useState<CronStatusResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(1);
  const [loadingStats, setLoadingStats] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      const d = await fetch('/api/brevo/contacts?limit=500').then(r => r.json());
      const contacts = d.contacts || [];
      let emailSent = 0, followUpDue = 0, delivered = 0, opened = 0, clicked = 0,
          bounced = 0, listed = 0, unsubscribed = 0;
      for (const c of contacts) {
        const a = c.attributes || {};
        const status = a.OUTREACH_STATUS;
        if (['email_sent', 'followed_up', 'final_nudge'].includes(status)) emailSent++;
        if (status === 'email_sent') followUpDue++;
        if (a.LAST_DELIVERED_AT) delivered++;
        if (a.LAST_OPENED_AT) opened++;
        if (a.LAST_CLICKED_AT) clicked++;
        if (a.BOUNCED_AT) bounced++;
        if (status === 'listed') listed++;
        if (a.UNSUBSCRIBED_AT) unsubscribed++;
      }
      setStats({
        total: contacts.length, emailSent, followUpDue,
        delivered, opened, clicked, bounced, listed, unsubscribed,
      });
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const loadCronStatus = useCallback(async () => {
    try {
      const d = await fetch('/api/sequences/status').then(r => r.json());
      setCronStatus(d);
    } catch (err) {
      console.error('Failed to load cron status:', err);
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadCronStatus();
  }, [loadStats, loadCronStatus]);

  async function runSequences() {
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      const res = await fetch('/api/sequences/run-now', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setRunError(data?.error || `Run failed (${res.status})`);
      } else {
        setRunResult(data.message || 'Complete');
        await Promise.all([loadCronStatus(), loadStats()]);
      }
    } catch (err: any) {
      setRunError(err?.message || 'Network error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <h1 className="page-title">Email Sequences</h1>
          <p className="page-sub">Automated 3-step outreach · runs daily at 08:00 UTC</p>
        </div>
        <div className="btn-row">
          <button onClick={runSequences} disabled={running} className="btn-primary" style={{ fontSize: 12, opacity: running ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Play size={12} fill="currentColor" /> {running ? 'Running…' : 'Run sequences now'}
          </button>
        </div>
      </div>

      <div style={{
        marginBottom: 20, padding: '12px 16px',
        background: cronStatus?.lastRun?.ok === false ? '#fcebeb' : 'var(--white)',
        border: '1px solid ' + (cronStatus?.lastRun?.ok === false ? '#f5c2c7' : 'var(--ink-100)'),
        borderRadius: 'var(--r-md)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <Clock size={14} color={cronStatus?.lastRun?.ok === false ? 'var(--alert)' : 'var(--info)'} />
        {cronStatus === null ? (
          <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>Loading run status…</span>
        ) : !cronStatus.lastRun ? (
          <span style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>
            <strong style={{ color: 'var(--ink-700)' }}>No automatic runs yet.</strong> The daily cron fires at 08:00 UTC. Click "Run sequences now" to test.
          </span>
        ) : (
          <span style={{ fontSize: 12.5, color: 'var(--ink-700)' }}>
            <strong>Last run:</strong> {timeAgo(cronStatus.lastRun.ranAt)}
            {' · '}
            <span style={{ color: cronStatus.lastRun.ok ? 'var(--ok)' : 'var(--alert)' }}>
              {cronStatus.lastRun.ok ? '✓' : '✗'} {cronStatus.lastRun.message}
            </span>
          </span>
        )}
        {cronStatus && (
          <span style={{ fontSize: 11, color: 'var(--ink-400)', marginLeft: 'auto', fontWeight: 500 }}>
            Cap: {cronStatus.sendsToday} / {cronStatus.dailyCap} today
          </span>
        )}
      </div>

      {(runResult || runError) && (
        <div style={{
          marginBottom: 20, padding: '10px 14px',
          background: runError ? '#fcebeb' : '#e8f5ee',
          color: runError ? 'var(--alert)' : 'var(--ok)',
          border: '1px solid ' + (runError ? '#f5c2c7' : '#c2e8d3'),
          borderRadius: 'var(--r-md)',
          fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {runError ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
          <span>{runError || runResult}</span>
          <button onClick={() => { setRunResult(null); setRunError(null); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14 }}>×</button>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Total Contacts', value: stats.total, color: 'var(--info)' },
          { label: 'Outreach Sent', value: stats.emailSent, color: 'var(--ok)' },
          { label: 'Follow-up Due', value: stats.followUpDue, color: 'var(--warn)' },
          { label: 'Not Contacted', value: Math.max(0, stats.total - stats.emailSent), color: 'var(--ink-400)' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-num" style={{ fontSize: 28, color: s.color }}>{loadingStats ? '—' : s.value}</div>
          </div>
        ))}
      </div>

      <div className="two-col" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mail size={15} color="var(--maroon-600)" />
              <span>Outreach Sequence</span>
            </div>
          </div>
          <div style={{ padding: '16px 20px' }}>
            {SEQUENCE.map((s, i) => (
              <div key={s.step} style={{ display: 'flex', gap: 14, marginBottom: i < SEQUENCE.length - 1 ? 20 : 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: s.active ? 'var(--maroon-700)' : 'var(--ink-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {s.active ? <CheckCircle size={15} color="white" /> : <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-400)' }}>{s.step}</span>}
                  </div>
                  {i < SEQUENCE.length - 1 && <div style={{ width: 2, flex: 1, background: 'var(--ink-100)', margin: '4px 0', minHeight: 16 }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
                  <button onClick={() => setExpanded(expanded === s.step ? null : s.step)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-900)' }}>{s.title}</div>
                      <div style={{ fontSize: 16, color: 'var(--ink-300)', flexShrink: 0 }}>{expanded === s.step ? '−' : '+'}</div>
                    </div>
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 500, marginBottom: expanded === s.step ? 10 : 0 }}>{s.timing}</div>
                  {expanded === s.step && s.subject && (
                    <div style={{ background: 'var(--paper)', border: '1px solid var(--ink-100)', borderRadius: 'var(--r-md)', padding: '12px 14px', fontSize: 12 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-400)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Subject</div>
                      <div style={{ fontWeight: 600, color: 'var(--ink-800)', marginBottom: 10, fontSize: 13 }}>{s.subject}</div>
                      <div style={{ color: 'var(--ink-700)', lineHeight: 1.7, whiteSpace: 'pre-line', borderTop: '1px solid var(--ink-100)', paddingTop: 10 }}>{s.body}</div>
                    </div>
                  )}
                  {expanded === s.step && !s.subject && (
                    <div style={{ fontSize: 12, color: 'var(--ink-400)', fontStyle: 'italic' }}>{s.body}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingUp size={15} color="var(--ok)" />
                <span>Performance</span>
              </div>
            </div>
            <div style={{ padding: '4px 0' }}>
              {[
                { label: 'Open rate',  value: pct(stats.opened, stats.delivered),   sub: stats.delivered ? `${stats.opened} of ${stats.delivered} delivered`  : 'No deliveries yet' },
                { label: 'Click rate', value: pct(stats.clicked, stats.delivered),  sub: stats.delivered ? `${stats.clicked} of ${stats.delivered} delivered` : 'No deliveries yet' },
                { label: 'Bounce rate', value: pct(stats.bounced, stats.delivered + stats.bounced), sub: stats.bounced ? `${stats.bounced} bounced` : 'No bounces' },
                { label: 'Listed rate', value: pct(stats.listed, stats.emailSent), sub: stats.listed ? `${stats.listed} businesses listed` : 'No conversions yet' },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--ink-100)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-800)' }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>{r.sub}</div>
                  </div>
                  <div style={{ fontSize: 22, fontFamily: 'var(--font-display)', color: r.value === '—' ? 'var(--ink-300)' : 'var(--ink-900)' }}>{r.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Settings size={15} color="var(--ink-400)" />
                <span>Settings</span>
              </div>
            </div>
            <div style={{ padding: '4px 0' }}>
              {[
                { label: 'Sending account', value: 'hello@roam-everywhere.com' },
                { label: 'Schedule',         value: 'Daily 08:00 UTC' },
                { label: 'Daily send cap',   value: cronStatus ? `${cronStatus.dailyCap} emails` : '50 emails' },
                { label: 'Follow-up delay',  value: '2 days' },
                { label: 'Final nudge',      value: 'Day 7' },
                { label: 'Cold cutoff',      value: 'Day 14' },
                { label: 'Links to',         value: 'roam-local.co.uk' },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid var(--ink-100)', flexWrap: 'wrap', gap: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-500)', fontWeight: 500 }}>{s.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-900)' }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
