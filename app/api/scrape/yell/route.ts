import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const html = await res.text();
    const $ = cheerio.load(html);
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

    $('.businessCapsule--mainRow').each((i: number, el: cheerio.Element) => {
      if (i >= limit) return false;
      const name = $(el).find('.businessCapsule--name').text().trim();
      const address = $(el).find('.businessCapsule--address').text().trim();
      const phone = $(el).find('.businessCapsule--telephone').text().trim();
      const website = $(el).find('a.businessCapsule--websiteLink').attr('href') || '';

      if (name) {
        results.push({
          name,
          address,
          phone,
          website,
          email: '',
          source: 'yell',
          town: town!,
          status: 'not_contacted',
        });
      }
    });

    return NextResponse.json({ results, total: results.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to scrape Yell';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
