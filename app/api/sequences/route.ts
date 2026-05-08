import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('CRON_SECRET env var is not set; refusing to run sequences.');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  // Accept the secret only via the Authorization header — query strings end up
  // in CDN/access logs.
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const results = { day2: 0, day7: 0, day14: 0, errors: 0, processed: 0 };

  try {
    // Get all contacts
    const res = await fetch('https://api.brevo.com/v3/contacts?limit=500', {
      headers: {
        'api-key': process.env.BREVO_API_KEY || '',
        'accept': 'application/json',
      },
    });
    const data = await res.json();
    const contacts = data.contacts || [];
    results.processed = contacts.length;

    for (const contact of contacts) {
      const status = contact.attributes?.OUTREACH_STATUS;
      const lastContact = contact.attributes?.LAST_CONTACT_DATE;
      const email = contact.email;
      const name = contact.attributes?.BUSINESS_NAME || contact.attributes?.FIRSTNAME || email;
      const town = contact.attributes?.TOWN || 'your area';

      if (!email || !lastContact) continue;

      const lastDate = new Date(lastContact);
      const daysSince = Math.floor((now.getTime() - lastDate.getTime()) / 86400000);

      // Day 2 follow-up
      if (status === 'email_sent' && daysSince >= 2) {
        const subject = `Just checking in — ${town} on Roam`;
        const htmlContent = `<div style="font-family:sans-serif;max-width:560px;color:#1a1213;"><p>Hi there,</p><p>Just a quick follow-up — we'd love to have <strong>${name}</strong> on Roam's ${town} page.</p><p>It's completely free and takes 90 seconds. Businesses across ${town} are already signing up.</p><p><a href="https://roam-local.co.uk" style="color:#9b2752;">Get listed now →</a></p><p>Best wishes,<br/>— Roam Local Team<br/>roam-local.co.uk</p></div>`;
        
        const sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': process.env.BREVO_API_KEY || '', 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender: { name: 'Roam Local', email: 'hello@roam-everywhere.com' }, to: [{ email, name }], subject, htmlContent }),
        });

        if (sendRes.ok) {
          await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
            method: 'PUT',
            headers: { 'api-key': process.env.BREVO_API_KEY || '', 'Content-Type': 'application/json' },
            body: JSON.stringify({ attributes: { OUTREACH_STATUS: 'followed_up', LAST_CONTACT_DATE: now.toISOString().split('T')[0] } }),
          });
          results.day2++;
        } else { results.errors++; }
      }

      // Day 7 final nudge
      else if (status === 'followed_up' && daysSince >= 7) {
        const subject = `Last one from us — ${name}`;
        const htmlContent = `<div style="font-family:sans-serif;max-width:560px;color:#1a1213;"><p>Hi there,</p><p>We won't chase again after this — promise!</p><p>If you'd like <strong>${name}</strong> featured on Roam's ${town} page for free, it only takes 90 seconds.</p><p><a href="https://roam-local.co.uk" style="color:#9b2752;">List for free →</a></p><p>Best wishes,<br/>— Roam Local Team<br/>roam-local.co.uk</p></div>`;

        const sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': process.env.BREVO_API_KEY || '', 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender: { name: 'Roam Local', email: 'hello@roam-everywhere.com' }, to: [{ email, name }], subject, htmlContent }),
        });

        if (sendRes.ok) {
          await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
            method: 'PUT',
            headers: { 'api-key': process.env.BREVO_API_KEY || '', 'Content-Type': 'application/json' },
            body: JSON.stringify({ attributes: { OUTREACH_STATUS: 'final_nudge', LAST_CONTACT_DATE: now.toISOString().split('T')[0] } }),
          });
          results.day7++;
        } else { results.errors++; }
      }

      // Day 14 mark cold
      else if (status === 'final_nudge' && daysSince >= 14) {
        await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
          method: 'PUT',
          headers: { 'api-key': process.env.BREVO_API_KEY || '', 'Content-Type': 'application/json' },
          body: JSON.stringify({ attributes: { OUTREACH_STATUS: 'cold' } }),
        });
        results.day14++;
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      ...results,
      message: `Processed ${results.processed} contacts. Day2: ${results.day2} sent, Day7: ${results.day7} sent, Day14: ${results.day14} marked cold, Errors: ${results.errors}`,
    });

  } catch (err) {
    console.error('Sequence error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
