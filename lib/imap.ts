/**
 * IMAP polling for inbound replies.
 *
 * Connects to the shared `hello@` mailbox (which has `replies@` and `reply@`
 * as aliases — see Google Workspace setup) and pulls UNSEEN messages addressed
 * to those alias addresses.
 *
 * Auth: app password from Google (2FA must be enabled on the account first).
 * Stored as IMAP_USER + IMAP_PASS env vars on Netlify.
 *
 * After processing, messages are tagged with the Gmail label `crm-processed`
 * (auto-created on first use). We use a label rather than just marking-as-read
 * so the user can still see in their normal Gmail UI which replies the CRM
 * has handled, and so re-processing is idempotent (we filter on the absence
 * of the label).
 */
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser';

const IMAP_HOST = 'imap.gmail.com';
const IMAP_PORT = 993;
const REPLY_ALIASES = [
  'replies@roam-local.com',
  'reply@roam-local.com',
  // Legacy roam-everywhere.com aliases: emails already sent carry the old
  // reply-to address, so keep matching them until those threads go quiet.
  'replies@roam-everywhere.com',
  'reply@roam-everywhere.com',
];
const PROCESSED_LABEL = 'crm-processed';

export interface InboundReply {
  uid: number;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  bodyText: string;       // quote-stripped, ready for storage/display
  bodyTextRaw: string;    // full body including quoted history (kept for fallback)
  receivedAt: string;     // ISO timestamp
  isAutoResponder: boolean;
  deliveredTo: string;    // which alias the mail was addressed to
}

/** Connect with credentials from env. Throws if unconfigured. */
async function connect(): Promise<ImapFlow> {
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASS;
  if (!user || !pass) {
    throw new Error('IMAP_USER and IMAP_PASS env vars must be set');
  }
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user, pass },
    logger: false, // imapflow's own logging is too chatty for production
  });
  await client.connect();
  return client;
}

/**
 * Strip quoted history from a reply body. Most clients prefix quotes with
 * either "On <date> <name> wrote:" or `>` markers, or sometimes a horizontal
 * separator. We cut at the first such marker. The original is kept too in
 * case stripping over-fires.
 */
export function stripQuotedReply(body: string): string {
  if (!body) return '';
  const patterns: RegExp[] = [
    /^On .+ wrote:\s*$/m,
    /^On .+,\s*$/m,        // "On Mon, May 9, 2026 at 3:00 PM,"
    // Gmail wraps the "On <date> <name> <email>" line across two lines so the
    // closing "wrote:" lands on its own line. Match that case explicitly.
    /^On .+\n\s*wrote:\s*$/m,
    /^On .+\n.*\nwrote:\s*$/m,
    /^From: .+$/m,          // Outlook-style
    /^-{2,}\s*Original Message\s*-{2,}$/im,
    /^_{2,}\s*$/m,          // some clients use lots of underscores
    /^>+\s/m,
  ];
  let cutIndex = body.length;
  for (const pat of patterns) {
    const match = body.match(pat);
    if (match && match.index !== undefined && match.index < cutIndex) {
      cutIndex = match.index;
    }
  }
  return body.slice(0, cutIndex).trim();
}

/**
 * Best-effort auto-responder detection. Returns true if the message is likely
 * an out-of-office, auto-reply, or no-reply bounce. We err on the side of
 * flagging — a flagged auto-responder still gets stored on the timeline as
 * `auto_reply_received`, just doesn't flip OUTREACH_STATUS to `responded`.
 */
export function detectAutoResponder(parsed: ParsedMail): boolean {
  // RFC 3834: explicit auto-submitted header
  const autoSubmitted = parsed.headers.get('auto-submitted');
  if (autoSubmitted && String(autoSubmitted).toLowerCase() !== 'no') {
    return true;
  }
  // Microsoft / Outlook: X-Auto-Response-Suppress
  if (parsed.headers.get('x-auto-response-suppress')) return true;
  // Common auto-response headers
  if (parsed.headers.get('x-autoreply') || parsed.headers.get('x-autorespond')) {
    return true;
  }

  // Subject heuristics
  const subject = (parsed.subject || '').toLowerCase();
  if (/^(out of office|automatic reply|auto[\s-]?repl(y|ied)|away from)/i.test(subject)) {
    return true;
  }

  // Sender localpart heuristics
  const fromAddr = extractFromEmail(parsed);
  if (fromAddr) {
    const local = fromAddr.split('@')[0].toLowerCase();
    if (['noreply', 'no-reply', 'donotreply', 'do-not-reply',
         'mailer-daemon', 'postmaster', 'bounce', 'notifications']
        .includes(local)) {
      return true;
    }
  }

  return false;
}

function extractFromEmail(parsed: ParsedMail): string | null {
  const from = parsed.from;
  if (!from) return null;
  // mailparser's AddressObject has either a value array or a text fallback
  const addr = (from as AddressObject).value?.[0]?.address;
  return addr ? addr.toLowerCase() : null;
}

function extractFromName(parsed: ParsedMail): string | null {
  const from = parsed.from;
  if (!from) return null;
  return (from as AddressObject).value?.[0]?.name || null;
}

/**
 * Pull which of our aliases this message was addressed to. Gmail puts the
 * actual recipient in `Delivered-To` (more reliable than `To` for aliases).
 * We accept either.
 */
function extractDeliveredTo(parsed: ParsedMail): string {
  const deliveredTo = parsed.headers.get('delivered-to');
  if (deliveredTo) {
    const val = Array.isArray(deliveredTo) ? deliveredTo[0] : deliveredTo;
    const lower = String(val).toLowerCase();
    for (const alias of REPLY_ALIASES) {
      if (lower.includes(alias)) return alias;
    }
  }
  // Fallback: scan To field
  const to = parsed.to;
  if (to) {
    const addrs = Array.isArray(to) ? to : [to];
    for (const t of addrs) {
      for (const v of (t as AddressObject).value || []) {
        const a = v.address?.toLowerCase();
        if (a && REPLY_ALIASES.includes(a)) return a;
      }
    }
  }
  return REPLY_ALIASES[0]; // shouldn't happen — IMAP search filters on these
}

/**
 * Fetch unprocessed replies. Connects, searches for UNSEEN mail addressed to
 * any of our aliases that does NOT carry the processed label, parses each
 * one, returns structured objects. Caller is responsible for marking each
 * as processed via `markProcessed()` after persisting.
 */
export async function fetchPendingReplies(): Promise<InboundReply[]> {
  const client = await connect();
  const replies: InboundReply[] = [];

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Search: messages addressed to any of our aliases that DON'T already
      // have our processed label. Gmail exposes labels as IMAP keywords so
      // we can use $NOT-keyword in search criteria.
      // Note: Gmail's IMAP search OR semantics are awkward — we issue
      // multiple searches and merge UID sets.
      const allUids = new Set<number>();
      for (const alias of REPLY_ALIASES) {
        const uids = await client.search({
          to: alias,
          // not: { keyword: PROCESSED_LABEL }  // imapflow doesn't expose 'not' cleanly; we filter post-fetch
        }, { uid: true });
        if (Array.isArray(uids)) uids.forEach((u) => allUids.add(u));
      }

      if (allUids.size === 0) {
        return [];
      }

      // Fetch headers + flags + full source for each candidate
      for await (const msg of client.fetch([...allUids], {
        uid: true,
        flags: true,
        source: true,
      })) {
        // Skip messages already labelled processed
        const flags = msg.flags ? Array.from(msg.flags) : [];
        if (flags.includes(PROCESSED_LABEL)) continue;

        const parsed = await simpleParser(msg.source as Buffer);
        const fromEmail = extractFromEmail(parsed);
        if (!fromEmail) continue; // skip malformed

        const rawBody = parsed.text || '';
        replies.push({
          uid: msg.uid,
          fromEmail,
          fromName: extractFromName(parsed),
          subject: parsed.subject || '(no subject)',
          bodyText: stripQuotedReply(rawBody),
          bodyTextRaw: rawBody,
          receivedAt: (parsed.date || new Date()).toISOString(),
          isAutoResponder: detectAutoResponder(parsed),
          deliveredTo: extractDeliveredTo(parsed),
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return replies;
}

/**
 * Mark a message as processed by adding the `crm-processed` Gmail label.
 * Idempotent — Gmail silently ignores adding a label that's already present.
 * Failure here is non-fatal (we'll just retry and dedupe via Brevo state),
 * but logged.
 */
export async function markProcessed(uids: number[]): Promise<void> {
  if (uids.length === 0) return;
  const client = await connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // imapflow's messageFlagsAdd works on UIDs and accepts custom keywords
      await client.messageFlagsAdd({ uid: uids.join(',') }, [PROCESSED_LABEL], {
        uid: true,
      });
    } finally {
      lock.release();
    }
  } catch (err: any) {
    console.error('[imap] markProcessed failed:', err?.message);
  } finally {
    await client.logout();
  }
}
