import { NextRequest, NextResponse } from 'next/server';
import { fetchPendingReplies, markProcessed } from '@/lib/imap';
import { addNotification } from '@/lib/notifications';
import { storeReply } from '@/lib/replies';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Inbound reply poller.
 *
 * Pulls UNSEEN messages from the shared `hello@` mailbox addressed to our
 * `replies@` / `reply@` aliases, matches each by sender email to a Brevo
 * contact (auto-creating one if no match), updates engagement attributes,
 * and fires a notification.
 *
 * Auth: bearer ${CRON_SECRET_V2} on Authorization header. Called by the
 * scheduled function `netlify/functions/inbound-poll.mts` every 15 minutes,
 * and exposed at GET /api/inbound/poll for manual triggering.
 *
 * Public route — middleware exempts this path. See PUBLIC_API_ROUTES in
 * middleware.ts.
 */

const BREVO_BASE = 'https://api.brevo.com/v3';

interface BrevoContact {
  id: number;
  email: string;
  attributes?: Record<string, any>;
}

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') === secret) return true;
  return false;
}

async function brevoGetContact(email: string): Promise<BrevoContact | null> {
  try {
    const res = await fetch(`${BREVO_BASE}/contacts/${encodeURIComponent(email)}`, {
      headers: { 'api-key': process.env.BREVO_API_KEY || '', accept: 'application/json' },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text();
      console.error(`[inbound] brevoGetContact ${res.status} for ${email}: ${body.slice(0, 200)}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.error(`[inbound] brevoGetContact threw for ${email}:`, err?.message);
    return null;
  }
}

async function brevoUpdate(email: string, attributes: Record<string, any>): Promise<boolean> {
  try {
    const res = await fetch(`${BREVO_BASE}/contacts/${encodeURIComponent(email)}`, {
      method: 'PUT',
      headers: {
        'api-key': process.env.BREVO_API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ attributes }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[inbound] brevoUpdate ${res.status} for ${email}: ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[inbound] brevoUpdate threw for ${email}:`, err?.message);
    return false;
  }
}

async function brevoCreateContact(email: string, name: string | null): Promise<boolean> {
  try {
    const attributes: Record<string, any> = {
      OUTREACH_STATUS: 'responded',
      LAST_REPLIED_AT: new Date().toISOString(),
      REPLY_COUNT: 1,
    };
    if (name) attributes.BUSINESS_NAME = name;
    const res = await fetch(`${BREVO_BASE}/contacts`, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, attributes, updateEnabled: true }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[inbound] brevoCreateContact ${res.status} for ${email}: ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[inbound] brevoCreateContact threw for ${email}:`, err?.message);
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stats = {
    fetched: 0,
    matched: 0,        // existing Brevo contacts
    created: 0,        // new Brevo contacts
    autoResponders: 0, // skipped status-flip
    errors: 0,
    processedUids: [] as number[],
  };

  try {
    const replies = await fetchPendingReplies();
    stats.fetched = replies.length;
    console.log(`[inbound] fetched ${replies.length} pending replies`);

    if (replies.length === 0) {
      return NextResponse.json({ ok: true, ...stats, message: 'No new replies' });
    }

    const now = new Date().toISOString();

    for (const reply of replies) {
      try {
        // Persist EVERY reply (including auto-responders) so the contact
        // timeline can show them. Auto-responders render greyed-out in the UI.
        await storeReply({
          uid: reply.uid,
          fromEmail: reply.fromEmail,
          fromName: reply.fromName,
          subject: reply.subject,
          bodyText: reply.bodyText,
          bodyTextRaw: reply.bodyTextRaw,
          receivedAt: reply.receivedAt,
          isAutoResponder: reply.isAutoResponder,
        });

        // Auto-responders: log + mark processed, but don't flip status
        if (reply.isAutoResponder) {
          stats.autoResponders++;
          stats.processedUids.push(reply.uid);
          console.log(`[inbound] auto-responder from ${reply.fromEmail}, skipping status flip`);
          continue;
        }

        const existing = await brevoGetContact(reply.fromEmail);
        const truncatedSubject = reply.subject.slice(0, 200);

        if (existing) {
          const prevReplyCount = Number(existing.attributes?.REPLY_COUNT || 0);
          const ok = await brevoUpdate(reply.fromEmail, {
            OUTREACH_STATUS: 'responded',
            LAST_REPLIED_AT: now,
            LAST_REPLY_SUBJECT: truncatedSubject,
            REPLY_COUNT: String(prevReplyCount + 1),
          });
          if (ok) {
            stats.matched++;
            const displayName = existing.attributes?.BUSINESS_NAME
              || reply.fromName
              || reply.fromEmail;
            await addNotification({
              type: 'hot_lead',
              title: `\ud83d\udcac ${displayName} replied`,
              body: truncatedSubject,
              dedupeKey: `reply:${reply.fromEmail}:${reply.uid}`,
              contactEmail: reply.fromEmail,
              href: `/contacts?search=${encodeURIComponent(reply.fromEmail)}`,
            });
            stats.processedUids.push(reply.uid);
          } else {
            stats.errors++;
          }
        } else {
          // Auto-create per Andy's preference — see handover for design rationale
          const ok = await brevoCreateContact(reply.fromEmail, reply.fromName);
          if (ok) {
            stats.created++;
            await addNotification({
              type: 'hot_lead',
              title: `\ud83d\udcac New reply from ${reply.fromName || reply.fromEmail}`,
              body: `${truncatedSubject} (auto-added to contacts)`,
              dedupeKey: `reply-new:${reply.fromEmail}:${reply.uid}`,
              contactEmail: reply.fromEmail,
              href: `/contacts?search=${encodeURIComponent(reply.fromEmail)}`,
            });
            stats.processedUids.push(reply.uid);
          } else {
            stats.errors++;
          }
        }
      } catch (err: any) {
        console.error(`[inbound] processing reply uid=${reply.uid} failed:`, err?.message);
        stats.errors++;
      }
    }

    // Mark all successfully-processed messages with the Gmail label so we
    // don't re-process them on the next poll. Failures here are non-fatal —
    // worst case we'd reprocess, and the dedupeKey on notifications + Brevo
    // upsert semantics make that safe.
    if (stats.processedUids.length > 0) {
      await markProcessed(stats.processedUids);
    }

    const message = `Processed ${stats.fetched} replies · matched ${stats.matched} · created ${stats.created} · auto-responders ${stats.autoResponders}${stats.errors ? ' · ' + stats.errors + ' errors' : ''}`;
    console.log(`[inbound] ${message}`);
    return NextResponse.json({ ok: true, ...stats, message });
  } catch (err: any) {
    // imapflow wraps the real IMAP server response in a generic "Command failed".
    // Surface the underlying fields so we can see what Gmail actually said.
    const diagnostic = {
      message: err?.message,
      code: err?.code,
      authenticationFailed: err?.authenticationFailed,
      response: err?.response,
      responseText: err?.responseText,
      responseStatus: err?.responseStatus,
      cause: err?.cause?.message || err?.cause,
      stack: err?.stack?.split('\n').slice(0, 5).join(' | '),
    };
    console.error('[inbound] poll crashed:', JSON.stringify(diagnostic, null, 2));
    return NextResponse.json(
      { ok: false, error: err?.message || 'Poll failed', diagnostic, ...stats },
      { status: 500 }
    );
  }
}
