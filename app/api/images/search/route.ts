import { NextRequest, NextResponse } from 'next/server';

/**
 * Unsplash image search proxy.
 *
 * COMPLIANCE NOTES (Unsplash API Guidelines):
 *   1. Attribution: every photo must surface the photographer's name AND a
 *      link back to their Unsplash profile with UTM params, plus a link
 *      back to Unsplash itself. The UI consumes `creditUrl` + `unsplashUrl`
 *      for these; both already include the required UTMs from this route.
 *   2. Download tracking: when a user *uses* a photo (selects it, downloads
 *      it, publishes it) the app MUST POST to the photo's
 *      `links.download_location`. We expose that URL as `downloadLocation`
 *      here; the actual ping is done by /api/images/track-download once a
 *      user picks a photo.
 *   3. UTMs: ?utm_source=<APP_NAME>&utm_medium=referral on every link.
 *
 * See https://help.unsplash.com/en/articles/2511315-guideline-attribution
 *     https://help.unsplash.com/en/articles/2511258-guideline-triggering-a-download
 */

// utm_source value per Unsplash docs — should match the application name
// registered in the Unsplash developer portal. Kept in one place so we can
// update it without hunting through the codebase.
const UTM_SOURCE = 'roam_growth_engine';
const UTM_SUFFIX = `?utm_source=${UTM_SOURCE}&utm_medium=referral`;

function withUtm(url: string | undefined | null): string {
  if (!url) return '';
  // Don't double-append if a UTM is already present (defensive — Unsplash
  // returns clean profile URLs, but cached fixtures might not).
  return url.includes('utm_source=') ? url : url + UTM_SUFFIX;
}

interface UnsplashPhoto {
  urls: { regular: string; small?: string; thumb?: string };
  user: {
    name: string;
    username?: string;
    links: { html: string };
    social?: {
      instagram_username?: string | null;
      twitter_username?: string | null;
    };
  };
  links: {
    html: string;
    download_location: string;
  };
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('query') || 'town landscape';
  const count = parseInt(req.nextUrl.searchParams.get('count') || '6');
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;

  if (!accessKey) {
    // Dev fallback: picsum.photos placeholders. No attribution fields
    // because there's no photographer to credit — but keep the shape
    // consistent with the real response so the client doesn't branch.
    return NextResponse.json({
      images: Array.from({length: count}, (_, i) => ({
        url: `https://picsum.photos/seed/${encodeURIComponent(query+i)}/800/800`,
        thumb: `https://picsum.photos/seed/${encodeURIComponent(query+i)}/400/400`,
        credit: 'Placeholder',
        creditUrl: '',
        photoUrl: '',
        unsplashUrl: 'https://unsplash.com' + UTM_SUFFIX,
        downloadLocation: '',
        socialHandles: {},
      }))
    });
  }

  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}`,
      { headers: { Authorization: `Client-ID ${accessKey}` } }
    );
    const data = await res.json();
    const images = (data.results || []).map((img: UnsplashPhoto) => ({
      url: img.urls.regular,
      thumb: img.urls.small || img.urls.thumb || img.urls.regular,
      credit: img.user.name,
      // creditUrl: link to the photographer's Unsplash profile (with UTM)
      creditUrl: withUtm(img.user.links.html),
      // photoUrl: link to this specific photo on Unsplash (with UTM)
      photoUrl: withUtm(img.links.html),
      // unsplashUrl: link to Unsplash itself (with UTM) for the "on Unsplash"
      // half of the credit line.
      unsplashUrl: 'https://unsplash.com' + UTM_SUFFIX,
      // downloadLocation: the URL the client should POST to (via the
      // track-download route) when a user actually uses this photo. Must
      // NOT be appended with UTM — it's an API endpoint, not a referral.
      downloadLocation: img.links.download_location,
      // socialHandles: photographer's linked social accounts when public.
      // Used at publish time to @-tag them in the caption per Unsplash
      // guidance for social re-posts.
      socialHandles: {
        instagram: img.user.social?.instagram_username || null,
        twitter: img.user.social?.twitter_username || null,
        unsplash: img.user.username || null,
      },
    }));
    return NextResponse.json({ images });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
