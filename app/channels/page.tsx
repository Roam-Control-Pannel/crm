'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2, AlertCircle, ExternalLink, RefreshCw, Plug,
  Mail, Sparkles, Clock, Wifi,
} from 'lucide-react';
import { loadWithMigration } from '@/lib/client-store';

// ============================================================================
// Types — kept internal, mirrors what /api/accounts/status returns
// ============================================================================
interface MetaPageInfo {
  id: string;
  name: string;
  hasInstagram: boolean;
  instagramId?: string;
}
interface LinkedInOrg { id: string; name: string; urn: string; }
interface LinkedInStatus {
  connected: boolean;
  name?: string; email?: string; picture?: string;
  memberUrn?: string;
  scopes?: string[];
  capabilities?: { signIn?: boolean; postPersonal?: boolean; postCompany?: boolean; listOrganisations?: boolean; };
  organisations?: LinkedInOrg[];
  connectedAt?: number;
  isExpired?: boolean;
}
interface MetaStatus {
  connected: boolean;
  pages?: MetaPageInfo[];
  connectedAt?: number;
  isExpired?: boolean;
}
interface PostResult { status: 'pending' | 'publishing' | 'published' | 'failed'; }
interface SocialPostLite {
  id: string;
  accountIds: string[];
  scheduledAt: string;
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed';
  results?: Record<string, PostResult>;
}

// ============================================================================
// Brand glyphs — kept inline so the file is self-contained
// ============================================================================
function FacebookGlyph({ size = 22, color = '#1877F2' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.019 4.388 11.013 10.125 11.927v-8.437H7.078v-3.49h3.047V9.31c0-3.027 1.788-4.7 4.533-4.7 1.314 0 2.686.236 2.686.236v2.972h-1.514c-1.49 0-1.954.93-1.954 1.886v2.265h3.328l-.532 3.49h-2.796V24C19.612 23.086 24 18.092 24 12.073z" />
    </svg>
  );
}
function InstagramGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <radialGradient id="igGrad" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497" />
          <stop offset="5%" stopColor="#fdf497" />
          <stop offset="45%" stopColor="#fd5949" />
          <stop offset="60%" stopColor="#d6249f" />
          <stop offset="90%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#igGrad)" />
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" strokeWidth="1.6" />
      <circle cx="17.5" cy="6.5" r="1.1" fill="#fff" />
    </svg>
  );
}
function LinkedInGlyph({ size = 22, color = '#0A66C2' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}
function XGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

// ============================================================================
// Helpers
// ============================================================================
function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

/**
 * Given posts and a real account id, find the most recent successful publish.
 * Looks at both top-level status and per-account `results` map.
 */
function lastPublishFor(posts: SocialPostLite[], accountId: string): string | null {
  let latest: number | null = null;
  for (const p of posts) {
    if (!p.accountIds?.includes(accountId)) continue;
    const r = p.results?.[accountId];
    const isPublished = r?.status === 'published' || (p.status === 'published' && !r);
    if (!isPublished) continue;
    const t = new Date(p.scheduledAt).getTime();
    if (!Number.isNaN(t) && (latest === null || t > latest)) latest = t;
  }
  return latest ? new Date(latest).toISOString() : null;
}

// ============================================================================
// Page
// ============================================================================
export default function ChannelsPage() {
  const [meta, setMeta] = useState<MetaStatus>({ connected: false });
  const [linkedin, setLinkedin] = useState<LinkedInStatus>({ connected: false });
  const [posts, setPosts] = useState<SocialPostLite[]>([]);
  const [brevoOk, setBrevoOk] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<{ meta?: string; linkedin?: string }>({});

  useEffect(() => {
    let cancelled = false;

    // Read URL params for connection success/error flags then clean them
    const params = new URLSearchParams(window.location.search);
    const liErr = params.get('li_error');
    const metaErr = params.get('meta_error');
    if (liErr || metaErr) {
      setErrors({ linkedin: liErr || undefined, meta: metaErr || undefined });
    }
    if (params.get('li_connected') === '1' || params.get('meta_connected') === '1' || liErr || metaErr) {
      window.history.replaceState({}, '', '/channels');
    }

    (async () => {
      try {
        const [statusRes, brevoRes, postsData] = await Promise.allSettled([
          fetch('/api/accounts/status', { cache: 'no-store' }).then(r => r.json()),
          fetch('/api/brevo/lists', { cache: 'no-store' }).then(r => r.ok),
          loadWithMigration<SocialPostLite[]>('social_posts'),
        ]);

        if (cancelled) return;

        if (statusRes.status === 'fulfilled') {
          setMeta(statusRes.value.meta || { connected: false });
          setLinkedin(statusRes.value.linkedin || { connected: false });
        }
        if (brevoRes.status === 'fulfilled') {
          setBrevoOk(brevoRes.value);
        } else {
          setBrevoOk(false);
        }
        if (postsData.status === 'fulfilled' && Array.isArray(postsData.value)) {
          setPosts(postsData.value);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // ==========================================================================
  // Derived state — counts for the summary band
  // ==========================================================================
  const summary = useMemo(() => {
    let connected = 0;
    let readyAccounts = 0;

    if (brevoOk) connected += 1;
    if (linkedin.connected && !linkedin.isExpired) connected += 1;
    if (meta.connected && !meta.isExpired) connected += 1;

    if (linkedin.connected && linkedin.capabilities?.postPersonal) readyAccounts += 1;
    if (linkedin.connected && linkedin.capabilities?.postCompany) {
      readyAccounts += (linkedin.organisations || []).length;
    }
    if (meta.connected) {
      const pages = meta.pages || [];
      readyAccounts += pages.length; // each FB page
      readyAccounts += pages.filter(p => p.hasInstagram).length; // each linked IG
    }

    let latest: number | null = null;
    for (const p of posts) {
      if (p.status !== 'published' && p.status !== 'partial') continue;
      const t = new Date(p.scheduledAt).getTime();
      if (!Number.isNaN(t) && (latest === null || t > latest)) latest = t;
    }
    return {
      connected,
      readyAccounts,
      lastPublishedIso: latest ? new Date(latest).toISOString() : null,
    };
  }, [linkedin, meta, brevoOk, posts]);

  // ==========================================================================
  // Render
  // ==========================================================================
  return (
    <div style={S.page}>
      {/* Hero */}
      <header style={S.header}>
        <div>
          <div style={S.eyebrow}>Channels</div>
          <h1 style={S.headline}>Where your stories <em style={S.emItalic}>go</em></h1>
          <p style={S.subhead}>
            Connect the accounts you publish from. Posts scheduled in your calendar will go out via the channels you authorise here.
          </p>
        </div>
      </header>

      {/* Errors banner */}
      {(errors.meta || errors.linkedin) && (
        <div style={S.errBanner} role="alert">
          <AlertCircle size={14} />
          <span>
            {errors.meta && <>Facebook connection failed: <code style={S.code}>{errors.meta}</code>. </>}
            {errors.linkedin && <>LinkedIn connection failed: <code style={S.code}>{errors.linkedin}</code>. </>}
            Try connecting again below.
          </span>
        </div>
      )}

      {/* Stat band */}
      <section style={S.stats}>
        <StatTile
          label="Channels live"
          value={loading ? '—' : String(summary.connected)}
          accent="var(--maroon-600)"
          icon={<Plug size={14} />}
          caption={loading ? 'Checking…' : summary.connected === 0 ? 'No channels yet' : 'Authorised & ready'}
        />
        <StatTile
          label="Accounts ready to post"
          value={loading ? '—' : String(summary.readyAccounts)}
          accent="var(--ok)"
          icon={<CheckCircle2 size={14} />}
          caption={loading ? 'Checking…' : summary.readyAccounts === 0 ? 'Connect a channel to begin' : 'Across LinkedIn, Facebook & Instagram'}
        />
        <StatTile
          label="Last published"
          value={summary.lastPublishedIso ? timeAgo(summary.lastPublishedIso) : 'never'}
          accent="var(--info)"
          icon={<Clock size={14} />}
          caption={summary.lastPublishedIso
            ? new Date(summary.lastPublishedIso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
            : 'No posts have gone out yet'}
        />
      </section>

      {/* Channel cards */}
      <section style={S.cards}>
        <BrevoCard ok={brevoOk} />
        <MetaCard meta={meta} posts={posts} loading={loading} />
        <LinkedInCard linkedin={linkedin} posts={posts} loading={loading} />
        <ComingSoonRow />
      </section>
    </div>
  );
}

// ============================================================================
// Subcomponents
// ============================================================================
function StatTile({
  label, value, accent, icon, caption,
}: { label: string; value: string; accent: string; icon: React.ReactNode; caption: string }) {
  return (
    <div style={S.statTile}>
      <div style={{ ...S.statAccent, background: accent }} />
      <div style={S.statRow}>
        <span style={S.statLabel}>{label}</span>
        <span style={{ ...S.statIcon, color: accent }}>{icon}</span>
      </div>
      <div style={{ ...S.statValue, color: 'var(--ink-900)' }}>{value}</div>
      <div style={S.statCaption}>{caption}</div>
    </div>
  );
}

function ChannelHeader({
  glyph, title, subtitle, status, action,
}: {
  glyph: React.ReactNode;
  title: string;
  subtitle: string;
  status?: { tone: 'ok' | 'warn' | 'alert' | 'idle'; label: string };
  action?: React.ReactNode;
}) {
  const statusColors: Record<string, { bg: string; fg: string }> = {
    ok: { bg: '#e8f5ee', fg: 'var(--ok)' },
    warn: { bg: '#fbf0e0', fg: 'var(--warn)' },
    alert: { bg: '#fcebeb', fg: 'var(--alert)' },
    idle: { bg: 'var(--ink-100)', fg: 'var(--ink-500)' },
  };
  return (
    <div style={S.channelHead}>
      <div style={S.channelGlyph}>{glyph}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.channelTitle}>{title}</div>
        <div style={S.channelSub}>{subtitle}</div>
      </div>
      {status && (
        <div style={{ ...S.statusPill, background: statusColors[status.tone].bg, color: statusColors[status.tone].fg }}>
          {status.tone === 'ok' && <CheckCircle2 size={12} />}
          {status.tone === 'warn' && <AlertCircle size={12} />}
          {status.tone === 'alert' && <AlertCircle size={12} />}
          {status.tone === 'idle' && <Wifi size={12} />}
          {status.label}
        </div>
      )}
      {action}
    </div>
  );
}

function AccountRow({
  avatar, name, secondary, statusLabel, statusTone = 'ok', action,
}: {
  avatar: React.ReactNode;
  name: React.ReactNode;
  secondary?: React.ReactNode;
  statusLabel?: string;
  statusTone?: 'ok' | 'warn' | 'idle' | 'alert';
  action?: React.ReactNode;
}) {
  const colors: Record<string, { bg: string; fg: string }> = {
    ok: { bg: '#e8f5ee', fg: 'var(--ok)' },
    warn: { bg: '#fbf0e0', fg: 'var(--warn)' },
    alert: { bg: '#fcebeb', fg: 'var(--alert)' },
    idle: { bg: 'var(--ink-100)', fg: 'var(--ink-500)' },
  };
  return (
    <div style={S.accRow}>
      {avatar}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.accName}>{name}</div>
        {secondary && <div style={S.accSec}>{secondary}</div>}
      </div>
      {statusLabel && (
        <div style={{ ...S.statusPillSm, background: colors[statusTone].bg, color: colors[statusTone].fg }}>
          {statusTone === 'ok' && <CheckCircle2 size={11} />}
          {statusTone === 'warn' && <Clock size={11} />}
          {statusTone === 'alert' && <AlertCircle size={11} />}
          {statusLabel}
        </div>
      )}
      {action}
    </div>
  );
}

// ============================================================================
// Brevo
// ============================================================================
function BrevoCard({ ok }: { ok: boolean | null }) {
  const status =
    ok === null
      ? { tone: 'idle' as const, label: 'Checking…' }
      : ok
        ? { tone: 'ok' as const, label: 'Live' }
        : { tone: 'alert' as const, label: 'Cannot reach' };
  return (
    <div style={S.card}>
      <ChannelHeader
        glyph={<Mail size={20} color="#2f7a4f" />}
        title="Brevo Email"
        subtitle="Transactional email · hello@roam-everywhere.com"
        status={status}
      />
    </div>
  );
}

// ============================================================================
// Meta (Facebook + Instagram)
// ============================================================================
function MetaCard({ meta, posts, loading }: { meta: MetaStatus; posts: SocialPostLite[]; loading: boolean }) {
  const connected = !!meta.connected;
  const expired = !!meta.isExpired;
  const pages = meta.pages || [];

  function connectMeta() { window.location.href = '/api/auth/meta/start'; }
  async function disconnectMeta() {
    await fetch('/api/accounts/disconnect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'meta' }),
    });
    window.location.reload();
  }

  const headerStatus = loading
    ? { tone: 'idle' as const, label: 'Checking…' }
    : !connected
      ? { tone: 'idle' as const, label: 'Not connected' }
      : expired
        ? { tone: 'warn' as const, label: 'Re-auth needed' }
        : { tone: 'ok' as const, label: `${pages.length} page${pages.length === 1 ? '' : 's'}` };

  return (
    <div style={S.card}>
      <ChannelHeader
        glyph={<FacebookGlyph />}
        title="Facebook Pages + Instagram"
        subtitle={connected
          ? `${pages.length} Page${pages.length === 1 ? '' : 's'} · ${pages.filter(p => p.hasInstagram).length} with Instagram`
          : 'Connect a Facebook account to link all Pages and linked Instagram Business accounts in one click'}
        status={headerStatus}
        action={connected ? (
          <div style={S.actionGroup}>
            <button onClick={connectMeta} style={S.btnGhost}><RefreshCw size={12} />Reconnect</button>
            <button onClick={disconnectMeta} style={S.btnDanger}>Disconnect</button>
          </div>
        ) : (
          <button onClick={connectMeta} style={S.btnFB}>
            <FacebookGlyph size={16} color="#fff" /> Connect with Facebook
          </button>
        )}
      />

      {connected && pages.length > 0 && (
        <div style={S.accList}>
          {pages.map(page => {
            const fbId = `meta-page:${page.id}`;
            const igId = page.instagramId ? `meta-ig:${page.instagramId}` : null;
            const fbLast = lastPublishFor(posts, fbId);
            const igLast = igId ? lastPublishFor(posts, igId) : null;
            return (
              <div key={page.id}>
                <AccountRow
                  avatar={
                    <div style={{ ...S.avatarSquare, background: '#1877F2' }}>
                      <FacebookGlyph size={16} color="#fff" />
                    </div>
                  }
                  name={<>{page.name} <span style={S.subtleMeta}>· Facebook Page</span></>}
                  secondary={fbLast ? <>Last posted {timeAgo(fbLast)}</> : 'Ready to post — no posts yet'}
                  statusLabel={fbLast ? `Posted ${timeAgo(fbLast)}` : 'Ready'}
                  statusTone="ok"
                />
                {page.hasInstagram && (
                  <AccountRow
                    avatar={<div style={S.avatarSquare}><InstagramGlyph size={20} /></div>}
                    name={<>{page.name} <span style={S.subtleMeta}>· Instagram Business</span></>}
                    secondary={igLast ? <>Last posted {timeAgo(igLast)}</> : 'Ready to post — no posts yet'}
                    statusLabel={igLast ? `Posted ${timeAgo(igLast)}` : 'Ready'}
                    statusTone="ok"
                  />
                )}
              </div>
            );
          })}
          <div style={S.cardFootMeta}>
            Connected {meta.connectedAt ? new Date(meta.connectedAt).toLocaleDateString('en-GB') : ''}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// LinkedIn — single unified card. Personal + each org as separate rows.
// Pending Community Mgmt API surfaces inline.
// ============================================================================
function LinkedInCard({ linkedin, posts, loading }: { linkedin: LinkedInStatus; posts: SocialPostLite[]; loading: boolean }) {
  const connected = !!linkedin.connected;
  const expired = !!linkedin.isExpired;
  const orgs = linkedin.organisations || [];
  const canPostCompany = !!linkedin.capabilities?.postCompany;

  function connectLI() { window.location.href = '/api/auth/linkedin/start'; }
  async function disconnectLI() {
    await fetch('/api/accounts/disconnect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'linkedin' }),
    });
    window.location.reload();
  }

  const headerStatus = loading
    ? { tone: 'idle' as const, label: 'Checking…' }
    : !connected
      ? { tone: 'idle' as const, label: 'Not connected' }
      : expired
        ? { tone: 'warn' as const, label: 'Re-auth needed' }
        : { tone: 'ok' as const, label: `Connected as ${linkedin.name?.split(' ')[0] || 'you'}` };

  return (
    <div style={S.card}>
      <ChannelHeader
        glyph={<LinkedInGlyph />}
        title="LinkedIn"
        subtitle={connected
          ? `Personal account${orgs.length > 0 ? ` + ${orgs.length} Company Page${orgs.length === 1 ? '' : 's'}` : ''}`
          : 'Connect to publish to your personal feed and any Company Pages you administer'}
        status={headerStatus}
        action={connected ? (
          <div style={S.actionGroup}>
            <button onClick={connectLI} style={S.btnGhost}><RefreshCw size={12} />Reconnect</button>
            <button onClick={disconnectLI} style={S.btnDanger}>Disconnect</button>
          </div>
        ) : (
          <button onClick={connectLI} style={S.btnLI}>
            <LinkedInGlyph size={14} color="#fff" /> Connect LinkedIn
          </button>
        )}
      />

      {connected && (
        <div style={S.accList}>
          {/* Personal account */}
          {(() => {
            const id = `li-personal:${linkedin.memberUrn}`;
            const last = lastPublishFor(posts, id);
            const canPost = !!linkedin.capabilities?.postPersonal;
            return (
              <AccountRow
                avatar={
                  linkedin.picture
                    ? <img src={linkedin.picture} alt="" style={S.avatarRound} />
                    : <div style={{ ...S.avatarRound, background: 'var(--ink-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--ink-500)' }}>{(linkedin.name || '?').slice(0, 1).toUpperCase()}</div>
                }
                name={<>{linkedin.name} <span style={S.subtleMeta}>· Personal</span></>}
                secondary={last ? <>Last posted {timeAgo(last)} · {linkedin.email}</> : <>{linkedin.email || 'Personal feed'}</>}
                statusLabel={canPost ? (last ? `Posted ${timeAgo(last)}` : 'Ready') : 'Sign-in only'}
                statusTone={canPost ? 'ok' : 'idle'}
              />
            );
          })()}

          {/* Org rows — either approved (post) or pending (apply) */}
          {orgs.length > 0
            ? orgs.map(org => {
                const id = `li-company:${org.urn}`;
                const last = lastPublishFor(posts, id);
                return (
                  <AccountRow
                    key={org.id}
                    avatar={
                      <div style={{ ...S.avatarSquare, background: '#0A66C2', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                        {org.name.slice(0, 2).toUpperCase()}
                      </div>
                    }
                    name={<>{org.name} <span style={S.subtleMeta}>· Company Page</span></>}
                    secondary={canPostCompany
                      ? (last ? <>Last posted {timeAgo(last)}</> : 'Admin access')
                      : <span style={{ color: 'var(--warn)' }}>Pending Community Management API approval</span>}
                    statusLabel={canPostCompany ? (last ? `Posted ${timeAgo(last)}` : 'Ready') : 'Pending'}
                    statusTone={canPostCompany ? 'ok' : 'warn'}
                    action={!canPostCompany
                      ? <a href="https://www.linkedin.com/developers/apps" target="_blank" rel="noopener noreferrer" style={S.linkAction}>
                          <ExternalLink size={11} /> Apply
                        </a>
                      : undefined}
                  />
                );
              })
            : (
              <AccountRow
                avatar={<div style={{ ...S.avatarSquare, background: '#0A66C2', opacity: 0.4, color: '#fff', fontSize: 11, fontWeight: 700 }}>RL</div>}
                name={<>Roam Local <span style={S.subtleMeta}>· Company Page</span></>}
                secondary={<span style={{ color: 'var(--warn)' }}>Pending Community Management API approval</span>}
                statusLabel="Pending"
                statusTone="warn"
                action={
                  <a href="https://www.linkedin.com/developers/apps" target="_blank" rel="noopener noreferrer" style={S.linkAction}>
                    <ExternalLink size={11} /> Apply
                  </a>
                }
              />
            )
          }
          <div style={S.cardFootMeta}>
            Connected {linkedin.connectedAt ? new Date(linkedin.connectedAt).toLocaleDateString('en-GB') : ''}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Coming-soon row (X / etc.)
// ============================================================================
function ComingSoonRow() {
  return (
    <div style={S.comingCard}>
      <div style={S.comingHead}>
        <Sparkles size={13} />
        <span>Coming next</span>
      </div>
      <div style={S.comingList}>
        <a href="https://developer.twitter.com" target="_blank" rel="noopener noreferrer" style={S.comingItem}>
          <span style={{ ...S.comingGlyph, background: '#000', color: '#fff' }}><XGlyph size={14} /></span>
          <span style={S.comingItemMain}>
            <span style={S.comingItemTitle}>X / Twitter</span>
            <span style={S.comingItemSub}>Apply for developer access</span>
          </span>
          <ExternalLink size={12} color="var(--ink-400)" />
        </a>
      </div>
    </div>
  );
}

// ============================================================================
// Styles
// ============================================================================
const S: Record<string, React.CSSProperties> = {
  page: { padding: '32px 28px 64px', maxWidth: 980, margin: '0 auto' },

  header: { marginBottom: 32 },
  eyebrow: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase',
    color: 'var(--maroon-600)', marginBottom: 12,
  },
  headline: {
    fontFamily: 'var(--font-display)', fontSize: 44, lineHeight: 1.05,
    color: 'var(--ink-900)', fontWeight: 400, letterSpacing: '-0.01em', marginBottom: 10,
  },
  emItalic: { fontStyle: 'italic', color: 'var(--maroon-600)', fontWeight: 400 },
  subhead: {
    fontSize: 14, lineHeight: 1.55, color: 'var(--ink-500)', maxWidth: 560,
  },

  errBanner: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: '#fcebeb', border: '1px solid #f5c2c7', color: 'var(--alert)',
    padding: '12px 16px', borderRadius: 'var(--r-md)', fontSize: 13, marginBottom: 20,
  },
  code: { fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12, padding: '1px 5px', background: 'rgba(0,0,0,0.06)', borderRadius: 4 },

  stats: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12,
    marginBottom: 28,
  },
  statTile: {
    position: 'relative', background: 'var(--white)', borderRadius: 'var(--r-lg)',
    boxShadow: 'var(--shadow-sm)', padding: '16px 18px 18px', overflow: 'hidden',
  },
  statAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  statRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  statLabel: {
    fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-400)',
  },
  statIcon: { display: 'inline-flex' },
  statValue: { fontFamily: 'var(--font-display)', fontSize: 36, lineHeight: 1, marginBottom: 4 },
  statCaption: { fontSize: 11.5, color: 'var(--ink-500)' },

  cards: { display: 'flex', flexDirection: 'column', gap: 14 },
  card: {
    background: 'var(--white)', borderRadius: 'var(--r-lg)',
    boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
  },
  channelHead: { display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px' },
  channelGlyph: {
    width: 44, height: 44, borderRadius: 'var(--r-md)', background: 'var(--paper)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  channelTitle: { fontSize: 14.5, fontWeight: 700, color: 'var(--ink-900)', letterSpacing: '-0.005em' },
  channelSub: { fontSize: 12.5, color: 'var(--ink-500)', marginTop: 2, lineHeight: 1.45 },

  statusPill: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 'var(--r-pill)',
    flexShrink: 0,
  },
  statusPillSm: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontSize: 10.5, fontWeight: 600, padding: '3px 9px', borderRadius: 'var(--r-pill)',
    flexShrink: 0,
  },

  actionGroup: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },

  btnGhost: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '6px 12px', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--ink-200)',
    background: 'var(--white)', color: 'var(--ink-700)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
  },
  btnDanger: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '6px 12px', borderRadius: 'var(--r-sm)', border: '1.5px solid #f5c2c7',
    background: 'var(--white)', color: 'var(--alert)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
  },
  btnFB: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '10px 16px', borderRadius: 'var(--r-md)', border: 'none',
    background: '#1877F2', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  btnLI: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '10px 16px', borderRadius: 'var(--r-md)', border: 'none',
    background: '#0A66C2', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },

  accList: { borderTop: '1px solid var(--ink-100)' },
  accRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 20px', borderBottom: '1px solid var(--ink-100)',
  },
  avatarSquare: {
    width: 32, height: 32, borderRadius: 'var(--r-sm)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden',
  },
  avatarRound: {
    width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
  },
  accName: { fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' },
  accSec: { fontSize: 11, color: 'var(--ink-400)', marginTop: 2 },
  subtleMeta: { fontSize: 11, fontWeight: 400, color: 'var(--ink-400)', marginLeft: 6 },

  cardFootMeta: {
    padding: '10px 20px', fontSize: 11, color: 'var(--ink-400)', textAlign: 'left',
    background: 'var(--paper)',
  },

  linkAction: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '5px 10px', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--ink-200)',
    background: 'var(--white)', color: 'var(--ink-700)', fontSize: 11, fontWeight: 600,
    textDecoration: 'none',
  },

  comingCard: {
    background: 'transparent', border: '1px dashed var(--ink-200)',
    borderRadius: 'var(--r-lg)', padding: '14px 16px', marginTop: 4,
  },
  comingHead: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
    color: 'var(--ink-400)', marginBottom: 10,
  },
  comingList: { display: 'flex', flexDirection: 'column', gap: 6 },
  comingItem: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '8px 10px', borderRadius: 'var(--r-sm)',
    textDecoration: 'none', color: 'inherit',
  },
  comingGlyph: {
    width: 28, height: 28, borderRadius: 'var(--r-sm)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  comingItemMain: { flex: 1, display: 'flex', flexDirection: 'column' },
  comingItemTitle: { fontSize: 13, fontWeight: 600, color: 'var(--ink-700)' },
  comingItemSub: { fontSize: 11, color: 'var(--ink-400)', marginTop: 1 },
};
