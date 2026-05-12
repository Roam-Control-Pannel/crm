import { NextRequest, NextResponse } from 'next/server';

/**
 * Unsplash download-tracking ping.
 *
 * Per Unsplash API Guideline #2 (Triggering a download), when a user
 * actually USES a photo (selects it for a post, downloads it, publishes
 * it) we MUST hit the photo's `links.download_location` URL. This is how
 * Unsplash counts downloads for their photographers; failing to do it is
 * the most commonly-cited reason for production access rejections.
 *
 * The client calls this route (not Unsplash directly) so the access key
 * stays server-side.
 *
 * See https://help.unsplash.com/en/articles/2511258-guideline-triggering-a-download
 *
 * Returns 200 on success or skip (no key / no URL), never 5xx — the
 * download count is best-effort and shouldn't break the user flow.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_json' });
  }

  const downloadLocation: string | undefined = body?.downloadLocation;
  if (!downloadLocation) {
    return NextResponse.json({ ok: false, reason: 'missing_download_location' });
  }

  // Only accept Unsplash URLs — refuse to be a generic outbound-request
  // proxy. The download_location is always under api.unsplash.com.
  let parsed: URL;
  try {
    parsed = new URL(downloadLocation);
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_url' });
  }
  if (parsed.hostname !== 'api.unsplash.com') {
    return NextResponse.json({ ok: false, reason: 'wrong_host' });
  }

  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    // Dev mode (no key) — nothing to ping; succeed silently so the UI flow
    // is unchanged when developing without an Unsplash app.
    return NextResponse.json({ ok: true, skipped: 'no_key' });
  }

  try {
    const res = await fetch(downloadLocation, {
      headers: { Authorization: `Client-ID ${accessKey}` },
    });
    // Unsplash returns 200 with a JSON body { url: <hot-download-url> }
    // on success. We don't need the body — just confirming the ping fired.
    return NextResponse.json({ ok: res.ok, status: res.status });
  } catch (err: any) {
    console.error('[unsplash/track-download] fetch failed:', err?.message);
    return NextResponse.json({ ok: false, reason: 'fetch_failed' });
  }
}
