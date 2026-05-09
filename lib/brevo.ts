const BREVO_API_KEY = process.env.BREVO_API_KEY!;
const BREVO_BASE = 'https://api.brevo.com/v3';

/**
 * Reply-To address used on every outbound email. Replies sent here are
 * routed to Brevo Inbound Parsing, which posts the parsed payload to
 * /api/brevo/inbound. We match replies back to contacts by sender email.
 *
 * Single shared address is intentional — keeps DNS/SPF simple and is enough
 * for the ~95% case where contacts reply from the same address we sent to.
 * Unmatched senders queue for manual review (see /api/brevo/inbound).
 */
export const REPLY_TO_ADDRESS = 'replies@roam-everywhere.com';

async function brevoFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BREVO_BASE}${path}`, {
    ...options,
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo API error ${res.status}: ${err}`);
  }
  return res.json();
}

export async function getContacts(limit = 50, offset = 0) {
  return brevoFetch(`/contacts?limit=${limit}&offset=${offset}&sort=desc`);
}

export async function createContact(data: {
  email: string;
  firstName?: string;
  lastName?: string;
  attributes?: Record<string, string>;
  listIds?: number[];
}) {
  return brevoFetch('/contacts', {
    method: 'POST',
    body: JSON.stringify({
      email: data.email,
      attributes: {
        FIRSTNAME: data.firstName || '',
        LASTNAME: data.lastName || '',
        ...(data.attributes || {}),
      },
      listIds: data.listIds || [],
      updateEnabled: true,
    }),
  });
}

export async function updateContact(email: string, attributes: Record<string, string>) {
  // If this write would change OUTREACH_STATUS, run it through the guard.
  // canWriteStatus blocks downgrades from sticky states like 'responded'.
  if (attributes.OUTREACH_STATUS) {
    const allowed = await canWriteStatus(email, attributes.OUTREACH_STATUS);
    if (!allowed) {
      // Strip the status field but let other attribute updates through.
      const { OUTREACH_STATUS, ...rest } = attributes;
      if (Object.keys(rest).length === 0) {
        return { skipped: true, reason: 'status guarded' };
      }
      attributes = rest;
    }
  }
  return brevoFetch(`/contacts/${encodeURIComponent(email)}`, {
    method: 'PUT',
    body: JSON.stringify({ attributes }),
  });
}

export async function getContactByEmail(email: string) {
  return brevoFetch(`/contacts/${encodeURIComponent(email)}`);
}

export async function sendTransactionalEmail(data: {
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
  senderName?: string;
  senderEmail?: string;
}) {
  return brevoFetch('/smtp/email', {
    method: 'POST',
    body: JSON.stringify({
      sender: {
        name: data.senderName || 'Roam Local Team',
        email: data.senderEmail || 'hello@roam-everywhere.com',
      },
      to: data.to,
      subject: data.subject,
      htmlContent: data.htmlContent,
      replyTo: {
        email: REPLY_TO_ADDRESS,
        name: data.senderName || 'Roam Local Team',
      },
    }),
  });
}

/**
 * Status transitions that an automated write must respect.
 *
 * Once a contact reaches 'responded' (an inbound reply landed), no automated
 * code path may downgrade that status. Manual UI actions (Reset Status,
 * direct Brevo edits) are out of scope for this guard — they go through
 * different surfaces.
 *
 * Returns true if the write should proceed, false if it must be blocked.
 *
 * Usage:
 *   const allowed = await canWriteStatus(email, 'email_sent');
 *   if (allowed) { ... }
 */
const STICKY_STATUSES = new Set(['responded', 'listed']);

export async function canWriteStatus(
  email: string,
  newStatus: string
): Promise<boolean> {
  // Always permit setting one of the terminal/sticky statuses themselves;
  // the lock is on transitioning AWAY from them via automation.
  if (STICKY_STATUSES.has(newStatus)) return true;
  try {
    const contact = await getContactByEmail(email);
    const current = contact?.attributes?.OUTREACH_STATUS;
    if (current && STICKY_STATUSES.has(current)) {
      console.log(`[status-guard] blocked ${current} -> ${newStatus} for ${email}`);
      return false;
    }
    return true;
  } catch (err: any) {
    // If we can't read the current status (network blip, missing contact),
    // err on the side of allowing the write — better stale than blocked.
    console.warn(`[status-guard] couldn't check ${email}, allowing:`, err?.message);
    return true;
  }
}
