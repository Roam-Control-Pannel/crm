import { NextRequest, NextResponse } from 'next/server';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SKIP_DOMAINS = ['sentry.io', 'wixpress.com', 'example.com', 'godaddy.com', 'wordpress.com'];
const SKIP_EXT = /\.(png|jpg|jpeg|gif|webp|svg|css|js|woff|woff2|ttf|ico)$/i;

function pickBestEmail(text: string): string {
  const matches = text.match(EMAIL_RE);
  if (!matches) return '';
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const raw of matches) {
    const e = raw.toLowerCase();
    if (seen.has(e)) continue;
    seen.add(e);
    if (SKIP_EXT.test(e)) continue;
    if (SKIP_DOMAINS.some(d => e.endsWith('@' + d) || e.includes('@' + d))) continue;
    candidates.push(e);
  }
  if (!candidates.length) return '';
  const preferred = candidates.find(e => /^(hello|info|contact|enquiries|hi|bookings|reservations)@/.test(e));
  return preferred || candidates[0];
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RoamLocalBot/1.0)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return '';
  return res.text();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const websiteParam = searchParams.get('website');
    if (!websiteParam) {
      return NextResponse.json({ error: 'website is required' }, { status: 400 });
    }

    let base = websiteParam.trim();
    if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
    let origin: string;
    try {
      origin = new URL(base).origin;
    } catch {
      return NextResponse.json({ email: '' });
    }

    const candidates = [base, `${origin}/contact`, `${origin}/contact-us`, `${origin}/about`];
    for (const url of candidates) {
      try {
        const html = await fetchHtml(url);
        if (!html) continue;
        const email = pickBestEmail(html);
        if (email) return NextResponse.json({ email });
      } catch {
        // try next
      }
    }
    return NextResponse.json({ email: '' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to scrape email';
    return NextResponse.json({ error: message, email: '' }, { status: 500 });
  }
}
