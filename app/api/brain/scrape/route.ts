import { NextRequest, NextResponse } from 'next/server';
import { scrapeUrl } from '@/lib/scrape';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Fetch a URL server-side and return clean text. Used both by the Brain
 * page's Add URL flow (to preview before save) and by the AI's scrape_url
 * tool. Does not write anything — purely a fetch utility.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const url = body?.url ? String(body.url).trim() : '';
  if (!url) {
    return NextResponse.json({ ok: false, error: 'url required' }, { status: 400 });
  }
  const result = await scrapeUrl(url);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
