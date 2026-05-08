import { NextRequest, NextResponse } from 'next/server';

// Vercel Cron - runs daily at 9am UTC
// Configure in vercel.json or netlify.toml

export const dynamic = 'force-dynamic';

interface BrevoContact {
  id: number;
  email: string;
  attributes: Record<string, string>;
}

async function getContacts(): Promise<BrevoContact[]> {
  const res = await fetch('https://api.brevo.com/v3/contacts?limit=500', {
    headers: {
      'api-key': process.env.BREVO_API_KEY || '',
      'accept': 'application/json',
    },
  });
  const data = await res.json();
  return data.contacts || [];
}

async function sendFollowUp(contact: BrevoContact, step: number): Promise<boolean> {
  const name = contact.attributes?.BUSINESS_NAME || contact.attributes?.FIRSTNAME || contact.email;
  const town = contact.attributes?.TOWN || 'your area';

  const subjects: Record<number, string> = {
    2: `Just checking in — ${town} on Roam`,
    3: `Last one from us — ${name}`,
  };

  const bodies: Record<number, string> = {
    2: `Hi there,\n\nJust a quick follow-up — we'd love to have ${name} on Roam's ${town} page.\n\nIt's completely free and takes 90 seconds. Businesses across ${town} are already signing up.\n\n<a href="https://roam-local.co.uk">Get listed now →</a>\n\nBest wishes,\n— Roam Local Team\nroam-local.co.uk`,
    3: `Hi there,\n\nWe won't chase again after this — promise!\n\nIf you'd like ${name} featured on Roam's ${town} page for free, it only takes 90 seconds.\n\n<a href="https://roam-local.co.uk">List for free →</a>\n\nBest wishes,\n— Roam Local Team\nroam-local.co.uk`,
  };

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Roam Local', email: 'hello@roam-everywhere.com' },
        to: [{ email: contact.email, name }],
        subject: subjects[step],
        htmlContent: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1213;">${bodies[step].replace(/\n/g, '<br/>')}</div>`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function updateContactStatus(email: string, status: string): Promise<void> {
  await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: {
      'api-key': process.env.BREVO_API_KEY || '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ attributes: { OUTREACH_STATUS: status } }),
  });
}

export async function GET(req: NextRequest) {
  // Security check - verify this is called by Netlify/Vercel cron
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('CRON_SECRET env var is not set; refusing to run cron.');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const results = { day2: 0, day7: 0, day14: 0, errors: 0 };

  try {
    const contacts = await getContacts();

    for (const contact of contacts) {
      const status = contact.attributes?.OUTREACH_STATUS;
      const lastContact = contact.attributes?.LAST_CONTACT_DATE;
      
      if (!contact.email || !lastContact) continue;

      const lastDate = new Date(lastContact);
      const daysSince = Math.floor((now.getTime() - lastDate.getTime()) / 86400000);

      // Day 2 — send follow-up
      if (status === 'email_sent' && daysSince >= 2) {
        const sent = await sendFollowUp(contact, 2);
        if (sent) {
          await updateContactStatus(contact.email, 'followed_up');
          results.day2++;
        } else {
          results.errors++;
        }
      }

      // Day 7 — send final nudge
      else if (status === 'followed_up' && daysSince >= 7) {
        const sent = await sendFollowUp(contact, 3);
        if (sent) {
          await updateContactStatus(contact.email, 'final_nudge');
          results.day7++;
        } else {
          results.errors++;
        }
      }

      // Day 14 — mark cold
      else if (status === 'final_nudge' && daysSince >= 14) {
        await updateContactStatus(contact.email, 'cold');
        results.day14++;
      }
    }

    console.log('Cron run complete:', results);
    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      ...results,
      message: `Day2: ${results.day2} sent, Day7: ${results.day7} sent, Day14: ${results.day14} marked cold`,
    });

  } catch (err) {
    console.error('Cron error:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
