const BREVO_API_KEY = process.env.BREVO_API_KEY!;
const BREVO_BASE = 'https://api.brevo.com/v3';

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
        name: data.senderName || 'Roam Local',
        email: data.senderEmail || 'hello@roamlocal.app',
      },
      to: data.to,
      subject: data.subject,
      htmlContent: data.htmlContent,
    }),
  });
}
