'use client';
import { useState, useEffect } from 'react';
import { AlertTriangle, Calendar, Check, ChevronLeft, ChevronRight, Clock, Copy, Edit3, Image, List, Plus, RefreshCw, Settings, Sparkles, Trash2, WrapText, X } from 'lucide-react';
import { Brief, fetchBriefs } from '@/lib/briefs';
import { GOAL_OPTIONS, getGoalLabel } from '@/lib/goals';
import { SocialAccount, fetchRealAccounts, combineAccounts, fetchAccountMeta } from '@/lib/social-accounts';
import { loadWithMigration, saveRemote } from '@/lib/client-store';
import { buildUnsplashCredit } from '@/lib/unsplash-credit';
import BrainPicker from '@/components/BrainPicker';
import type { BrainItem } from '@/lib/brain';
// SOCIAL-NOTIFS-V1: persistent notifications for the bell + dashboard.
// Aliased to avoid colliding with the local addNotification toast helper.
import { addNotification as addPersistentNotification } from '@/components/NotificationCentre';

// VOICE-RULES-V1: shared voice + format rules for AI post generation.
// One source of truth so the modal-button prompt and the bulk-generate
// prompt never drift apart. Tweak the spec here, both flows update.
function buildVoiceRules(platform: string): string {
  const lengthByPlatform: Record<string, string> = {
    linkedin: '80-120 words',
    facebook: '50-80 words',
    instagram: '40-60 words',
  };
  const targetLength = lengthByPlatform[platform.toLowerCase()] || '60-90 words';

  return `VOICE & FORMAT RULES (follow strictly):

- Length: ${targetLength}. Strict ceiling — do not exceed.
- Short, punchy sentences. Strip every word that isn't pulling weight.
- Fact-driven, but DO NOT invent statistics, percentages, or studies. No "76% of customers..." or "research shows...". If you need a fact, use observed behaviour, lived patterns, or what's plainly true ("People decide in seconds. They want photos and hours, not a tagline.").
- Personal and charming, never corporate or hype-y. Think witty friend who happens to know the industry — not a brand consultant.
- No bullshit, no buzzwords, no "in today's fast-paced world", no "game-changing", no "unlock your potential".
- Format: short paragraphs separated by ONE BLANK LINE between them. Two or three paragraphs maximum. Easy to skim.
- First sentence is a hook — a fact, a question, a sharp observation. Not a greeting.
- End with one clear thing for the reader to do or notice — not a stack of CTAs.
- Emojis: zero or one. If used, only when it actually adds something. Never as bullet points or section headers.`;
}



// ============================================================================
// Storage — posts now live in the per-user server store (Netlify Blobs).
// One-time migration from the legacy localStorage key happens automatically
// via lib/client-store on first load.
// ============================================================================

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
  // Full Unsplash attribution captured at photo-pick time. These survive
  // draft persistence so they can be appended to the caption at publish
  // time — Unsplash requires both photographer + Unsplash crediting *in
  // the post text* on social re-posts.
  imageCreditUrl?: string;     // photographer's Unsplash profile (with UTM)
  imageUnsplashUrl?: string;   // https://unsplash.com (with UTM)
  imagePhotoUrl?: string;      // link to the specific photo on Unsplash (with UTM)
  imageSocialHandles?: { instagram?: string | null; twitter?: string | null; unsplash?: string | null };
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
// Posts persistence — wraps the server store. fetchPosts also runs the
// one-time legacy localStorage migration so existing data isn't lost.
// ============================================================================
async function fetchPosts(): Promise<SocialPost[]> {
  const data = await loadWithMigration<SocialPost[]>('social_posts');
  return Array.isArray(data) ? data : [];
}

async function savePosts(posts: SocialPost[]): Promise<void> {
  await saveRemote('social_posts', posts);
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

// Format a Date's local Y-M-D and H:M so they round-trip through the composer
// inputs without timezone drift. toISOString() returns UTC date components,
// which silently shifted scheduledAt by ±24h on edit when the user's local
// date didn't match the UTC date.
const pad2 = (n: number) => String(n).padStart(2, '0');
const localDateStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const localTimeStr = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

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

  // Drag-and-drop: which day index (0-41 in calDays) is being hovered as a drop target
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const [showComposer, setShowComposer] = useState(false);
  const [editPost, setEditPost] = useState<SocialPost | null>(null);
  const [form, setForm] = useState({
    briefId: '', accountIds: [] as string[],
    caption: '', town: '',
    imageUrl: '', imageCredit: '',
    // Full Unsplash attribution fields carried through the composer so the
    // download ping fires at pick-time and the credit is preserved through
    // save → publish (Unsplash compliance — photographer profile + Unsplash
    // links with UTMs, plus social handles for @-tagging at publish).
    imageCreditUrl: '', imageUnsplashUrl: '', imagePhotoUrl: '',
    imageSocialHandles: {} as { instagram?: string|null; twitter?: string|null; unsplash?: string|null },
    scheduledDate: localDateStr(today),
    scheduledTime: '10:00',
    status: 'draft' as SocialPost['status'],
  });

  const [showGen, setShowGen] = useState(false);
  // CRON-AUTOGEN-V1
  const [fillingCalendar, setFillingCalendar] = useState(false);
  const [genForm, setGenForm] = useState({
    briefId: '', accountIds: [] as string[],
    theme: '', goal: '',
    postsPerAccount: 3,
    weekStart: localDateStr(today),
  });
  const [generating, setGenerating] = useState(false);
  const [generatingCaption, setGeneratingCaption] = useState(false);
  const [expandingCaption, setExpandingCaption] = useState(false);
  const [showBrainPicker, setShowBrainPicker] = useState(false);
  const [swappingPostId, setSwappingPostId] = useState<string | null>(null);

  const [unsplash, setUnsplash] = useState<{
    url: string;
    thumb: string;
    credit: string;
    creditUrl?: string;
    photoUrl?: string;
    unsplashUrl?: string;
    downloadLocation?: string;
    socialHandles?: { instagram?: string|null; twitter?: string|null; unsplash?: string|null };
  }[]>([]);
  const [unsplashQuery, setUnsplashQuery] = useState('');
  const [searchingImgs, setSearchingImgs] = useState(false);

  const [confirmPublish, setConfirmPublish] = useState<SocialPost | null>(null);
  const [publishing, setPublishing] = useState(false);

  const [notifications, setNotifications] = useState<Notification[]>([]);

  // BULK-SELECT-V1 — multi-select + bulk delete
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // MOBILE-CAL-UX-V1 — viewport-aware behavior switch for the calendar grid.
  // The phone layout swaps post pills for colored dots and opens a day-detail
  // bottom sheet on cell tap (instead of jumping straight to the composer),
  // so users can actually read what's scheduled before editing.
  const [isMobile, setIsMobile] = useState(false);
  const [daySheet, setDaySheet] = useState<{ y: number; m: number; d: number } | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 640px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Click-outside to close the mobile header overflow menu.
  useEffect(() => {
    if (!headerMenuOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.soc-header-actions')) setHeaderMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [headerMenuOpen]);

  function addNotification(n: Omit<Notification, 'id' | 'ts'>) {
    const note: Notification = { ...n, id: 't' + Date.now() + Math.random(), ts: Date.now() };
    setNotifications(ns => [note, ...ns].slice(0, 5));
    setTimeout(() => setNotifications(ns => ns.filter(x => x.id !== note.id)), 6000);
  }

  // Load accounts + briefs + posts on mount
  useEffect(() => {
    (async () => {
      const [real, briefsData, postsData, accountMeta] = await Promise.all([
        fetchRealAccounts(),
        fetchBriefs(),
        fetchPosts(),
        fetchAccountMeta(),
      ]);
      setBriefs(briefsData);
      setAccounts(combineAccounts(real, briefsData, accountMeta));
      setPosts(postsData);
      setLoading(false);
    })();
  }, []);

  // PUBLISH-UI-V1: while any post is in-flight (scheduled or publishing),
  // refetch social_posts every 30s. The cron updates these statuses on the
  // server but the social page only loads on mount, so without polling the
  // user has to manually refresh to see the result. Effect tears itself down
  // when there's nothing pending, so it costs nothing on idle pages.
  //
  // PUBLISH-NOTIFS-V2: also fire bell notifications on transitions from
  // in-flight (scheduled/publishing) to terminal (published/partial/failed)
  // so cron-driven successes and failures surface in the notification
  // centre the same way manual "Publish Now" does. Uses the same dedupeKey
  // shape as the manual path (publishPost in this file) so a race between
  // manual and cron publishing for the same post can't double-fire.
  useEffect(() => {
    const hasPending = posts.some(p => p.status === 'scheduled' || p.status === 'publishing');
    if (!hasPending) return;
    const interval = setInterval(async () => {
      const fresh = await fetchPosts();
      // Only update if a status actually changed — avoids re-render churn
      // when the cron has no work to do.
      setPosts(prev => {
        // Build a quick lookup of previous statuses by post id so we can
        // detect transitions regardless of array ordering or length.
        const prevById = new Map(prev.map(p => [p.id, p.status]));
        for (const np of fresh) {
          const before = prevById.get(np.id);
          // Only fire on the FIRST observed transition from in-flight to
          // a terminal state. Subsequent polls find the same terminal
          // status and the dedupeKey blocks duplicate notifications.
          const wasPending = before === 'scheduled' || before === 'publishing';
          const isTerminal = np.status === 'published' || np.status === 'partial' || np.status === 'failed';
          if (!wasPending || !isTerminal) continue;

          const captionPreview = np.caption.trim().slice(0, 60) + (np.caption.length > 60 ? '…' : '');
          const results = np.results || {};
          const successCount = Object.values(results).filter((r: any) => r.status === 'published').length;
          const failCount = Object.values(results).filter((r: any) => r.status === 'failed').length;

          if (np.status === 'published') {
            addPersistentNotification({
              type: 'social_published',
              title: `Post published to ${successCount} account${successCount === 1 ? '' : 's'}`,
              body: captionPreview,
              href: '/social',
              dedupeKey: 'social_published:' + np.id,
            });
          } else if (np.status === 'partial') {
            addPersistentNotification({
              type: 'social_publish_failed',
              title: `Partial publish · ${successCount} ok, ${failCount} failed`,
              body: captionPreview,
              href: '/social',
              dedupeKey: 'social_publish_failed:' + np.id,
            });
          } else {
            // np.status === 'failed'
            addPersistentNotification({
              type: 'social_publish_failed',
              title: 'Publish failed',
              body: captionPreview,
              href: '/social',
              dedupeKey: 'social_publish_failed:' + np.id,
            });
          }
        }

        // Status-change check (preserved from the original effect).
        if (prev.length !== fresh.length) return fresh;
        for (let i = 0; i < prev.length; i++) {
          if (prev[i].status !== fresh[i]?.status) return fresh;
        }
        return prev;
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [posts]);

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

  /**
   * Called when the user actually selects a photo from the Unsplash grid.
   * Fires the Unsplash download-tracking ping (compliance requirement —
   * Unsplash needs to count "uses" against the photographer) and stores
   * the full attribution payload in the form so it survives draft save
   * and reaches the publish step where it gets appended to the caption.
   *
   * The download ping is fire-and-forget — failures don't block the
   * user's selection; the photo is still usable, we just won't have
   * credited that download.
   */
  function pickUnsplashPhoto(img: typeof unsplash[number]) {
    setForm({
      ...form,
      imageUrl: img.url,
      imageCredit: img.credit,
      imageCreditUrl: img.creditUrl || '',
      imagePhotoUrl: img.photoUrl || '',
      imageUnsplashUrl: img.unsplashUrl || '',
      imageSocialHandles: img.socialHandles || {},
    });
    setUnsplash([]);
    setUnsplashQuery('');
    if (img.downloadLocation) {
      // No await — keep the picker responsive.
      fetch('/api/images/track-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ downloadLocation: img.downloadLocation }),
      }).catch(err => console.warn('[unsplash] download ping failed:', err));
    }
  }

  function saveAndSet(next: SocialPost[]) {
    setPosts(next);
    savePosts(next);
  }

  // Functional variant — use when the next state depends on prior state and
  // an async boundary sits between the read and the write (publish/generate).
  function updatePosts(updater: (prev: SocialPost[]) => SocialPost[]) {
    setPosts(prev => {
      const next = updater(prev);
      savePosts(next);
      return next;
    });
  }

  // Move a post to a different calendar day (drag-and-drop).
  // Time is reset to 10:00 local. Published / failed / publishing posts are not movable.
  function movePost(postId: string, targetYear: number, targetMonth: number, targetDay: number) {
    updatePosts(prev => prev.map(p => {
      if (p.id !== postId) return p;
      if (p.status !== 'draft' && p.status !== 'scheduled') return p;
      const next = new Date(targetYear, targetMonth, targetDay, 10, 0, 0, 0);
      const current = new Date(p.scheduledAt);
      if (next.getTime() === current.getTime()) return p;
      return { ...p, scheduledAt: next.toISOString() };
    }));
  }

  // DUPLICATE-POST-V1
  // Clone a post into a fresh draft. Used by the Duplicate button on
  // PostRow (list view). The clone keeps caption, accounts, image, brief,
  // and town — but resets status to 'draft', clears any publish results,
  // and sets scheduledAt to now so it visibly lands on today's calendar.
  // User edits and reschedules from there.
  function duplicatePost(post: SocialPost) {
    const clone: SocialPost = {
      id: 'p' + Date.now() + Math.random(),
      briefId: post.briefId,
      accountIds: [...post.accountIds],
      caption: post.caption,
      imageUrl: post.imageUrl,
      imageCredit: post.imageCredit,
      // Carry the Unsplash attribution forward — the duplicate represents
      // a *re-use* of the same photo, which is itself a download event,
      // but Unsplash counts the original pick-time ping. We don't re-ping
      // here (would inflate counts) but we keep the credit so it still
      // gets appended to the caption at publish.
      imageCreditUrl: post.imageCreditUrl,
      imagePhotoUrl: post.imagePhotoUrl,
      imageUnsplashUrl: post.imageUnsplashUrl,
      imageSocialHandles: post.imageSocialHandles,
      town: post.town,
      scheduledAt: new Date().toISOString(),
      status: 'draft',
      createdAt: new Date().toISOString(),
    };
    updatePosts(prev => [clone, ...prev]);
    addNotification({
      type: 'success',
      title: 'Post duplicated',
      body: 'New draft created — edit and reschedule.',
    });
    // SOCIAL-NOTIFS-V1
    addPersistentNotification({
      type: 'social_drafted',
      title: 'Draft created (duplicated)',
      body: clone.caption.trim().slice(0, 60) + (clone.caption.length > 60 ? '…' : ''),
      href: '/social',
      dedupeKey: 'social_drafted:' + clone.id,
    });
  }

  function openComposer(p?: SocialPost, opts?: { defaultDate?: string }) {
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
        imageCreditUrl: p.imageCreditUrl || '',
        imagePhotoUrl: p.imagePhotoUrl || '',
        imageUnsplashUrl: p.imageUnsplashUrl || '',
        imageSocialHandles: p.imageSocialHandles || {},
        scheduledDate: localDateStr(d),
        scheduledTime: localTimeStr(d),
        status: p.status,
      });
    } else {
      setEditPost(null);
      setForm({
        briefId: '', accountIds: [], caption: '', town: '',
        imageUrl: '', imageCredit: '',
        imageCreditUrl: '', imagePhotoUrl: '', imageUnsplashUrl: '', imageSocialHandles: {},
        // opts.defaultDate lets cell-click prefills survive — calling
        // openComposer() unconditionally reset form, so the caller's
        // setForm({scheduledDate}) was wiped a tick later.
        scheduledDate: opts?.defaultDate || localDateStr(today),
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
        imageCreditUrl: form.imageCreditUrl,
        imagePhotoUrl: form.imagePhotoUrl,
        imageUnsplashUrl: form.imageUnsplashUrl,
        imageSocialHandles: form.imageSocialHandles,
        town: form.town,
        scheduledAt,
        status: form.status,
        createdAt: new Date().toISOString(),
      };
      saveAndSet([np, ...posts]);
      // SOCIAL-NOTIFS-V1: persistent notification for the bell.
      const captionPreview = form.caption.trim().slice(0, 60) + (form.caption.length > 60 ? '…' : '');
      if (form.status === 'scheduled') {
        addPersistentNotification({
          type: 'social_scheduled',
          title: 'Post scheduled',
          body: `${captionPreview} · ${new Date(scheduledAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
          href: '/social',
          dedupeKey: 'social_scheduled:' + np.id,
        });
      } else {
        addPersistentNotification({
          type: 'social_drafted',
          title: 'Draft created',
          body: captionPreview,
          href: '/social',
          dedupeKey: 'social_drafted:' + np.id,
        });
      }
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
        // Own upload — clear any prior Unsplash attribution so we don't
        // accidentally credit Unsplash for the user's own image.
        setForm(f => ({ ...f, imageUrl: absUrl, imageCredit: 'Your upload', imageCreditUrl: '', imagePhotoUrl: '', imageUnsplashUrl: '', imageSocialHandles: {} }));
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


  function pickFromBrain(item: BrainItem) {
    const absUrl = window.location.origin + '/api/images/' + item.blobId;
    if (swappingPostId) {
      // Swap mode — update the specific post directly. Clear any prior
      // Unsplash attribution since this image is from the user's Brain,
      // not Unsplash.
      const next = posts.map(p =>
        p.id === swappingPostId
          ? { ...p, imageUrl: absUrl, imageCredit: 'From Brain', imageCreditUrl: undefined, imagePhotoUrl: undefined, imageUnsplashUrl: undefined, imageSocialHandles: undefined }
          : p
      );
      saveAndSet(next);
      setSwappingPostId(null);
      addNotification({ type: 'success', title: 'Image swapped' });
    } else {
      // Composer mode — update the form. Same clear-out rationale.
      setForm(f => ({ ...f, imageUrl: absUrl, imageCredit: 'From Brain', imageCreditUrl: '', imagePhotoUrl: '', imageUnsplashUrl: '', imageSocialHandles: {} }));
      setUnsplash([]);
      setUnsplashQuery('');
      addNotification({ type: 'success', title: 'Image attached from Brain' });
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

${buildVoiceRules(acc.platform)}

Return ONLY the caption text. No JSON, no markdown, no preamble. Just the caption ready to publish.`;

    setGeneratingCaption(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], model: 'claude-sonnet-4-5' }),
      });
      const data = await res.json();
      const txt = (typeof data.content === 'string' ? data.content : (data.content?.[0]?.text || data.text || '')).trim();
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

  // Expand on the existing caption: keep the same message and voice but add
  // depth and length. Unlike generate/regenerate this builds ON the current
  // text rather than starting from the theme, so the strict length ceiling
  // from buildVoiceRules is deliberately relaxed here.
  async function expandCaptionForComposer() {
    const current = form.caption.trim();
    if (!current || form.accountIds.length === 0) return;
    const acc = accounts.find(a => a.id === form.accountIds[0]);
    if (!acc) return;
    const brief = briefs.find(b => b.id === form.briefId);

    const audience = acc.toneOverride || brief?.audience || '';
    const tone = acc.toneOverride || brief?.tone || '';
    const contentBrief = acc.contentBriefOverride || brief?.contentBrief || '';
    const hashtags = acc.hashtagsOverride || brief?.hashtags || '';

    const prompt = `You are expanding an existing social media post for ${acc.handle} (${acc.platform}${acc.region ? ' · ' + acc.region : ''}).

Here is the current caption:
"""
${current}
"""

Expand and enrich it: add more depth, detail and texture while keeping the same core message, angle and voice. Make it noticeably longer (roughly 1.5–2x the current length), but every added sentence must earn its place — no filler or padding.

Brand context:
- Audience: ${audience}
- Tone: ${tone}
- Content focus: ${contentBrief}
- Hashtags to use: ${hashtags}

STYLE RULES (follow strictly):
- Short, punchy sentences. Short paragraphs separated by ONE BLANK LINE.
- Fact-driven, but DO NOT invent statistics, percentages or studies.
- Personal and charming, never corporate or hype-y. No buzzwords, no "in today's fast-paced world", no "game-changing".
- Emojis: zero or one, only if it adds something.
- Preserve any existing hashtags and keep them at the end.

Return ONLY the expanded caption text. No JSON, no markdown, no preamble. Just the caption ready to publish.`;

    setExpandingCaption(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], model: 'claude-sonnet-4-5' }),
      });
      const data = await res.json();
      const txt = (typeof data.content === 'string' ? data.content : (data.content?.[0]?.text || data.text || '')).trim();
      if (txt) {
        setForm(f => ({ ...f, caption: txt }));
        addNotification({ type: 'info', title: 'Caption expanded', body: 'Edit it as you like' });
      } else {
        addNotification({ type: 'email_failed', title: 'Expand failed', body: 'Empty response' });
      }
    } catch (e) {
      addNotification({ type: 'email_failed', title: 'Expand failed', body: 'Network error' });
    } finally {
      setExpandingCaption(false);
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
        // Append Unsplash credit to the caption if the post uses an
        // Unsplash photo — Unsplash compliance requires the credit in the
        // post text itself (not just the CRM UI). buildUnsplashCredit
        // returns '' for non-Unsplash images so this is a no-op for own
        // uploads and Brain images.
        const captionWithCredit = post.caption + buildUnsplashCredit(post, acc.platform);
        const res = await fetch('/api/social/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId,
            platform: acc.platform,
            caption: captionWithCredit,
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
    updatePosts(prev =>
      prev.find(x => x.id === post.id)
        ? prev.map(p => (p.id === post.id ? updated : p))
        : [updated, ...prev]
    );

    // SOCIAL-NOTIFS-V1: persistent notification (one per post, not per account).
    const successCount = allResults.filter(r => r.status === 'published').length;
    const failCount = allResults.filter(r => r.status === 'failed').length;
    const captionPreview = post.caption.trim().slice(0, 60) + (post.caption.length > 60 ? '…' : '');
    if (finalStatus === 'published') {
      addPersistentNotification({
        type: 'social_published',
        title: `Post published to ${successCount} account${successCount === 1 ? '' : 's'}`,
        body: captionPreview,
        href: '/social',
        dedupeKey: 'social_published:' + post.id,
      });
    } else if (finalStatus === 'partial') {
      addPersistentNotification({
        type: 'social_publish_failed',
        title: `Partial publish · ${successCount} ok, ${failCount} failed`,
        body: captionPreview,
        href: '/social',
        dedupeKey: 'social_publish_failed:' + post.id,
      });
    } else {
      addPersistentNotification({
        type: 'social_publish_failed',
        title: 'Publish failed',
        body: captionPreview,
        href: '/social',
        dedupeKey: 'social_publish_failed:' + post.id,
      });
    }

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

    // Load brain items so the AI can pick imagery
    let brainItems: BrainItem[] = [];
    try {
      const { fetchItems } = await import('@/lib/brain');
      brainItems = await fetchItems();
    } catch { brainItems = []; }
    const brainCatalog = brainItems.length === 0 ? '' :
      'Available brain images:\n' + brainItems.map(it =>
        '  - id: ' + it.id + ' | tags: ' + (it.tags.join(', ') || '(none)') + ' | description: ' + (it.description || '(none)')
      ).join('\n');

    const brief = briefs.find(b => b.id === genForm.briefId);
    const goalLabel = getGoalLabel(genForm.goal);

    try {
      // GENERATE-ACCURACY-V1: Track posts actually created across all
      // accounts. Previously we fired a misleading "Content generated"
      // toast at the end of the loop regardless of whether any drafts
      // had been saved — so a fully-truncated response would close the
      // modal, claim success, and silently leave the calendar empty.
      let createdCount = 0;
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

${buildVoiceRules(acc.platform)}

Each of the ${genForm.postsPerAccount} posts must follow these voice and format rules independently. Vary the angle, hook, and observation across the batch — no two posts should feel like the same thought rephrased.

${brainCatalog ? '\n' + brainCatalog + '\n\nFor EACH post, choose the brain image whose tags/description best fit the post. Set "brainItemId" to that id. If no brain image is a strong topical fit, set "brainItemId" to null.' : ''}

Return EXACTLY ${genForm.postsPerAccount} posts as a JSON array. Each post is an object with fields:
  - "caption": the post text (following the voice rules above)
  - "brainItemId": ${brainCatalog ? 'one of the brain image ids above, or null if none fit' : 'always null'}

Output ONLY valid JSON, no markdown. Example: [{"caption":"...","brainItemId":"img_123"},{"caption":"...","brainItemId":null}]`;

        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Pass maxTokens explicitly so this caller doesn't depend on
          // the route default. 4096 fits ~3 LinkedIn-length posts wrapped
          // in JSON without truncation. If we ever want to support
          // postsPerAccount > 3 we'll need to bump this further.
          body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], maxTokens: 4096 }),
        });
        const data = await res.json();
        const txt = typeof data.content === 'string' ? data.content : (data.content?.[0]?.text || data.text || '');

        // PARSE-HARDENING-V1: see PR notes. Three layers of defence against
        // the AI returning slightly-malformed JSON that previously dumped raw
        // JSON strings into draft captions.
        let generated: { caption: string; brainItemId?: string | null }[] = [];
        let parsed = false;

        // Layer 1: strip any markdown fence (```json, ```javascript, plain ```)
        // and trim aggressively, then try direct parse.
        const stripped = txt.replace(/```[a-z]*\n?|```/gi, '').trim();
        try {
          const candidate = JSON.parse(stripped);
          if (Array.isArray(candidate)) {
            generated = candidate;
            parsed = true;
          }
        } catch { /* fall through to layer 2 */ }

        // Layer 2: regex-extract the first [...] block from the response.
        // Catches cases where the AI prefixed/suffixed prose despite the
        // "Output ONLY valid JSON" instruction.
        if (!parsed) {
          const match = stripped.match(/\[[\s\S]*\]/);
          if (match) {
            try {
              const candidate = JSON.parse(match[0]);
              if (Array.isArray(candidate)) {
                generated = candidate;
                parsed = true;
              }
            } catch { /* fall through to error */ }
          }
        }

        // Layer 3: if both parse attempts failed, skip this account batch.
        // Surfacing a notification is far better than silently polluting the
        // calendar with raw-JSON-string drafts (the original bug).
        if (!parsed) {
          console.error('[social-generate] failed to parse AI response for', acc.handle, '— raw:', txt.slice(0, 300));
          // If the response ended mid-token (no closing bracket), the
          // model probably ran out of max_tokens. Tell the user that
          // specifically so they don't waste time retrying with the same
          // settings.
          const looksTruncated = txt.length > 100 && !txt.trim().endsWith(']') && !txt.trim().endsWith('}');
          addNotification({
            type: 'email_failed',
            title: 'Generation skipped for ' + acc.handle,
            body: looksTruncated
              ? 'AI response was cut short. Try fewer posts per account.'
              : 'AI response was not valid JSON. Try generating again.',
          });
          continue;
        }

        // Layer 4: validate each item. Drop entries whose caption looks like
        // raw JSON (starts with [ or { after trimming) — defence in depth
        // against future prompt drift returning malformed structures.
        generated = generated.filter(g => {
          if (!g || typeof g.caption !== 'string') return false;
          const t = g.caption.trim();
          if (t.startsWith('[') || t.startsWith('{')) {
            console.warn('[social-generate] dropped item with JSON-shaped caption:', t.slice(0, 80));
            return false;
          }
          return t.length > 0;
        });

        if (generated.length === 0) {
          addNotification({
            type: 'email_failed',
            title: 'No valid posts for ' + acc.handle,
            body: 'AI returned an empty or malformed batch. Try again.',
          });
          continue;
        }

        const start = new Date(genForm.weekStart);
        const newPosts: SocialPost[] = generated.slice(0, genForm.postsPerAccount).map((g, i) => {
          const dt = new Date(start);
          dt.setDate(dt.getDate() + i * 2);
          dt.setHours(10 + (i % 3) * 2, 0, 0, 0);
          // Resolve brainItemId to a real URL if AI picked one
          let resolvedImageUrl = '';
          let resolvedImageCredit = '';
          if (g.brainItemId) {
            const match = brainItems.find(b => b.id === g.brainItemId);
            if (match) {
              resolvedImageUrl = window.location.origin + '/api/images/' + match.blobId;
              resolvedImageCredit = 'From Brain';
            }
          }
          return {
            id: 'p' + Date.now() + Math.random(),
            briefId: genForm.briefId,
            accountIds: [acc.id],
            caption: g.caption || '',
            scheduledAt: dt.toISOString(),
            status: 'draft' as const,
            createdAt: new Date().toISOString(),
            imageUrl: resolvedImageUrl,
            imageCredit: resolvedImageCredit,
          };
        });

        updatePosts(prev => [...newPosts, ...prev]);
        createdCount += newPosts.length;
      }
      // GENERATE-ACCURACY-V1: Only fire the success toast and close the
      // modal if drafts actually got created. If every account batch
      // failed (truncation, parse errors, etc.) the per-account error
      // toasts have already fired — surface a clear overall failure and
      // leave the modal open so the user can retry without re-entering
      // everything.
      if (createdCount === 0) {
        addNotification({
          type: 'email_failed',
          title: 'Generation failed',
          body: 'No drafts were created. See per-account notifications above.',
        });
      } else {
        addNotification({
          type: 'info',
          title: 'Content generated',
          body: `${createdCount} draft${createdCount === 1 ? '' : 's'} created · theme: ${genForm.theme}`,
        });
        // SOCIAL-NOTIFS-V1: persistent summary notification for the bell.
        // One per batch (not per post) — per-post would spam the centre.
        addPersistentNotification({
          type: 'social_drafted',
          title: 'Bulk drafts created',
          body: `${createdCount} draft${createdCount === 1 ? '' : 's'} · theme: ${genForm.theme}`,
          href: '/social',
          dedupeKey: 'social_drafted_bulk:' + Date.now(),
        });
        setShowGen(false);
      }
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
  // PUBLISH-UI-V1: failures bubble up between Scheduled and Drafts so the
  // user can see and retry them immediately. 'partial' is intentionally
  // grouped with 'published' above (the post DID go out, just not everywhere)
  // — per-account results render inline so the user can see which leg failed.
  const failed = filtered.filter(p => p.status === 'failed');

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

  // PUBLISH-UI-V1: tiny pill that renders status with the right colour + icon.
  // Used by PostRow and the day-sheet row. 'publishing' deliberately uses the
  // scheduled treatment with a spinner because to the user it's still "waiting
  // for the cron" — they don't need to distinguish "queued" from "actively
  // hitting LinkedIn's API right now".
  function PostStatusBadge({ status }: { status: SocialPost['status'] }) {
    const map: Record<SocialPost['status'], { label: string; bg: string; fg: string; icon: JSX.Element }> = {
      draft:      { label: 'Draft',      bg: 'var(--paper)',    fg: 'var(--warn)',  icon: <Edit3 size={10} /> },
      scheduled:  { label: 'Scheduled',  bg: '#e8f5ee',         fg: 'var(--ok)',    icon: <Clock size={10} /> },
      publishing: { label: 'Publishing', bg: '#e8f5ee',         fg: 'var(--ok)',    icon: <RefreshCw size={10} /> },
      published:  { label: 'Published',  bg: '#dcfce7',         fg: '#15803d',      icon: <Check size={10} /> },
      partial:    { label: 'Partial',    bg: '#fef3c7',         fg: '#b45309',      icon: <AlertTriangle size={10} /> },
      failed:     { label: 'Failed',     bg: '#fee2e2',         fg: 'var(--alert)', icon: <AlertTriangle size={10} /> },
    };
    const s = map[status] || map.draft;
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 'var(--r-pill)',
        background: s.bg, color: s.fg,
        fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
      }}>
        {s.icon}{s.label}
      </div>
    );
  }

  function PostPill({ post }: { post: SocialPost }) {
    const accs = post.accountIds.map(id => accounts.find(a => a.id === id)).filter(Boolean) as SocialAccount[];
    const primary = accs[0];
    if (!primary) return null;
    const canDrag = post.status === 'draft' || post.status === 'scheduled';
    // PUBLISH-UI-V1: published / partial / failed posts get their own border
    // colour so the calendar reads at a glance — green = done, red = needs
    // attention, original platform colour = still pending. The status glyph
    // sits on the right; the platform icon stays on the left so the at-a-
    // glance reading "which account, what state" still works.
    const isPublished = post.status === 'published' || post.status === 'partial';
    const isFailed = post.status === 'failed';
    const borderColor = isPublished ? '#15803d' : isFailed ? 'var(--alert)' : primary.color;
    const bgColor = isPublished ? '#dcfce7' : isFailed ? '#fee2e2' : primary.color + '22';
    return (
      <div
        draggable={canDrag}
        onDragStart={canDrag ? (e) => {
          e.stopPropagation();
          e.dataTransfer.setData('text/plain', post.id);
          e.dataTransfer.effectAllowed = 'move';
        } : undefined}
        onClick={e => { e.stopPropagation(); openComposer(post); }}
        title={canDrag ? 'Drag to a different day to reschedule' : isPublished ? 'Published — click to view' : isFailed ? 'Publish failed — click to retry' : undefined}
        style={{
        background: bgColor, borderLeft: `3px solid ${borderColor}`,
        padding: '3px 6px', marginBottom: 2, borderRadius: 'var(--r-sm)',
        fontSize: 10, color: 'var(--ink-700)', display: 'flex', alignItems: 'center', gap: 4,
        cursor: canDrag ? 'grab' : 'pointer', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      }}>
        <PlatformIcon platform={primary.platform} size={9} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{primary.handle}{accs.length > 1 ? ` +${accs.length - 1}` : ''}</span>
        {isPublished && <Check size={9} color="#15803d" />}
        {isFailed && <AlertTriangle size={9} color="var(--alert)" />}
      </div>
    );
  }

  function PostRow({ post }: { post: SocialPost }) {
    const accs = post.accountIds.map(id => accounts.find(a => a.id === id)).filter(Boolean) as SocialAccount[];
    const brief = briefs.find(b => b.id === post.briefId);
    // PUBLISH-UI-V1: collect per-account result data once so the chips and
    // the failure banner stay consistent.
    const results = post.results || {};
    const failedResults = Object.entries(results).filter(([, r]) => r.status === 'failed');
    const showRetry = post.status === 'failed' || post.status === 'partial';
    // First error message is enough for the banner — full per-account
    // breakdown sits in the chips row below.
    const firstError = failedResults[0]?.[1]?.error;
    return (
      <div className="soc-postrow" style={{ background: selectMode && selectedIds.has(post.id) ? 'var(--paper)' : 'transparent' }}>
        {/* BULK-SELECT-V1 — checkbox */}
        {selectMode && (
          <input
            type="checkbox"
            checked={selectedIds.has(post.id)}
            onChange={e => {
              setSelectedIds(prev => {
                const next = new Set(prev);
                if (e.target.checked) next.add(post.id); else next.delete(post.id);
                return next;
              });
            }}
            style={{ width: 16, height: 16, marginTop: 4, flexShrink: 0, cursor: 'pointer', accentColor: 'var(--maroon-700)' }}
          />
        )}
        <div className="soc-postrow-content">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <PostStatusBadge status={post.status} />
            {brief && <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: brief.color + '15', fontSize: 10, fontWeight: 600, color: brief.color }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: brief.color }} />{brief.name}</div>}
            {accs.map(a => <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--ink-600)' }}><PlatformIcon platform={a.platform} size={10} color={a.color} />{a.handle}</div>)}
            <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>· {new Date(post.scheduledAt).toLocaleDateString()} {new Date(post.scheduledAt).toTimeString().slice(0, 5)}</div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-800)', lineHeight: 1.5, marginBottom: 6, whiteSpace: 'pre-wrap' }}>{post.caption.length > 240 ? post.caption.slice(0, 240) + '…' : post.caption}</div>
          {post.imageUrl && <img src={post.imageUrl} alt="" style={{ width: 100, height: 60, objectFit: 'cover', borderRadius: 'var(--r-sm)' }} />}
          {/* PUBLISH-UI-V1: per-account chips. Show outcomes for any post
              that has results — covers published, partial, failed, and the
              in-flight publishing state. Linked chips deep-link to the live
              social post when postUrl is set (LinkedIn / FB / IG). */}
          {Object.keys(results).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {Object.entries(results).map(([accountId, r]) => {
                const a = accounts.find(x => x.id === accountId);
                const handle = a?.handle || accountId;
                const platform = a?.platform || '';
                const isOk = r.status === 'published';
                const isFail = r.status === 'failed';
                const chipBg = isOk ? '#dcfce7' : isFail ? '#fee2e2' : 'var(--paper)';
                const chipFg = isOk ? '#15803d' : isFail ? 'var(--alert)' : 'var(--ink-600)';
                const inner = (
                  <>
                    {platform && <PlatformIcon platform={platform} size={10} color={chipFg} />}
                    <span>{handle}</span>
                    {isOk && <Check size={10} />}
                    {isFail && <X size={10} />}
                  </>
                );
                const chipStyle = {
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 'var(--r-pill)',
                  background: chipBg, color: chipFg,
                  fontSize: 10, fontWeight: 600,
                  textDecoration: 'none',
                } as const;
                return isOk && r.postUrl ? (
                  <a key={accountId} href={r.postUrl} target="_blank" rel="noopener noreferrer" style={chipStyle} title="Open published post in a new tab">{inner}</a>
                ) : (
                  <span key={accountId} style={chipStyle} title={isFail ? (r.error || 'Failed') : undefined}>{inner}</span>
                );
              })}
            </div>
          )}
          {/* PUBLISH-UI-V1: failure banner. Surfaces the first error message
              inline so the user doesn't have to hover a chip to see what
              broke. Retry reuses publishPost() — same code path the manual
              Publish button uses, so a retry is exactly equivalent to a
              fresh manual publish from the UI. */}
          {showRetry && (
            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 'var(--r-sm)', background: '#fee2e2', border: '1px solid #fecaca', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <AlertTriangle size={14} color="var(--alert)" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--alert)' }}>
                  {post.status === 'partial' ? 'Partially published' : 'Publish failed'}
                </div>
                {firstError && <div style={{ fontSize: 11, color: 'var(--ink-700)', marginTop: 2, wordBreak: 'break-word' }}>{firstError}</div>}
              </div>
              <button
                onClick={() => publishPost(post)}
                style={{ ...btnG, padding: '4px 10px', fontSize: 11, flexShrink: 0 }}
                title="Retry publishing"
              ><RefreshCw size={11} /> Retry</button>
            </div>
          )}
        </div>
        <div className="soc-postrow-actions">
          <button onClick={() => setSwappingPostId(post.id)} style={{ ...btnG, padding: '4px 10px', fontSize: 11 }} title="Swap image from Brain">🧠 Swap</button>
          <button onClick={() => openComposer(post)} style={{ ...btnG, padding: '4px 10px', fontSize: 11 }}><Edit3 size={11} /> Edit</button>
            {/* DUPLICATE-POST-V1 button */}
            <button onClick={() => duplicatePost(post)} style={{ ...btnG, padding: '4px 10px', fontSize: 11 }} title="Duplicate as new draft"><Copy size={11} /> Duplicate</button>
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
    <div className="page-wrap">
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
      <div className="soc-header">
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--ink-900)', lineHeight: 1 }}>Social Calendar</h1>
          <p style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 5, fontWeight: 500 }}>{scheduled.length} scheduled · {drafts.length} drafts · {published.length} published · {activeAccountCount} accounts</p>
        </div>
        <div className="soc-header-actions">
          {/* MOBILE-CAL-UX-V1 — overflow trigger; hidden on desktop via CSS. */}
          <button
            className="soc-header-overflow"
            style={btnG}
            aria-label="More actions"
            aria-expanded={headerMenuOpen}
            onClick={() => setHeaderMenuOpen(o => !o)}
          >⋯</button>
          {/* MOBILE-CAL-UX-V1 — secondary actions: on desktop these display
              inline via display:contents; on mobile they collapse into the
              overflow dropdown panel and only show when .is-open is set. */}
          <div className={`soc-header-secondary${headerMenuOpen ? ' is-open' : ''}`}>
            {/* BULK-SELECT-V1 — select toggle button */}
            <button
              onClick={() => { setSelectMode(m => !m); setSelectedIds(new Set()); setHeaderMenuOpen(false); }}
              style={{ ...(selectMode ? btnP : btnG) }}
              title={selectMode ? 'Exit selection mode' : 'Select multiple posts'}
            >
              <Check size={13} /> {selectMode ? 'Done' : 'Select'}
            </button>
            {/* SOCIAL-SETTINGS-LINK-V1 */}
            <a href="/social/settings" style={{ ...btnG, textDecoration: 'none' }} title="Posting times & themes" onClick={() => setHeaderMenuOpen(false)}><Settings size={13} /> Settings</a>
            {/* DEBUG-PUBLISH-RUN-NOW-V1: temporary button to manually invoke
                the publish-due cron and see its full response. Remove once
                the cron is verified working. */}
            <button
              style={btnG}
              onClick={async () => {
                setHeaderMenuOpen(false);
                try {
                  const res = await fetch('/api/social/publish-due/run-now', { method: 'POST' });
                  // Read as text first: a gateway timeout returns an HTML page,
                  // and res.json() would throw "The string did not match the
                  // expected pattern" instead of surfacing the real status.
                  const raw = await res.text();
                  let data: any = null;
                  try { data = JSON.parse(raw); } catch { /* non-JSON (e.g. timeout HTML) */ }
                  alert('publish-due response (HTTP ' + res.status + '):\n\n' + (data ? JSON.stringify(data, null, 2) : raw.slice(0, 500)));
                } catch (e: any) {
                  alert('publish-due call threw: ' + (e?.message || String(e)));
                }
              }}
              title="Manually invoke the publish-due cron endpoint and show its response"
            >🐛 Run publish-due</button>
            <button style={btnG} onClick={async () => {
              setHeaderMenuOpen(false);
              if (fillingCalendar) return;
              setFillingCalendar(true);
              try {
                const res = await fetch('/api/social/auto-generate/run-now', { method: 'POST' });
                // Read as text first: a gateway timeout returns an HTML page,
                // and res.json() would throw "Unexpected token '<'".
                const raw = await res.text();
                let data: any = null;
                try { data = JSON.parse(raw); } catch { /* non-JSON (e.g. timeout HTML) */ }
                if (data?.ok) {
                  const more = data.stoppedEarly && data.pendingCount
                    ? ` ${data.pendingCount} slot${data.pendingCount === 1 ? '' : 's'} left — click Fill calendar again to continue.`
                    : '';
                  alert(`Created ${data.createdCount} draft${data.createdCount === 1 ? '' : 's'} (skipped ${data.skippedCount}).${more}`);
                } else {
                  alert('Fill calendar: ' + (data?.error
                    || (res.status === 502 || res.status === 504
                      ? 'the generator ran out of time — please click Fill calendar again to continue.'
                      : `unexpected response (HTTP ${res.status}).`)));
                }
                // Refresh either way — a partial/stopped-early run still saved drafts.
                const fresh = await loadWithMigration<SocialPost[]>('social_posts');
                if (fresh) setPosts(fresh);
              } catch (err: any) {
                alert('Fill calendar failed: ' + (err?.message || err));
              } finally {
                setFillingCalendar(false);
              }
            }}>{fillingCalendar ? 'Filling...' : 'Fill calendar'}</button>
            {/* CRON-AUTOGEN-V1 Fill calendar button */}
            <button style={btnG} onClick={() => { setShowGen(true); setHeaderMenuOpen(false); }}><Sparkles size={13} /> Generate</button>
          </div>
          <button className="soc-header-primary" style={btnP} onClick={() => openComposer()}><Plus size={13} /> New post</button>
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
      <div className="soc-stat-grid">
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
      <div className="soc-toolbar">
        <div className="soc-tabs">
          {([['calendar', 'Calendar', <Calendar key="c" size={13} />], ['list', 'List', <List key="l" size={13} />]] as [string, string, React.ReactNode][]).map(([id, label, icon]) => (
            <button key={id} onClick={() => setTab(id as 'calendar' | 'list')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 'var(--r-sm)', background: tab === id ? 'var(--white)' : 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: tab === id ? 600 : 400, color: tab === id ? 'var(--ink-900)' : 'var(--ink-500)', boxShadow: tab === id ? 'var(--shadow-sm)' : 'none' }}>{icon}{label}</button>
          ))}
        </div>
        <div className="soc-filters">
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
          {/* Horizontal scroll wrapper: 7 columns at <560px viewport gets
              too cramped to tap reliably. Enforce a min-width so cells stay
              usable; the outer div scrolls horizontally on small screens. */}
          <div className="cal-scroll" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div className="soc-cal-min">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid var(--ink-100)' }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} style={{ padding: 8, textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
            {calDays.map((day, i) => {
              const isToday = day === today.getDate() && calM === today.getMonth() && calY === today.getFullYear();
              const dp = day ? postsForDay(day) : [];
              const isDropTarget = day !== null && dragOverIdx === i;
              return (
                <div
                  key={i}
                  className="soc-cal-cell"
                  onDragOver={day ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverIdx !== i) setDragOverIdx(i); } : undefined}
                  onDragLeave={day ? (e) => { if (dragOverIdx === i) setDragOverIdx(null); } : undefined}
                  onDrop={day ? (e) => {
                    e.preventDefault();
                    setDragOverIdx(null);
                    const postId = e.dataTransfer.getData('text/plain');
                    if (postId) movePost(postId, calY, calM, day);
                  } : undefined}
                  style={{
                    borderRight: i % 7 !== 6 ? '1px solid var(--ink-100)' : 'none',
                    borderBottom: i < 35 ? '1px solid var(--ink-100)' : 'none',
                    background: isDropTarget ? 'var(--maroon-100, #f5e6e8)' : (isToday ? 'var(--maroon-50)' : 'var(--white)'),
                    outline: isDropTarget ? '2px dashed var(--maroon-700)' : 'none',
                    outlineOffset: '-2px',
                    cursor: day ? 'pointer' : 'default',
                    transition: 'background 80ms ease',
                  }}
                  onClick={() => {
                    if (!day) return;
                    // MOBILE-CAL-UX-V1 — on phones the post pills are
                    // replaced by dots, so cell-tap opens a day-detail sheet
                    // listing posts in full (and offering "Add post for this
                    // day"). On desktop the pills are clickable directly, so
                    // cell-tap goes straight to composer prefilled with this
                    // day's date.
                    if (isMobile) {
                      setDaySheet({ y: calY, m: calM, d: day });
                    } else {
                      const dateStr = calY + '-' + String(calM + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
                      openComposer(undefined, { defaultDate: dateStr });
                    }
                  }}
                >
                  {day && (<>
                    <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--maroon-700)' : 'var(--ink-400)', marginBottom: 3 }}>{day}{isToday && <span style={{ marginLeft: 4, fontSize: 9, background: 'var(--maroon-700)', color: 'white', padding: '1px 5px', borderRadius: 'var(--r-pill)' }}>today</span>}</div>
                    {/* MOBILE-CAL-UX-V1 — pills shown on desktop, dots on mobile.
                        Both rendered; CSS toggles which is visible. */}
                    <div className="soc-cell-pills">
                      {dp.slice(0, 3).map(p => <PostPill key={p.id} post={p} />)}
                      {dp.length > 3 && <div style={{ fontSize: 9, color: 'var(--ink-400)' }}>+{dp.length - 3}</div>}
                    </div>
                    {dp.length > 0 && (
                      <div className="soc-cell-dots" aria-label={`${dp.length} post${dp.length === 1 ? '' : 's'} scheduled`}>
                        {dp.slice(0, 4).map(p => {
                          const acc = accounts.find(a => a.id === p.accountIds[0]);
                          return <span key={p.id} className="dot" style={{ background: acc?.color || 'var(--ink-300)' }} />;
                        })}
                        {dp.length > 4 && <span className="more">+{dp.length - 4}</span>}
                      </div>
                    )}
                  </>)}
                </div>
              );
            })}
          </div>
          </div>
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
            {/* BULK-SELECT-V1 — action bar (only when in select mode) */}
            {selectMode && (
              <div style={{ position: 'sticky', top: 0, zIndex: 10, padding: '10px 18px', background: 'var(--maroon-700)', color: 'var(--white)', borderBottom: '1px solid var(--ink-100)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedIds.size} selected</span>
                <button
                  onClick={() => setSelectedIds(new Set(filtered.map(p => p.id)))}
                  style={{ background: 'rgba(255,255,255,0.15)', color: 'var(--white)', border: 'none', padding: '5px 11px', borderRadius: 'var(--r-sm)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >Select all visible ({filtered.length})</button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  disabled={selectedIds.size === 0}
                  style={{ background: 'rgba(255,255,255,0.15)', color: 'var(--white)', border: 'none', padding: '5px 11px', borderRadius: 'var(--r-sm)', fontSize: 11, fontWeight: 600, cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer', opacity: selectedIds.size === 0 ? 0.5 : 1, fontFamily: 'inherit' }}
                >Clear</button>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => setConfirmBulkDelete(true)}
                  disabled={selectedIds.size === 0}
                  style={{ background: selectedIds.size === 0 ? 'rgba(255,255,255,0.15)' : 'var(--alert)', color: 'var(--white)', border: 'none', padding: '6px 14px', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600, cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer', opacity: selectedIds.size === 0 ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}
                ><Trash2 size={12} /> Delete</button>
                <button
                  onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}
                  style={{ background: 'transparent', color: 'var(--white)', border: '1px solid rgba(255,255,255,0.4)', padding: '5px 11px', borderRadius: 'var(--r-sm)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >Cancel</button>
              </div>
            )}
            {scheduled.length > 0 && <><div style={{ padding: '9px 18px', background: '#e8f5ee', borderBottom: '1px solid var(--ink-100)', fontSize: 11, fontWeight: 600, color: 'var(--ok)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={12} />Scheduled ({scheduled.length})</div>{scheduled.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()).map(p => <PostRow key={p.id} post={p} />)}</>}
            {/* PUBLISH-UI-V1: failures bubble above drafts so they're visible
                and one click from Retry. Sorted most-recent first since fresh
                failures are usually the ones the user wants to deal with. */}
            {failed.length > 0 && <><div style={{ padding: '9px 18px', background: '#fee2e2', borderBottom: '1px solid var(--ink-100)', fontSize: 11, fontWeight: 600, color: 'var(--alert)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={12} />Failed ({failed.length})</div>{failed.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()).map(p => <PostRow key={p.id} post={p} />)}</>}
            {drafts.length > 0 && <><div style={{ padding: '9px 18px', background: 'var(--paper)', borderBottom: '1px solid var(--ink-100)', fontSize: 11, fontWeight: 600, color: 'var(--warn)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 6 }}><Edit3 size={12} />Drafts ({drafts.length})</div>{drafts.map(p => <PostRow key={p.id} post={p} />)}</>}
            {/* PUBLISH-UI-V1: Published header gets the celebratory green
                treatment to match the badge styling on individual rows. */}
            {published.length > 0 && <><div style={{ padding: '9px 18px', background: '#dcfce7', borderBottom: '1px solid var(--ink-100)', fontSize: 11, fontWeight: 600, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 6 }}><Check size={12} />Published ({published.length})</div>{published.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()).map(p => <PostRow key={p.id} post={p} />)}</>}
          </>)}
        </div>
      )}

      {/* MOBILE-CAL-UX-V1 — day-detail bottom sheet (mobile cell tap). */}
      {daySheet && (() => {
        const { y, m, d } = daySheet;
        const date = new Date(y, m, d);
        const dayPosts = filtered
          .filter(p => {
            const pd = new Date(p.scheduledAt);
            return pd.getDate() === d && pd.getMonth() === m && pd.getFullYear() === y;
          })
          .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
        const dateLabel = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
        const dateStr = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        return (
          <div className="soc-daysheet-overlay" onClick={e => { if (e.target === e.currentTarget) setDaySheet(null); }}>
            <div className="soc-daysheet">
              <div className="soc-daysheet-grab" />
              <div className="soc-daysheet-header">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{dayPosts.length} post{dayPosts.length === 1 ? '' : 's'}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink-900)', marginTop: 2 }}>{dateLabel}</div>
                </div>
                <button onClick={() => setDaySheet(null)} className="soc-daysheet-close" aria-label="Close"><X size={20} /></button>
              </div>
              <div className="soc-daysheet-body">
                {dayPosts.length === 0 ? (
                  <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-400)' }}>
                    <Calendar size={28} style={{ margin: '0 auto 10px', display: 'block', opacity: 0.5 }} />
                    <div style={{ fontSize: 13 }}>No posts scheduled for this day</div>
                  </div>
                ) : dayPosts.map(p => {
                  const accs = p.accountIds.map(id => accounts.find(a => a.id === id)).filter(Boolean) as SocialAccount[];
                  const primary = accs[0];
                  const time = new Date(p.scheduledAt).toTimeString().slice(0, 5);
                  const statusColor = p.status === 'scheduled' ? 'var(--ok)' : (p.status === 'published' || p.status === 'partial') ? 'var(--info)' : p.status === 'failed' ? 'var(--alert)' : 'var(--warn)';
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setDaySheet(null); openComposer(p); }}
                      className="soc-daysheet-row"
                    >
                      {primary && (
                        <div className="soc-daysheet-row-icon" style={{ background: primary.color + '22' }}>
                          <PlatformIcon platform={primary.platform} size={14} color={primary.color} />
                        </div>
                      )}
                      <div className="soc-daysheet-row-body">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{primary?.handle || 'Unknown'}{accs.length > 1 ? ` +${accs.length - 1}` : ''}</span>
                          <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{time}</span>
                          <span style={{ fontSize: 9, color: statusColor, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--r-pill)', background: 'var(--paper)' }}>{p.status}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-600)', lineHeight: 1.4, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>{p.caption}</div>
                      </div>
                      {p.imageUrl && <img src={p.imageUrl} alt="" className="soc-daysheet-row-thumb" />}
                    </button>
                  );
                })}
              </div>
              <div className="soc-daysheet-footer">
                <button
                  className="soc-daysheet-add"
                  style={btnP}
                  onClick={() => {
                    setDaySheet(null);
                    openComposer(undefined, { defaultDate: dateStr });
                  }}
                ><Plus size={14} /> Add post for this day</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* BULK-SELECT-V1 — confirm bulk delete modal */}
      {confirmBulkDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,13,18,0.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setConfirmBulkDelete(false); }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--r-lg)', width: 'min(440px,100%)', padding: 24, boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--ink-900)' }}>Delete {selectedIds.size} post{selectedIds.size === 1 ? '' : 's'}?</h2>
            <p style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 20 }}>This will permanently remove the selected post{selectedIds.size === 1 ? '' : 's'} from the calendar. Already-published posts on connected platforms are not affected.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmBulkDelete(false)} style={btnG}>Cancel</button>
              <button
                onClick={() => {
                  const ids = selectedIds;
                  setPosts(prev => {
                    const next = prev.filter(p => !ids.has(p.id));
                    savePosts(next);
                    return next;
                  });
                  setSelectedIds(new Set());
                  setConfirmBulkDelete(false);
                  setSelectMode(false);
                }}
                style={{ ...btnP, background: 'var(--alert)' }}
              ><Trash2 size={13} /> Delete</button>
            </div>
          </div>
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
        <div className="soc-modal-overlay" style={{ zIndex: 500 }} onClick={e => { if (e.target === e.currentTarget) setShowComposer(false); }}>
          <div className="soc-modal-panel" style={{ width: 580 }}>
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
              <div className="form-grid" style={{ gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Context <span style={{ fontWeight: 400, color: 'var(--ink-400)' }}>(optional)</span></label>
                  <input value={form.town} onChange={e => setForm({ ...form, town: e.target.value })} placeholder="e.g. Whitstable" style={inp} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</label>
                  {/* PUBLISH-UI-V1: Published / Partial / Failed are
                      auto-managed by the publish pipeline. When editing such
                      a post we surface the current status as a disabled
                      option (read-only display) so the user understands what
                      state the post is in, but they can't manually pick it
                      for a draft. Switching off Published locally would also
                      mean the next Save would overwrite the cron's verdict,
                      which we don't want. */}
                  <select
                    value={form.status}
                    onChange={e => setForm({ ...form, status: e.target.value as SocialPost['status'] })}
                    disabled={form.status === 'published' || form.status === 'partial' || form.status === 'failed' || form.status === 'publishing'}
                    style={{ ...inp, cursor: 'pointer', opacity: (form.status === 'published' || form.status === 'partial' || form.status === 'failed' || form.status === 'publishing') ? 0.6 : 1 }}
                  >
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    {form.status === 'published' && <option value="published">Published</option>}
                    {form.status === 'partial' && <option value="partial">Partially published</option>}
                    {form.status === 'failed' && <option value="failed">Failed</option>}
                    {form.status === 'publishing' && <option value="publishing">Publishing…</option>}
                  </select>
                </div>
              </div>

              {/* Caption */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5, gap: 12 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Caption</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    {/* EXPAND-CAPTION-V1: elaborate on the existing copy */}
                    {form.caption.trim() && (
                      <button type="button" onClick={expandCaptionForComposer} disabled={expandingCaption || generatingCaption || form.accountIds.length === 0} title="Make the caption longer and more detailed, keeping the same voice" style={{ background: 'none', border: 'none', fontSize: 11, color: form.accountIds.length === 0 ? 'var(--ink-300)' : 'var(--maroon-700)', cursor: (expandingCaption || generatingCaption || form.accountIds.length === 0) ? 'not-allowed' : 'pointer', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}>
                        {expandingCaption ? <><Sparkles size={11} />Expanding…</> : <><WrapText size={11} />Expand</>}
                      </button>
                    )}
                    <button type="button" onClick={generateCaptionForComposer} disabled={generatingCaption || expandingCaption || !form.briefId || form.accountIds.length === 0} style={{ background: 'none', border: 'none', fontSize: 11, color: !form.briefId || form.accountIds.length === 0 ? 'var(--ink-300)' : 'var(--maroon-700)', cursor: (generatingCaption || expandingCaption || !form.briefId || form.accountIds.length === 0) ? 'not-allowed' : 'pointer', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}>
                      {/* REGENERATE-LABEL-V1 */}{generatingCaption ? <><Sparkles size={11} />Generating…</> : form.caption.trim() ? <><RefreshCw size={11} />Regenerate</> : <><Sparkles size={11} />Generate with AI</>}
                    </button>
                  </div>
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
                  <button type="button" onClick={() => setShowBrainPicker(true)} style={{ ...btnG, padding: '5px 10px', fontSize: 11, gap: 4, flexShrink: 0 }}>
                    🧠 Brain
                  </button>
                  <label style={{ ...btnG, padding: '5px 10px', fontSize: 11, gap: 4, flexShrink: 0, cursor: 'pointer' }}>
                    Upload
                    <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) uploadOwnImage(f); e.currentTarget.value = ''; }} style={{ display: 'none' }} />
                  </label>
                </div>
                {form.imageUrl && <div style={{ marginBottom: 8, position: 'relative' }}>
                  <img src={form.imageUrl} style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-100)', display: 'block' }} alt="" />
                  <button onClick={() => setForm({ ...form, imageUrl: '', imageCredit: '', imageCreditUrl: '', imagePhotoUrl: '', imageUnsplashUrl: '', imageSocialHandles: {} })} style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}><X size={11} /></button>
                  {/* Credit line per Unsplash attribution guidelines:
                      photographer name + Unsplash both link out, with UTMs
                      already baked into creditUrl/unsplashUrl by the search
                      API route. */}
                  {form.imageCredit && form.imageCreditUrl ? (
                    <div style={{ fontSize: 10, color: 'var(--ink-400)', marginTop: 3 }}>
                      Photo by <a href={form.imageCreditUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink-600)', textDecoration: 'underline' }}>{form.imageCredit}</a> on <a href={form.imageUnsplashUrl || ('https://unsplash.com?utm_source=roam_growth_engine&utm_medium=referral')} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink-600)', textDecoration: 'underline' }}>Unsplash</a>
                    </div>
                  ) : form.imageCredit && (
                    <div style={{ fontSize: 10, color: 'var(--ink-400)', marginTop: 3 }}>Photo by {form.imageCredit}</div>
                  )}
                </div>}
                {unsplash.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 8 }}>
                  {unsplash.map((img, i) => (
                    <div key={i} onClick={() => pickUnsplashPhoto(img)} style={{ cursor: 'pointer', borderRadius: 'var(--r-sm)', overflow: 'hidden', border: '2px solid ' + (form.imageUrl === img.url ? 'var(--maroon-700)' : 'transparent'), position: 'relative' }}>
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
              <div className="form-grid" style={{ gap: 12 }}>
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
        <div className="soc-modal-overlay" style={{ zIndex: 500 }} onClick={e => { if (e.target === e.currentTarget) setShowGen(false); }}>
          <div className="soc-modal-panel" style={{ width: 500 }}>
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
              <div className="form-grid" style={{ gap: 12 }}>
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
      <BrainPicker
        open={showBrainPicker || !!swappingPostId}
        onClose={() => { setShowBrainPicker(false); setSwappingPostId(null); }}
        onPick={pickFromBrain}
      />
    </div>
  );
}
