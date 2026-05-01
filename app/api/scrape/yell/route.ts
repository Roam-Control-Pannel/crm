import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const town = searchParams.get('town');
    const type = searchParams.get('type') || 'restaurants';
    const limit = Number(searchParams.get('limit') || 20);

    if (!town) {
      return NextResponse.json({ error: 'town is required' }, { status: 400 });
    }

    const yellUrl = `https://www.yell.com/s/${encodeURIComponent(type)}-${encodeURIComponent(town)}.html`;

    const res = await fetch(yellUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });

    const html = await res.text();

    const results: Array<{
      name: string;
      address: string;
      phone: string;
      website: string;
      email: string;
      source: 'yell';
      town: string;
      status: 'not_contacted';
    }> = [];

    // Extract business names using regex
    const nameMatches = html.matchAll(/class="businessCapsule--name[^"]*"[^>]*>([^<]+)</g);
    const addressMatches = html.matchAll(/class="businessCapsule--address[^"]*"[^>]*>([^<]+)</g);
    const phoneMatches = html.matchAll(/class="businessCapsule--telephone[^"]*"[^>]*>([^<]+)</g);

    const names = Array.from(nameMatches).map(m => m[1].trim());
    const addresses = Array.from(addressMatches).map(m => m[1].trim());
    const phones = Array.from(phoneMatches).map(m => m[1].trim());

    for (let i = 0; i < Math.min(names.length, limit); i++) {
      if (names[i]) {
        results.push({
          name: names[i],
          address: addresses[i] || '',
          phone: phones[i] || '',
          website: '',
          email: '',
          source: 'yell',
          town: town,
          status: 'not_contacted',
        });
      }
    }

    return NextResponse.json({ results, total: results.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to scrape Yell';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
