import { NextResponse } from 'next/server';
import { getContacts } from '@/lib/brevo';

type BrevoContact = {
  attributes?: {
    OUTREACH_STATUS?: string;
    TOWN?: string;
  };
};

export async function GET() {
  try {
    const data = await getContacts(500, 0);
    const contacts: BrevoContact[] = data.contacts || [];
    const total: number = typeof data.count === 'number' ? data.count : contacts.length;

    let listed = 0, emailSent = 0, followedUp = 0, responded = 0, cold = 0, notContacted = 0;
    const townSet = new Set<string>();

    for (const c of contacts) {
      const status = c.attributes?.OUTREACH_STATUS || 'not_contacted';
      if (status === 'listed') listed++;
      else if (status === 'email_sent') emailSent++;
      else if (status === 'followed_up') followedUp++;
      else if (status === 'responded') responded++;
      else if (status === 'cold') cold++;
      else notContacted++;

      const town = c.attributes?.TOWN;
      if (town) townSet.add(town);
    }

    const followUpsDue = emailSent + followedUp;
    const emailsSent = emailSent + followedUp + responded + listed + cold;
    const replyRate = emailsSent > 0 ? Math.round(((responded + listed) / emailsSent) * 100) : 0;

    return NextResponse.json({
      total,
      sampled: contacts.length,
      towns: townSet.size,
      listed,
      emailsSent,
      followUpsDue,
      responded,
      replyRate,
      breakdown: { notContacted, emailSent, followedUp, responded, listed, cold },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch stats';
    return NextResponse.json({ error: message, total: 0, towns: 0, listed: 0, emailsSent: 0, followUpsDue: 0, responded: 0, replyRate: 0 }, { status: 500 });
  }
}
