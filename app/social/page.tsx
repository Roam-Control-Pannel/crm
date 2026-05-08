'use client';
import { useState, useEffect } from 'react';
import { Plus, Sparkles, Calendar, List, ChevronLeft, ChevronRight, X, Edit3, Check, Clock, Image, Trash2, AlertTriangle } from 'lucide-react';
import { Brief, getBriefs } from '@/lib/briefs';
import { GOAL_OPTIONS, getGoalLabel } from '@/lib/goals';
import { SocialAccount, fetchRealAccounts, combineAccounts } from '@/lib/social-accounts';

// ============================================================================
// One-time legacy data migration
// ============================================================================
const POSTS_VERSION = 5;

function migrateLegacy() {
  if (typeof window === 'undefined') return;
  const v = Number(localStorage.getItem('roam_social_posts_v') || '0');
  if (v < POSTS_VERSION) {
    // Wipe legacy posts (account IDs are now real platform identifiers)
    localStorage.removeItem('roam_social_posts');
    localStorage.removeItem('roam_accounts'); // legacy 5 fictional handles
    localStorage.setItem('roam_social_posts_v', String(POSTS_VERSION));
  }
}

// ============================================================================
// Types
// ============================================================================
interface PostResult {
  status: 'pending' | 'publishing' | 'published' | 'failed';
  postId?: string;
  postUrl?: string;
  error?: string;
}

interface SocialPost {
  id: string;
  briefId?: string;
  accountIds: string[];        // real account ids: 'li-personal:...', 'meta-page:...', 'meta-ig:...'
  caption: string;
  imageUrl?: string;
  imageCredit?: string;
  scheduledAt: string;          // ISO
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed';
  results?: Record<string, PostResult>;
  town?: string;                // optional context
  createdAt: string;
}

interface Notification {
  id: string;
  type: 'info' | 'email_failed' | 'success';
  title: string;
  body?: string;
  ts: number;
}

// ============================================================================
// Posts persistence
// ============================================================================
function getPosts(): SocialPost[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem('roam_social_posts') || '[]');
  } catch {
    return [];
  }
}

function savePosts(posts: SocialPost[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('roam_social_posts', JSON.stringify(posts));
}

// ============================================================================
// Style tokens
// ============================================================================
const inp = {
  width: '100%', padding: '8px 12px', border: '1.5px solid var(--ink-200)',
  borderRadius: 'var(--r-sm)', fontSize: 13, fontFamily: 'inherit', background: 'var(--white)',
} as const;

const btnG = {
  padding: '7px 14px', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--ink-200)',
  background: 'var(--white)', fontSize: 12, fontWeight: 500, color: 'var(--ink-700)',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
} as const;

const btnP = {
  padding: '7px 14px', borderRadius: 'var(--r-sm)', border: 'none',
  background: 'var(--maroon-700)', color: 'var(--white)', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
} as const;

// ============================================================================
// Inline platform glyph (lucide doesn't export these)
// ============================================================================
function PlatformIcon({ platform, size = 12, color = 'currentColor' }: { platform: string; size?: number; color?: string }) {
  if (platform === 'linkedin') return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 110-4.13 2.06 2.06 0 010 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"/></svg>;
  if (platform === 'facebook') return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>;
  if (platform === 'instagram') return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>;
  return null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ============================================================================
// Page component
// ============================================================================
export default function SocialPage() {
  const today = new Date();

  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<'calendar' | 'list'>('calendar');
  const [calM, setCalM] = useState(today.getMonth());
  const [calY, setCalY] = useState(today.getFullYear());
  const [platFilter, setPlatFilter] = useState('all');
  const [acctFilter, setAcctFilter] = useState('all');

  const [showComposer, setShowComposer] = useState(false);
  const [editPost, setEditPost] = useState<SocialPost | null>(null);
  const [form, setForm] = useState({
    briefId: '', accountIds: [] as string[],
    caption: '', town: '',
    imageUrl: '', imageCredit: '',
    scheduledDate: today.toISOString().split('T')[0],
    scheduledTime: '10:00',
    status: 'draft' as SocialPost['status'],
  });

  const [showGen, setShowGen] = useState(false);
  const [genForm, setGenForm] = useState({
    briefId: '', accountIds: [] as string[],
    theme: '', goal: '',
    postsPerAccount: 3,
    weekStart: today.toISOString().split('T')[0],
  });
  const [generating, setGenerating] = useState(false);
  const [generatingCaption, setGeneratingCaption] = useState(false);

  const [unsplash, setUnsplash] = useState<{ url: string; thumb: string; credit: string }[]>([]);
  const [unsplashQuery, setUnsplashQuery] = useState('');
  const [searchingImgs, setSearchingImgs] = useState(false);

  const [confirmPublish, setConfirmPublish] = useState<SocialPost | null>(null);
  const [publishing, setPublishing] = useState(false);

  const [notifications, setNotifications] = useState<Notification[]>([]);

  function addNotification(n: Omit<Notification, 'id' | 'ts'>) {
    const note: Notification = { ...n, id: 't' + Date.now() + Math.random(), ts: Date.now() };
    setNotifications(ns => [note, ...ns].slice(0, 5));
    setTimeout(() => setNotifications(ns => ns.filter(x => x.id !== note.id)), 6000);
  }

  // Load accounts + briefs + posts on mount
  useEffect(() => {
    migrateLegacy();
    (async () => {
      const real = await fetchRealAccounts();
      const briefsData = getBriefs();
      setBriefs(briefsData);
      setAccounts(combineAccounts(real, briefsData));
      setPosts(getPosts());
      setLoading(false);
    })();
  }, []);

  // Debounced Unsplash search
  useEffect(() => {
    if (!unsplashQuery.trim()) { setUnsplash([]); return; }
    const t = setTimeout(() => searchUnsplash(unsplashQuery), 350);
    return () => clearTimeout(t);
  }, [unsplashQuery]);

  async function searchUnsplash(query: string) {
    if (!query.trim()) return;
    setSearchingImgs(true);
    try {
      const res = await fetch('/api/images/search?query=' + encodeURIComponent(query) + '&count=6');
      const d = await res.json();
      setUnsplash(d.images || []);
    } catch { setUnsplash([]); }
    finally { setSearchingImgs(false); }
  }

  function saveAndSet(next: SocialPost[]) {
    setPosts(next);
    savePosts(next);
  }

  function openComposer(p?: SocialPost) {
    if (p) {
      const d = new Date(p.scheduledAt);
      setEditPost(p);
      setForm({
        briefId: p.briefId || '',
        accountIds: p.accountIds,
        caption: p.caption,
        town: p.town || '',
        imageUrl: p.imageUrl || '',
        imageCredit: p.imageCredit || '',
        scheduledDate: d.toISOString().split('T')[0],
        scheduledTime: d.toTimeString().slice(0, 5),
        status: p.status,
      });
    } else {
      setEditPost(null);
      setForm({
        briefId: '', accountIds: [], caption: '', town: '',
        imageUrl: '', imageCredit: '',
        scheduledDate: today.toISOString().split('T')[0],
        scheduledTime: '10:00',
        status: 'draft',
      });
    }
    setUnsplashQuery('');
    setUnsplash([]);
    setShowComposer(true);
  }

  function savePost() {
    if (!form.caption.trim() || form.accountIds.length === 0) return;
    const scheduledAt = new Date(form.scheduledDate + 'T' + form.scheduledTime).toISOString();
    if (editPost) {
      const next = posts.map(p => p.id === editPost.id ? { ...p, ...form, scheduledAt } : p);
      saveAndSet(next);
    } else {
      const np: SocialPost = {
        id: 'p' + Date.now(),
        briefId: form.briefId,
        accountIds: form.accountIds,
        caption: form.caption,
        imageUrl: form.imageUrl,
        imageCredit: form.imageCredit,
        town: form.town,
        scheduledAt,
        status: form.status,
        createdAt: new Date().toISOString(),
      };
      saveAndSet([np, ...posts]);
    }
    setShowComposer(false);
  }



  async function uploadOwnImage(file: File) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      addNotification({ type: 'email_failed', title: 'File too large', body: 'Max 8MB. Compress and try again.' });
      return;
    }
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/images/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.ok && data.url) {
        const absUrl = data.url.startsWith('http') ? data.url : window.location.origin + data.url;
        setForm(f => ({ ...f, imageUrl: absUrl, imageCredit: 'Your upload' }));
        setUnsplash([]);
        setUnsplashQuery('');
        addNotification({ type: 'success', title: 'Image uploaded' });
      } else {
        addNotification({ type: 'email_failed', title: 'Upload failed', body: data.error || 'Unknown error' });
      }
    } catch (e) {
      addNotification({ type: 'email_failed', title: 'Upload failed', body: 'Network error' });
    }
  }

  // Generate a single post caption inline in the composer
  async function generateCaptionForComposer() {
    if (!form.briefId || form.accountIds.length === 0) return;
    const brief = briefs.find(b => b.id === form.briefId);
    const acc = accounts.find(a => a.id === form.accountIds[0]);
    if (!brief || !acc) return;

    const audience = acc.toneOverride || brief.audience;
    const tone = acc.toneOverride || brief.tone;
    const contentBrief = acc.contentBriefOverride || brief.contentBrief;
    const hashtags = acc.hashtagsOverride || brief.hashtags;
    const theme = form.town?.trim() || form.caption.trim().slice(0, 200) || "an upcoming post";

    const prompt = `You are writing a single social media post for ${acc.handle} (${acc.platform}${acc.region ? ' · ' + acc.region : ''}).

Brand context:
- Audience: ${audience}
- Tone: ${tone}
- Content focus: ${contentBrief}
- Hashtags to use: ${hashtags}

Theme / topic: ${theme}

Return ONLY the caption text. No JSON, no markdown, no preamble. Just the caption ready to publish.`;

    setGeneratingCaption(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], model: 'claude-sonnet-4-5' }),
      });
      const data = await res.json();
      const txt = (data.content?.[0]?.text || data.text || '').trim();
      if (txt) {
        setForm(f => ({ ...f, caption: txt }));
        addNotification({ type: 'info', title: 'Caption generated', body: 'Edit it as you like' });
      } else {
        addNotification({ type: 'email_failed', title: 'Generation failed', body: 'Empty response' });
      }
    } catch (e) {
      addNotification({ type: 'email_failed', title: 'Generation failed', body: 'Network error' });
    } finally {
      setGeneratingCaption(false);
    }
  }

  function deletePost(id: string) {
    if (!confirm('Delete this post?')) return;
    saveAndSet(posts.filter(p => p.id !== id));
  }

  // ============================================================================
  // Publish
  // ============================================================================
  async function publishPost(post: SocialPost) {
    setPublishing(true);
    const results: Record<string, PostResult> = {};
    for (const accountId of post.accountIds) {
      results[accountId] = { status: 'pending' };
    }
    setConfirmPublish({ ...post, results, status: 'publishing' });

    // Sort to ensure deterministic order: linkedin -> facebook -> instagram
    const order: Record<string, number> = { linkedin: 0, facebook: 1, instagram: 2 };
    const sorted = [...post.accountIds].sort((a, b) => {
      const aA = accounts.find(x => x.id === a);
      const aB = accounts.find(x => x.id === b);
      return (order[aA?.platform || ''] ?? 9) - (order[aB?.platform || ''] ?? 9);
    });

    for (const accountId of sorted) {
      const acc = accounts.find(x => x.id === accountId);
      if (!acc) {
        results[accountId] = { status: 'failed', error: 'Account not found' };
        setConfirmPublish(c => c ? { ...c, results: { ...results } } : c);
        continue;
      }
      results[accountId] = { status: 'publishing' };
      setConfirmPublish(c => c ? { ...c, results: { ...results } } : c);

      try {
        const res = await fetch('/api/social/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId,
            platform: acc.platform,
            caption: post.caption,
            imageUrl: post.imageUrl,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          results[accountId] = { status: 'published', postId: data.postId, postUrl: data.postUrl };
          addNotification({ type: 'success', title: 'Published', body: `${acc.handle} on ${acc.platform}` });
        } else {
          results[accountId] = { status: 'failed', error: data.error || 'Publish failed' };
          addNotification({ type: 'email_failed', title: 'Publish failed', body: `${acc.handle}: ${data.error || 'unknown error'}` });
        }
      } catch (e: any) {
        results[accountId] = { status: 'failed', error: e?.message || 'Network error' };
        addNotification({ type: 'email_failed', title: 'Publish failed', body: `${acc.handle}: network error` });
      }
      setConfirmPublish(c => c ? { ...c, results: { ...results } } : c);
    }

    // Final post status
    const allResults = Object.values(results);
    const allPublished = allResults.every(r => r.status === 'published');
    const anyPublished = allResults.some(r => r.status === 'published');
    const finalStatus: SocialPost['status'] = allPublished ? 'published' : anyPublished ? 'partial' : 'failed';

    const updated: SocialPost = { ...post, results, status: finalStatus };
    const next = posts.find(x => x.id === post.id) ? posts.map(p => p.id === post.id ? updated : p) : [updated, ...posts];
    saveAndSet(next);

    setPublishing(false);
    // Keep confirm modal open briefly so user sees results
    setTimeout(() => setConfirmPublish(null), 1800);
  }

  // ============================================================================
  // AI Generator
  // ============================================================================
  async function generate() {
    setGenerating(true);
    const selectedAccounts = accounts.filter(a => genForm.accountIds.includes(a.id));
    if (!selectedAccounts.length) { setGenerating(false); return; }

    const brief = briefs.find(b => b.id === genForm.briefId);
    const goalLabel = getGoalLabel(genForm.goal);

    try {
      for (const acc of selectedAccounts) {
        const audience = acc.toneOverride || brief?.audience || '';
        const tone = acc.toneOverride || brief?.tone || '';
        const contentBrief = acc.contentBriefOverride || brief?.contentBrief || '';
        const hashtags = acc.hashtagsOverride || brief?.hashtags || '';

        const prompt = `You are writing ${genForm.postsPerAccount} social media posts for ${acc.handle} (${acc.platform}${acc.region ? ' · ' + acc.region : ''}).

Brand context:
- Audience: ${audience}
- Tone: ${tone}
- Content focus: ${contentBrief}
- Hashtags to use: ${hashtags}

Theme / topic for this batch: ${genForm.theme}
${goalLabel ? 'Goal of these posts: ' + goalLabel : ''}

Return EXACTLY ${genForm.postsPerAccount} posts as a JSON array. Each post is an object with one field: "caption". No other text or markdown — just valid JSON like: [{"caption":"..."},{"caption":"..."}]`;

        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], model: 'claude-sonnet-4-5' }),
        });
        const data = await res.json();
        const txt = data.content?.[0]?.text || data.text || '';
        let generated: { caption: string }[] = [];
        try {
          const cleaned = txt.replace(/```json|```/g, '').trim();
          generated = JSON.parse(cleaned);
        } catch {
          // Fallback: split text into lines
          generated = txt.split('\n\n').filter(Boolean).slice(0, genForm.postsPerAccount).map((s: string) => ({ caption: s.trim() }));
        }

        const start = new Date(genForm.weekStart);
        const newPosts: SocialPost[] = generated.slice(0, genForm.postsPerAccount).map((g, i) => {
          const dt = new Date(start);
          dt.setDate(dt.getDate() + i * 2);
          dt.setHours(10 + (i % 3) * 2, 0, 0, 0);
          return {
            id: 'p' + Date.now() + Math.random(),
            briefId: genForm.briefId,
            accountIds: [acc.id],
            caption: g.caption || '',
            scheduledAt: dt.toISOString(),
            status: 'draft' as const,
            createdAt: new Date().toISOString(),
            imageUrl: '',
            imageCredit: '',
          };
        });

        const next = [...newPosts, ...posts];
        saveAndSet(next);
      }
      addNotification({ type: 'info', title: 'Content generated', body: `${selectedAccounts.length} account${selectedAccounts.length === 1 ? '' : 's'} · theme: ${genForm.theme}` });
      setShowGen(false);
    } catch (e: any) {
      addNotification({ type: 'email_failed', title: 'Generation failed', body: e?.message || 'Unknown error' });
    } finally {
      setGenerating(false);
    }
  }

  // ============================================================================
  // Filters & derived data
  // ============================================================================
  const filtered = posts.filter(p => {
    if (platFilter !== 'all') {
      const has = p.accountIds.some(id => accounts.find(a => a.id === id)?.platform === platFilter);
      if (!has) return false;
    }
    if (acctFilter !== 'all' && !p.accountIds.includes(acctFilter)) return false;
    return true;
  });

  const scheduled = filtered.filter(p => p.status === 'scheduled');
  const drafts = filtered.filter(p => p.status === 'draft');
  const published = filtered.filter(p => p.status === 'published' || p.status === 'partial');

  function postsForDay(day: number) {
    return filtered.filter(p => {
      const d = new Date(p.scheduledAt);
      return d.getDate() === day && d.getMonth() === calM && d.getFullYear() === calY;
    });
  }

  // Calendar grid: array of day numbers (or null) starting on Monday
  const firstDay = new Date(calY, calM, 1);
  let firstDow = firstDay.getDay() - 1; if (firstDow < 0) firstDow = 6;
  const daysInMonth = new Date(calY, calM + 1, 0).getDate();
  const calDays: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(d);
  while (calDays.length < 42) calDays.push(null);

  // ============================================================================
  // Sub-components
  // ============================================================================
  function PostPill({ post }: { post: SocialPost }) {
    const accs = post.accountIds.map(id => accounts.find(a => a.id === id)).filter(Boolean) as SocialAccount[];
    const primary = accs[0];
    if (!primary) return null;
    return (
      <div onClick={e => { e.stopPropagation(); openComposer(post); }} style={{
        background: primary.color + '22', borderLeft: `3px solid ${primary.color}`,
        padding: '3px 6px', marginBottom: 2, borderRadius: 'var(--r-sm)',
        fontSize: 10, color: 'var(--ink-700)', display: 'flex', alignItems: 'center', gap: 4,
        cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      }}>
        <PlatformIcon platform={primary.platform} size={9} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{primary.handle}{accs.length > 1 ? ` +${accs.length - 1}` : ''}</span>
      </div>
    );
  }

  function PostRow({ post }: { post: SocialPost }) {
    const accs = post.accountIds.map(id => accounts.find(a => a.id === id)).filter(Boolean) as SocialAccount[];
    const brief = briefs.find(b => b.id === post.briefId);
    return (
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--ink-100)', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            {brief && <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: brief.color + '15', fontSize: 10, fontWeight: 600, color: brief.color }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: brief.color }} />{brief.name}</div>}
            {accs.map(a => <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--ink-600)' }}><PlatformIcon platform={a.platform} size={10} color={a.color} />{a.handle}</div>)}
            <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>· {new Date(post.scheduledAt).toLocaleDateString()} {new Date(post.scheduledAt).toTimeString().slice(0, 5)}</div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-800)', lineHeight: 1.5, marginBottom: 6, whiteSpace: 'pre-wrap' }}>{post.caption.length > 240 ? post.caption.slice(0, 240) + '…' : post.caption}</div>
          {post.imageUrl && <img src={post.imageUrl} alt="" style={{ width: 100, height: 60, objectFit: 'cover', borderRadius: 'var(--r-sm)' }} />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <button onClick={() => openComposer(post)} style={{ ...btnG, padding: '4px 10px', fontSize: 11 }}><Edit3 size={11} /> Edit</button>
          {(post.status === 'draft' || post.status === 'scheduled') && <button onClick={() => setConfirmPublish(post)} style={{ ...btnP, padding: '4px 10px', fontSize: 11, background: '#0A66C2' }}>Publish</button>}
          <button onClick={() => deletePost(post.id)} style={{ ...btnG, padding: '4px 10px', fontSize: 11, color: 'var(--alert)' }}><Trash2 size={11} /></button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render
  // ============================================================================
  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--ink-400)' }}>Loading…</div>;
  }

  const platforms = ['all', 'instagram', 'facebook', 'linkedin'];
  const pNames: Record<string, string> = { all: 'All', instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn' };
  const activeAccountCount = accounts.filter(a => a.active && a.capabilities.canPost).length;

  // Selected brief in composer + the accounts linked to it
  const composerBrief = briefs.find(b => b.id === form.briefId);
  const composerLinkedAccounts = composerBrief ? accounts.filter(a => a.briefId === composerBrief.id && a.active && a.capabilities.canPost) : [];

  // Selected brief in generator + the accounts linked to it
  const genBrief = briefs.find(b => b.id === genForm.briefId);
  const genLinkedAccounts = genBrief ? accounts.filter(a => a.briefId === genBrief.id && a.active && a.capabilities.canPost) : [];

  return (
    <div style={{ padding: '24px 28px' }}>
      {/* Notifications */}
      {notifications.length > 0 && <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
        {notifications.map(n => (
          <div key={n.id} style={{ background: n.type === 'email_failed' ? '#fef2f2' : n.type === 'success' ? '#e8f5ee' : 'var(--white)', border: `1px solid ${n.type === 'email_failed' ? '#fecaca' : n.type === 'success' ? '#a7f3d0' : 'var(--ink-100)'}`, padding: '10px 14px', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-md)', fontSize: 12 }}>
            <div style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{n.title}</div>
            {n.body && <div style={{ color: 'var(--ink-600)', marginTop: 2 }}>{n.body}</div>}
          </div>
        ))}
      </div>}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--ink-900)', lineHeight: 1 }}>Social Calendar</h1>
          <p style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 5, fontWeight: 500 }}>{scheduled.length} scheduled · {drafts.length} drafts · {published.length} published · {activeAccountCount} accounts</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnG} onClick={() => setShowGen(true)}><Sparkles size={13} /> Generate</button>
          <button style={btnP} onClick={() => openComposer()}><Plus size={13} /> New post</button>
        </div>
      </div>

      {/* Empty state when no accounts */}
      {activeAccountCount === 0 && (
        <div style={{ background: 'var(--white)', borderRadius: 'var(--r-lg)', padding: 32, marginBottom: 16, textAlign: 'center', boxShadow: 'var(--shadow-sm)' }}>
          <AlertTriangle size={28} color="var(--warn)" style={{ margin: '0 auto 12px', display: 'block' }} />
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--ink-700)', marginBottom: 6 }}>No accounts ready to post</h3>
          <p style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 14 }}>Connect a platform on Channels, then assign briefs on Social Accounts.</p>
          <a href="/channels" style={{ ...btnP, textDecoration: 'none' }}>Go to Channels</a>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Scheduled', value: scheduled.length, color: 'var(--ok)' },
          { label: 'Drafts', value: drafts.length, color: 'var(--warn)' },
          { label: 'Published', value: published.length, color: 'var(--info)' },
          { label: 'Total', value: posts.length, color: 'var(--ink-700)' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--white)', borderRadius: 'var(--r-md)', padding: '12px 14px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
            <div style={{ fontSize: 28, color: s.color, fontWeight: 700, marginTop: 2 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs + filters */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 2, background: 'var(--ink-100)', borderRadius: 'var(--r-md)', padding: 3 }}>
          {([['calendar', 'Calendar', <Calendar key="c" size={13} />], ['list', 'List', <List key="l" size={13} />]] as [string, string, React.ReactNode][]).map(([id, label, icon]) => (
            <button key={id} onClick={() => setTab(id as 'calendar' | 'list')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 'var(--r-sm)', background: tab === id ? 'var(--white)' : 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: tab === id ? 600 : 400, color: tab === id ? 'var(--ink-900)' : 'var(--ink-500)', boxShadow: tab === id ? 'var(--shadow-sm)' : 'none' }}>{icon}{label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={platFilter} onChange={e => { setPlatFilter(e.target.value); setAcctFilter('all'); }} style={{ ...inp, width: 'auto', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>
            {platforms.map(p => <option key={p} value={p}>{pNames[p]} platforms</option>)}
          </select>
          <select value={acctFilter} onChange={e => setAcctFilter(e.target.value)} style={{ ...inp, width: 'auto', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>
            <option value="all">All accounts</option>
            {accounts.filter(a => platFilter === 'all' || a.platform === platFilter).map(a => (
              <option key={a.id} value={a.id}>{a.handle}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Calendar view */}
      {tab === 'calendar' && (
        <div style={{ background: 'var(--white)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--ink-100)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink-900)' }}>{MONTHS[calM]} {calY}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => { if (calM === 0) { setCalM(11); setCalY(y => y - 1); } else setCalM(m => m - 1); }} style={{ ...btnG, padding: '5px 10px' }}><ChevronLeft size={14} /></button>
              <button onClick={() => { setCalM(today.getMonth()); setCalY(today.getFullYear()); }} style={{ ...btnG, padding: '5px 10px', fontSize: 11 }}>Today</button>
              <button onClick={() => { if (calM === 11) { setCalM(0); setCalY(y => y + 1); } else setCalM(m => m + 1); }} style={{ ...btnG, padding: '5px 10px' }}><ChevronRight size={14} /></button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid var(--ink-100)' }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} style={{ padding: 8, textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
            {calDays.map((day, i) => {
              const isToday = day === today.getDate() && calM === today.getMonth() && calY === today.getFullYear();
              const dp = day ? postsForDay(day) : [];
              return (
                <div key={i} style={{ minHeight: 88, padding: 5, borderRight: i % 7 !== 6 ? '1px solid var(--ink-100)' : 'none', borderBottom: i < 35 ? '1px solid var(--ink-100)' : 'none', background: isToday ? 'var(--maroon-50)' : 'var(--white)', cursor: day ? 'pointer' : 'default' }} onClick={() => { if (day) { setForm(f => ({ ...f, scheduledDate: calY + '-' + String(calM + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0') })); openComposer(); } }}>
                  {day && (<>
                    <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--maroon-700)' : 'var(--ink-400)', marginBottom: 3 }}>{day}{isToday && <span style={{ marginLeft: 4, fontSize: 9, background: 'var(--maroon-700)', color: 'white', padding: '1px 5px', borderRadius: 'var(--r-pill)' }}>today</span>}</div>
                    {dp.slice(0, 3).map(p => <PostPill key={p.id} post={p} />)}
                    {dp.length > 3 && <div style={{ fontSize: 9, color: 'var(--ink-400)' }}>+{dp.length - 3}</div>}
                  </>)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* List view */}
      {tab === 'list' && (
        <div style={{ background: 'var(--white)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <Calendar size={32} color="var(--ink-200)" style={{ margin: '0 auto 12px', display: 'block' }} />
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink-700)', marginBottom: 8 }}>No posts yet</div>
              <div style={{ fontSize: 12, color: 'var(--ink-400)', marginBottom: 16 }}>Create your first post or generate with AI</div>
              <button style={btnP} onClick={() => setShowGen(true)}><Sparkles size={13} /> Generate with AI</button>
            </div>
          ) : (<>
            {scheduled.length > 0 && <><div style={{ padding: '9px 18px', background: '#e8f5ee', borderBottom: '1px solid var(--ink-100)', fontSize: 11, fontWeight: 600, color: 'var(--ok)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={12} />Scheduled ({scheduled.length})</div>{scheduled.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()).map(p => <PostRow key={p.id} post={p} />)}</>}
            {drafts.length > 0 && <><div style={{ padding: '9px 18px', background: 'var(--paper)', borderBottom: '1px solid var(--ink-100)', fontSize: 11, fontWeight: 600, color: 'var(--warn)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 6 }}><Edit3 size={12} />Drafts ({drafts.length})</div>{drafts.map(p => <PostRow key={p.id} post={p} />)}</>}
            {published.length > 0 && <><div style={{ padding: '9px 18px', background: 'var(--paper)', borderBottom: '1px solid var(--ink-100)', fontSize: 11, fontWeight: 600, color: 'var(--info)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 6 }}><Check size={12} />Published ({published.length})</div>{published.map(p => <PostRow key={p.id} post={p} />)}</>}
          </>)}
        </div>
      )}

      {/* Confirm publish modal */}
      {confirmPublish && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,13,18,0.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget && !publishing) setConfirmPublish(null); }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--r-lg)', width: 'min(480px,100%)', padding: 24, boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--ink-900)' }}>Publish post?</h2>
            <p style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 16 }}>This will post to {confirmPublish.accountIds.length} account{confirmPublish.accountIds.length === 1 ? '' : 's'} immediately.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, maxHeight: 240, overflowY: 'auto' }}>
              {accounts.filter(a => confirmPublish.accountIds.includes(a.id)).sort((a, b) => {
                const o: Record<string, number> = { linkedin: 0, facebook: 1, instagram: 2 };
                return (o[a.platform] || 9) - (o[b.platform] || 9);
              }).map(a => {
                const r = confirmPublish.results?.[a.id];
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 'var(--r-md)', background: 'var(--paper)', border: `1px solid ${a.color}33` }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: a.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                      <PlatformIcon platform={a.platform} size={12} color="#fff" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{a.handle}</div>
                      <div style={{ fontSize: 10, color: 'var(--ink-400)', textTransform: 'capitalize' }}>{a.platform}</div>
                    </div>
                    {r?.status === 'published' && <Check size={16} color="var(--ok)" />}
                    {r?.status === 'publishing' && <div style={{ fontSize: 11, color: 'var(--info)' }}>Posting…</div>}
                    {r?.status === 'failed' && <div style={{ fontSize: 11, color: 'var(--alert)' }} title={r.error}>Failed</div>}
                    {!r && <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>Pending</div>}
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: 'var(--ink-400)', marginBottom: 16 }}>Posts are sent in order: LinkedIn → Facebook → Instagram.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { if (!publishing) setConfirmPublish(null); }} disabled={publishing} style={btnG}>Cancel</button>
              <button onClick={() => publishPost(confirmPublish)} disabled={publishing} style={{ ...btnP, opacity: publishing ? 0.6 : 1 }}>
                {publishing ? 'Publishing…' : 'Confirm & publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Composer modal */}
      {showComposer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,13,18,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setShowComposer(false); }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--r-xl)', width: 580, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--ink-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink-900)' }}>{editPost ? 'Edit post' : 'New post'}</div>
              <button onClick={() => setShowComposer(false)} style={{ ...btnG, padding: '4px 8px' }}><X size={14} /></button>
            </div>

            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
              {/* Brief picker */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>1. Choose brief</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                  {briefs.filter(b => b.active).map(b => {
                    const isSel = form.briefId === b.id;
                    return (
                      <button key={b.id} type="button" onClick={() => setForm({ ...form, briefId: b.id, accountIds: [] })} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 'var(--r-md)', border: `1.5px solid ${isSel ? b.color : 'var(--ink-200)'}`, background: isSel ? b.color + '15' : 'var(--white)', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: b.color, flexShrink: 0 }} />
                          <div style={{ fontSize: 12, fontWeight: 600, color: isSel ? b.color : 'var(--ink-900)' }}>{b.name}</div>
                          {isSel && <Check size={13} color={b.color} style={{ marginLeft: 'auto' }} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Platforms within brief */}
              {composerBrief && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>2. Choose accounts</div>
                    <button type="button" onClick={() => setForm({ ...form, accountIds: composerLinkedAccounts.map(a => a.id) })} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 11, color: 'var(--maroon-700)', cursor: 'pointer', fontWeight: 500, padding: 0 }}>Select all</button>
                    <button type="button" onClick={() => setForm({ ...form, accountIds: [] })} style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--ink-500)', cursor: 'pointer', fontWeight: 500, padding: 0, marginLeft: 8 }}>Clear</button>
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-400)' }}>{form.accountIds.length} selected</span>
                  </div>
                  {composerLinkedAccounts.length === 0 ? (
                    <div style={{ padding: 16, background: 'var(--paper)', borderRadius: 'var(--r-md)', fontSize: 12, color: 'var(--ink-500)', textAlign: 'center' }}>
                      No accounts linked to this brief. Go to <a href="/accounts" style={{ color: 'var(--maroon-700)', fontWeight: 600 }}>Social Accounts</a> and assign accounts to <strong>{composerBrief.name}</strong>.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                      {composerLinkedAccounts.map(a => {
                        const selected = form.accountIds.includes(a.id);
                        return (
                          <button key={a.id} type="button" onClick={() => setForm({ ...form, accountIds: selected ? form.accountIds.filter(x => x !== a.id) : [...form.accountIds, a.id] })} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 'var(--r-md)', border: `1.5px solid ${selected ? a.color : 'var(--ink-200)'}`, background: selected ? a.color + '15' : 'var(--white)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                            <div style={{ width: 24, height: 24, borderRadius: '50%', background: a.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                              <PlatformIcon platform={a.platform} size={12} color="#fff" />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: selected ? a.color : 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.handle}</div>
                              <div style={{ fontSize: 10, color: 'var(--ink-400)', textTransform: 'capitalize' }}>{a.platform}{a.region ? ` · ${a.region}` : ''}</div>
                            </div>
                            {selected && <Check size={13} color={a.color} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Tone hint */}
              {form.accountIds.length > 0 && (() => {
                const first = accounts.find(a => a.id === form.accountIds[0]);
                if (!first) return null;
                const tone = first.toneOverride || first.brief?.tone;
                if (!tone) return null;
                return <div style={{ padding: '8px 12px', background: 'var(--paper)', borderRadius: 'var(--r-sm)', fontSize: 11, color: 'var(--ink-500)', lineHeight: 1.5 }}><strong style={{ color: 'var(--ink-700)' }}>Tone:</strong> {tone}</div>;
              })()}

              {/* Context + status */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Context <span style={{ fontWeight: 400, color: 'var(--ink-400)' }}>(optional)</span></label>
                  <input value={form.town} onChange={e => setForm({ ...form, town: e.target.value })} placeholder="e.g. Whitstable" style={inp} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as SocialPost['status'] })} style={{ ...inp, cursor: 'pointer' }}>
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                  </select>
                </div>
              </div>

              {/* Caption */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Caption</label>
                  <button type="button" onClick={generateCaptionForComposer} disabled={generatingCaption || !form.briefId || form.accountIds.length === 0} style={{ background: 'none', border: 'none', fontSize: 11, color: !form.briefId || form.accountIds.length === 0 ? 'var(--ink-300)' : 'var(--maroon-700)', cursor: !form.briefId || form.accountIds.length === 0 ? 'not-allowed' : 'pointer', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}>
                    <Sparkles size={11} />{generatingCaption ? 'Generating…' : 'Generate with AI'}
                  </button>
                </div>
                <textarea value={form.caption} onChange={e => setForm({ ...form, caption: e.target.value })} placeholder="Write your post caption... or click Generate above" rows={4} style={{ ...inp, resize: 'vertical' }} />
                <div style={{ fontSize: 10, color: 'var(--ink-400)', marginTop: 3, textAlign: 'right' }}>{form.caption.length} chars</div>
              </div>

              {/* Image */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Image</label>
                  <input type="text" value={unsplashQuery} onChange={e => setUnsplashQuery(e.target.value)} placeholder={'Search Unsplash... e.g. ' + (form.town || 'coastal market')} style={{ flex: 1, padding: '6px 10px', border: '1.5px solid var(--ink-200)', borderRadius: 'var(--r-sm)', fontSize: 12, fontFamily: 'inherit' }} />
                  {searchingImgs && <span style={{ fontSize: 10, color: 'var(--ink-400)' }}>Searching…</span>}
                  <label style={{ ...btnG, padding: '5px 10px', fontSize: 11, gap: 4, flexShrink: 0, cursor: 'pointer' }}>
                    Upload
                    <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) uploadOwnImage(f); e.currentTarget.value = ''; }} style={{ display: 'none' }} />
                  </label>
                </div>
                {form.imageUrl && <div style={{ marginBottom: 8, position: 'relative' }}>
                  <img src={form.imageUrl} style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-100)', display: 'block' }} alt="" />
                  <button onClick={() => setForm({ ...form, imageUrl: '', imageCredit: '' })} style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}><X size={11} /></button>
                  {form.imageCredit && <div style={{ fontSize: 10, color: 'var(--ink-400)', marginTop: 3 }}>Photo by {form.imageCredit} on Unsplash</div>}
                </div>}
                {unsplash.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 8 }}>
                  {unsplash.map((img, i) => (
                    <div key={i} onClick={() => { setForm({ ...form, imageUrl: img.url, imageCredit: img.credit }); setUnsplash([]); setUnsplashQuery(''); }} style={{ cursor: 'pointer', borderRadius: 'var(--r-sm)', overflow: 'hidden', border: '2px solid ' + (form.imageUrl === img.url ? 'var(--maroon-700)' : 'transparent'), position: 'relative' }}>
                      <img src={img.thumb} style={{ width: '100%', height: 65, objectFit: 'cover', display: 'block' }} alt="" />
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '2px 5px', background: 'rgba(0,0,0,0.5)', fontSize: 9, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.credit}</div>
                    </div>
                  ))}
                </div>}
                {!form.imageUrl && unsplash.length === 0 && (
                  <div style={{ background: 'var(--paper)', borderRadius: 'var(--r-md)', padding: 16, textAlign: 'center', border: '1.5px dashed var(--ink-200)' }}>
                    <Image size={18} color="var(--ink-300)" style={{ margin: '0 auto 6px', display: 'block' }} />
                    <div style={{ fontSize: 11, color: 'var(--ink-400)', marginBottom: 8 }}>Type a keyword above, or paste a URL</div>
                    <input value={form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} placeholder="Paste image URL..." style={{ ...inp, fontSize: 11 }} />
                  </div>
                )}
              </div>

              {/* Date / time */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Date</label>
                  <input type="date" value={form.scheduledDate} onChange={e => setForm({ ...form, scheduledDate: e.target.value })} style={inp} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Time</label>
                  <input type="time" value={form.scheduledTime} onChange={e => setForm({ ...form, scheduledTime: e.target.value })} style={inp} />
                </div>
              </div>
            </div>

            <div style={{ padding: '14px 22px', borderTop: '1px solid var(--ink-100)', display: 'flex', gap: 8, justifyContent: 'flex-end', background: 'var(--white)' }}>
              <button onClick={() => setShowComposer(false)} style={btnG}>Cancel</button>
              <button type="button" onClick={() => {
                if (!form.accountIds.length || !form.caption.trim()) return;
                const np: SocialPost = editPost
                  ? { ...editPost, ...form, scheduledAt: new Date(form.scheduledDate + 'T' + form.scheduledTime).toISOString() }
                  : { id: 'p' + Date.now(), briefId: form.briefId, accountIds: form.accountIds, town: form.town, caption: form.caption, imageUrl: form.imageUrl, imageCredit: form.imageCredit, scheduledAt: new Date(form.scheduledDate + 'T' + form.scheduledTime).toISOString(), status: 'draft', createdAt: new Date().toISOString() };
                if (!editPost) saveAndSet([np, ...posts]);
                setShowComposer(false);
                setConfirmPublish(np);
              }} disabled={!form.caption.trim() || !form.accountIds.length || !form.briefId} style={{ ...btnP, background: '#0A66C2', opacity: (!form.caption.trim() || !form.accountIds.length || !form.briefId) ? 0.5 : 1 }}>Publish Now</button>
              <button onClick={savePost} disabled={!form.caption.trim() || !form.accountIds.length || !form.briefId} style={{ ...btnP, opacity: (!form.caption.trim() || !form.accountIds.length || !form.briefId) ? 0.5 : 1 }}><Check size={13} />{editPost ? 'Save changes' : 'Create post'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Generator modal */}
      {showGen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,13,18,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setShowGen(false); }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--r-xl)', width: 500, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--ink-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Sparkles size={16} color="var(--maroon-600)" /><div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink-900)' }}>Generate with AI</div></div>
              <button onClick={() => setShowGen(false)} style={{ ...btnG, padding: '4px 8px' }}><X size={14} /></button>
            </div>

            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
              {/* Brief picker */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Choose brief</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
                  {briefs.filter(b => b.active).map(b => {
                    const isSel = genForm.briefId === b.id;
                    return (
                      <button key={b.id} type="button" onClick={() => setGenForm({ ...genForm, briefId: b.id, accountIds: [] })} style={{ padding: '8px 10px', borderRadius: 'var(--r-sm)', border: `1.5px solid ${isSel ? b.color : 'var(--ink-200)'}`, background: isSel ? b.color + '15' : 'var(--white)', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: isSel ? b.color : 'var(--ink-900)', fontFamily: 'inherit', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: b.color }} />{b.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Theme */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>What's this about? <span style={{ color: 'var(--alert)' }}>*</span></label>
                <input value={genForm.theme} onChange={e => setGenForm({ ...genForm, theme: e.target.value })} placeholder="e.g. summer harbour markets in Whitstable" style={inp} />
              </div>

              {/* Goal */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Goal <span style={{ fontWeight: 400, color: 'var(--ink-400)', textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                <select value={genForm.goal} onChange={e => setGenForm({ ...genForm, goal: e.target.value })} style={{ ...inp, background: 'var(--white)', cursor: 'pointer' }}>
                  <option value="">— Choose a goal —</option>
                  {GOAL_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.label} — {g.description}</option>)}
                </select>
              </div>

              {/* Accounts for this brief */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Generate for accounts</label>
                {!genForm.briefId ? (
                  <div style={{ padding: 16, background: 'var(--paper)', borderRadius: 'var(--r-md)', fontSize: 12, color: 'var(--ink-500)', textAlign: 'center' }}>
                    Pick a brief above to see linked accounts.
                  </div>
                ) : genLinkedAccounts.length === 0 ? (
                  <div style={{ padding: 16, background: 'var(--paper)', borderRadius: 'var(--r-md)', fontSize: 12, color: 'var(--ink-500)', textAlign: 'center' }}>
                    No accounts linked to <strong>{genBrief?.name}</strong>. Go to <a href="/accounts" style={{ color: 'var(--maroon-700)', fontWeight: 600 }}>Social Accounts</a> to assign accounts to this brief.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {genLinkedAccounts.map(a => {
                      const checked = genForm.accountIds.includes(a.id);
                      return (
                        <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 12px', borderRadius: 'var(--r-md)', border: `1.5px solid ${checked ? a.color : 'var(--ink-200)'}`, background: checked ? a.color + '12' : 'var(--white)' }}>
                          <input type="checkbox" checked={checked} onChange={e => setGenForm({ ...genForm, accountIds: e.target.checked ? [...genForm.accountIds, a.id] : genForm.accountIds.filter(id => id !== a.id) })} style={{ accentColor: a.color, width: 14, height: 14 }} />
                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: a.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><PlatformIcon platform={a.platform} size={12} color="#fff" /></div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: checked ? a.color : 'var(--ink-900)' }}>{a.handle}</div>
                            <div style={{ fontSize: 10, color: 'var(--ink-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(a.toneOverride || a.brief?.tone || '').slice(0, 60)}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Schedule */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Posts per account</label>
                  <select value={genForm.postsPerAccount} onChange={e => setGenForm({ ...genForm, postsPerAccount: Number(e.target.value) })} style={{ ...inp, cursor: 'pointer' }}>
                    <option value={2}>2 posts</option><option value={3}>3 posts</option><option value={5}>5 posts</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Week starting</label>
                  <input type="date" value={genForm.weekStart} onChange={e => setGenForm({ ...genForm, weekStart: e.target.value })} style={inp} />
                </div>
              </div>

              <div style={{ background: 'var(--maroon-50)', borderRadius: 'var(--r-md)', padding: '10px 12px', fontSize: 11, color: 'var(--maroon-700)', lineHeight: 1.5 }}>
                Roam-io will write in each account's specific voice using their strategy brief. All posts start as drafts.
              </div>
            </div>

            <div style={{ padding: '14px 22px', borderTop: '1px solid var(--ink-100)', display: 'flex', gap: 8, justifyContent: 'flex-end', background: 'var(--white)' }}>
              <button onClick={() => setShowGen(false)} style={btnG}>Cancel</button>
              <button onClick={generate} disabled={generating || !genForm.briefId || !genForm.accountIds.length || !genForm.theme.trim()} style={{ ...btnP, opacity: (generating || !genForm.briefId || !genForm.accountIds.length || !genForm.theme.trim()) ? 0.6 : 1 }}>
                <Sparkles size={13} />{generating ? 'Generating...' : 'Generate for ' + genForm.accountIds.length + ' account' + (genForm.accountIds.length === 1 ? '' : 's')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
