import { NextRequest, NextResponse } from 'next/server';
import { mostRecentReplyForContact } from '@/lib/replies';
import { fetchAllContacts } from '@/lib/brevo';
import { getHiddenListIds } from '@/lib/hidden-lists';
import type { AttentionContact } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Pipeline data for the dashboard.
 *
 * Returns:
 *   - stages: counts per funnel stage (Not contacted → Listed)
 *   - attention: three "needs attention" lists (hottest, stuck, going cold)
 *   - totals: overall stats
 *
 * Single Brevo fetch per call; everything computed in memory.
 */

const BREVO_BASE = 'https://api.brevo.com/v3';

interface BrevoContact {
  id: number;
  email: string;
  attributes?: Record<string, string>;
  listIds?: number[];
}

/**
 * Fetch every contact in a Brevo list, paginated, with retry on 429.
 *
 * Brevo's free tier rate-limits at ~10 req/s. The pipeline fires the global
 * /contacts fetch plus one call per list in parallel, so we hit that ceiling
 * easily — when we do, lists silently come back empty and disappear from the
 * Active Towns card. Backoff + retry keeps that from happening.
 */
async function fetchListContacts(listId: number, listName: string): Promise<BrevoContact[]> {
  const all: BrevoContact[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (offset < 5_000) {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(
        `${BREVO_BASE}/contacts/lists/${listId}/contacts?limit=${PAGE}&offset=${offset}`,
        { headers: { 'api-key': process.env.BREVO_API_KEY!, 'Content-Type': 'application/json' } }
      );
      if (res.ok) break;
      if (res.status !== 429 && res.status !== 503) break;
      const wait = Math.min(500 * 2 ** attempt, 4000);
      console.warn(`[pipeline] list ${listId} (${listName}) ${res.status}, retry ${attempt + 1} in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
    if (!res || !res.ok) {
      console.warn(`[pipeline] list ${listId} (${listName}) fetch gave up at ${res?.status}`);
      break;
    }
    const data = await res.json();
    const page: BrevoContact[] = data.contacts || [];
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

/**
 * Run a list of async tasks with a max concurrency cap. Used to keep the
 * per-list contact fetches under Brevo's rate limit.
 */
async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

function asNumber(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const listId = searchParams.get('listId');
  const startedAt = Date.now();

  if (!process.env.BREVO_API_KEY) {
    console.error('[pipeline] BREVO_API_KEY not configured');
    return NextResponse.json({ error: 'BREVO_API_KEY not configured' }, { status: 500 });
  }

  try {
    // Step 1: pull the list-of-lists (each list = one town) and the global
    // contacts feed in parallel. The global feed drives the funnel/attention
    // stats; the lists drive the per-list activity tally below.
    const [{ contacts, totalInBrevo }, listsResp] = await Promise.all([
      fetchAllContacts({ listId }),
      fetch(`${BREVO_BASE}/contacts/lists?limit=50&sort=desc`, {
        headers: { 'api-key': process.env.BREVO_API_KEY!, 'Content-Type': 'application/json' },
      }).then(r => r.ok ? r.json() : { lists: [] }).catch(() => ({ lists: [] })),
    ]);
    console.log(`[pipeline] fetched ${contacts.length} contacts in ${Date.now() - startedAt}ms`);

    const brevoLists: { id: number; name: string; uniqueSubscribers?: number }[] = listsResp?.lists || [];

    // Step 2: fetch contacts per list with limited concurrency. Brevo's
    // global /contacts endpoint doesn't always populate listIds on every
    // record, so the per-list endpoint is the authoritative source. Cap
    // at 3 concurrent to stay well under Brevo's 10 req/s rate limit —
    // before this throttle, parallel per-list calls + the global feed
    // would hit 429s and lists would silently come back empty.
    //
    // If the global fetch was already scoped to a single listId, skip the
    // per-list explosion and just attribute everything to that one list.
    const listContactsByListId = new Map<number, BrevoContact[]>();
    if (listId) {
      const onlyId = Number(listId);
      if (Number.isInteger(onlyId)) {
        listContactsByListId.set(onlyId, contacts as BrevoContact[]);
      }
    } else {
      await runWithConcurrency(brevoLists, 3, async (bl) => {
        try {
          const all = await fetchListContacts(bl.id, bl.name);
          listContactsByListId.set(bl.id, all);
        } catch (err: any) {
          console.warn(`[pipeline] list ${bl.id} (${bl.name}) fetch failed:`, err?.message);
          listContactsByListId.set(bl.id, []);
        }
      });

      // Fallback: any list whose per-list fetch came back empty gets
      // populated from the global feed via c.listIds. This catches the
      // tail-end of rate-limited failures and any other case where the
      // per-list endpoint returned nothing for a list that genuinely has
      // members. Contacts that appear in both sources are deduped.
      const emptyLists = brevoLists.filter(bl => (listContactsByListId.get(bl.id) || []).length === 0);
      if (emptyLists.length > 0) {
        const emptyIds = new Set(emptyLists.map(bl => bl.id));
        const fallbackByListId = new Map<number, BrevoContact[]>();
        for (const c of contacts as BrevoContact[]) {
          for (const lid of c.listIds || []) {
            if (!emptyIds.has(lid)) continue;
            let arr = fallbackByListId.get(lid);
            if (!arr) { arr = []; fallbackByListId.set(lid, arr); }
            arr.push(c);
          }
        }
        for (const [lid, arr] of fallbackByListId.entries()) {
          if (arr.length > 0) {
            listContactsByListId.set(lid, arr);
            console.log(`[pipeline] list ${lid} populated via fallback (${arr.length} contacts)`);
          }
        }
      }
    }

    const now = new Date();

    // Stage counts. A contact is in exactly one of these (status-based).
    let notContacted = 0;
    let sent = 0;            // email_sent only
    let followedUp = 0;      // followed_up
    let finalNudge = 0;      // final_nudge
    let listed = 0;
    let cold = 0;
    let responded = 0;

    // Engagement signals (cross-cut: a contact can be 'sent' AND 'opened').
    let delivered = 0;
    let opened = 0;
    let clicked = 0;
    let bounced = 0;

    // Attention queues. Cap at 5 each so the dashboard stays scannable;
    // overflow gets a "view all" link.
    const hottest: AttentionContact[] = [];   // clicked but not yet listed
    const stuck: AttentionContact[] = [];     // opened, didn't click, sent ≥3 days ago
    const goingCold: AttentionContact[] = []; // final_nudge sent, day 12+ (will auto-cold soon)
    const replied: AttentionContact[] = [];   // status=responded, with reply preview

    // Per-list activity stats. Computed below from the per-list contact
    // fetches, not from listIds on the global feed (that field isn't always
    // populated, which caused active lists like Darlington to silently drop).
    interface ListStats {
      listId: number;
      name: string;
      total: number;
      contacted: number;
      opens: number;
      clicks: number;
      replies: number;
      lastActivityAt: string | null;
      hidden: boolean;
    }
    const hiddenListIds = new Set(await getHiddenListIds());

    let contactErrors = 0;
    for (const c of contacts) {
      try {
        const a = c.attributes || {};
        const status = a.OUTREACH_STATUS || 'not_contacted';
        const name = a.BUSINESS_NAME || a.FIRSTNAME || (c.email ? c.email.split('@')[0] : 'Unknown');
        const town = a.TOWN || '';

        // Stage tally.
        if (status === 'not_contacted') notContacted++;
        else if (status === 'email_sent') sent++;
        else if (status === 'followed_up') followedUp++;
        else if (status === 'final_nudge') finalNudge++;
        else if (status === 'listed') listed++;
        else if (status === 'cold') cold++;
        else if (status === 'responded') responded++;

        // Engagement tally. Hard bounce excluded from delivered to avoid
        // double-counting in metrics.
        if (a.LAST_DELIVERED_AT && !a.BOUNCED_AT) delivered++;
        if (a.LAST_OPENED_AT) opened++;
        if (a.LAST_CLICKED_AT) clicked++;
        if (a.BOUNCED_AT) bounced++;

        // Per-list breakdown happens AFTER this loop, from the per-list
        // fetches (authoritative for membership). Nothing to do here.

        // ATTENTION QUEUES

        // Hottest: clicked at all, status not yet listed/cold/responded
        const clickedAt = asDate(a.LAST_CLICKED_AT);
        if (clickedAt && !['listed', 'cold', 'responded'].includes(status)) {
          hottest.push({
            email: c.email, name, town, status,
            signal: `Clicked ${asNumber(a.CLICK_COUNT) > 1 ? `\u00d7 ${asNumber(a.CLICK_COUNT)}` : 'a link'}`,
            signalAt: a.LAST_CLICKED_AT,
            daysIn: daysBetween(clickedAt, now),
          });
        }

        // Stuck: opened (so they read it), no click yet, last contact 3-7 days ago,
        // status still in pipeline. These are the "follow up manually" candidates.
        const openedAt = asDate(a.LAST_OPENED_AT);
        const lastContact = asDate(a.LAST_CONTACT_DATE);
        if (
          openedAt && !clickedAt &&
          ['email_sent', 'followed_up'].includes(status) &&
          lastContact
        ) {
          const days = daysBetween(lastContact, now);
          if (days >= 3 && days <= 9) {
            stuck.push({
              email: c.email, name, town, status,
              signal: `Opened ${asNumber(a.OPEN_COUNT) > 1 ? `\u00d7 ${asNumber(a.OPEN_COUNT)}` : 'once'} but no click`,
              signalAt: a.LAST_OPENED_AT,
              daysIn: days,
            });
          }
        }

        // Going cold: final_nudge sent, day 12+ (auto-cold at day 14)
        if (status === 'final_nudge' && lastContact) {
          const days = daysBetween(lastContact, now);
          if (days >= 12) {
            goingCold.push({
              email: c.email, name, town, status,
              signal: 'Final nudge sent, no response',
              signalAt: a.LAST_CONTACT_DATE,
              daysIn: days,
            });
          }
        }

        // Replied: status=responded, sorted by LAST_REPLIED_AT desc.
        // Cheap to flag here; we hydrate previews after the loop.
        if (status === 'responded' && a.LAST_REPLIED_AT) {
          replied.push({
            email: c.email, name, town, status,
            signal: a.LAST_REPLY_SUBJECT || 'Replied',
            signalAt: a.LAST_REPLIED_AT,
            daysIn: daysBetween(asDate(a.LAST_REPLIED_AT) || now, now),
          });
        }
      } catch (perContactErr) {
        // Don't let a single bad contact (corrupt date, weird attributes,
        // etc.) crash the whole pipeline endpoint. Log and skip.
        contactErrors++;
        console.error(`[pipeline] contact processing failed for id=${c.id}:`, perContactErr);
      }
    }
    if (contactErrors > 0) {
      console.warn(`[pipeline] skipped ${contactErrors} contacts due to errors`);
    }

    // Build per-list activity from the per-list contact fetches.
    const listMap = new Map<number, ListStats>();
    for (const bl of brevoLists) {
      const listContacts = listContactsByListId.get(bl.id) || [];
      const stat: ListStats = {
        listId: bl.id,
        name: bl.name,
        total: listContacts.length,
        contacted: 0,
        opens: 0,
        clicks: 0,
        replies: 0,
        lastActivityAt: null,
        hidden: hiddenListIds.has(bl.id),
      };
      for (const c of listContacts) {
        const a = c.attributes || {};
        const status = a.OUTREACH_STATUS || 'not_contacted';
        if (status !== 'not_contacted') stat.contacted++;
        if (a.LAST_OPENED_AT) stat.opens++;
        if (a.LAST_CLICKED_AT) stat.clicks++;
        if (status === 'responded') stat.replies++;
        const candidates = [a.LAST_CONTACT_DATE, a.LAST_OPENED_AT, a.LAST_CLICKED_AT, a.LAST_REPLIED_AT].filter(Boolean) as string[];
        for (const iso of candidates) {
          if (!stat.lastActivityAt || new Date(iso).getTime() > new Date(stat.lastActivityAt).getTime()) {
            stat.lastActivityAt = iso;
          }
        }
      }
      listMap.set(bl.id, stat);
    }
    console.log(`[pipeline] per-list tally: ${Array.from(listMap.values()).map(l => `${l.name}=${l.contacted}/${l.total}`).join(', ')}`);

    // Sort attention queues so the most urgent surface first.
    hottest.sort((a, b) => new Date(b.signalAt).getTime() - new Date(a.signalAt).getTime());
    stuck.sort((a, b) => b.daysIn - a.daysIn);
    goingCold.sort((a, b) => b.daysIn - a.daysIn);
    replied.sort((a, b) => new Date(b.signalAt).getTime() - new Date(a.signalAt).getTime());

    // Hydrate reply previews for the top of the replied queue only.
    // We cap at the first 8 (same as the queue display cap) so we don't
    // pay for Blobs reads on contacts that won't be shown anyway.
    const repliedTopN = replied.slice(0, 8);
    await Promise.all(
      repliedTopN.map(async (entry) => {
        const r = await mostRecentReplyForContact(entry.email);
        if (r?.bodyText) {
          entry.replyPreview = r.bodyText.length > 200
            ? r.bodyText.slice(0, 200) + '\u2026'
            : r.bodyText;
        }
      })
    );

    return NextResponse.json({
      // Funnel stages, in narrative order.
      stages: {
        notContacted,
        sent,
        followedUp,
        finalNudge,
        listed,
        cold,
        responded,
      },
      // Engagement layer (independent of stage).
      engagement: {
        delivered,
        opened,
        clicked,
        bounced,
      },
      attention: {
        hottest: hottest.slice(0, 8),
        stuck: stuck.slice(0, 8),
        goingCold: goingCold.slice(0, 8),
        replied: repliedTopN,
        // True totals so we can show "+ N more" if capped.
        hottestTotal: hottest.length,
        stuckTotal: stuck.length,
        goingColdTotal: goingCold.length,
        repliedTotal: replied.length,
      },
      // Lists/towns with outbound activity in flight (≥1 contact past
      // not_contacted). Sorted by recency so the most recently-worked
      // surface first. Empty placeholder lists are filtered out.
      towns: Array.from(listMap.values())
        .filter(t => t.contacted > 0)
        .sort((a, b) => {
          const ta = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
          const tb = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
          return tb - ta;
        }),
      totals: {
        contactsInResults: contacts.length,
        contactsTotal: totalInBrevo,
      },
    });
  } catch (err: any) {
    console.error('[pipeline] crashed:', err?.message, err?.stack);
    return NextResponse.json({
      error: err?.message || 'Pipeline fetch failed',
      type: err?.name || 'Error',
    }, { status: 500 });
  }
}
