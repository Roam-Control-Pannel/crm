/**
 * Lightweight server-side web scraper.
 *
 * Fetches a URL, strips out scripts/styles/HTML, decodes common entities,
 * and returns clean-ish text the AI can read or save into the Brain.
 *
 * Deliberately no dependency on cheerio/readability — keeps the function
 * lean and works in any Node runtime. For pages with heavy SPAs or
 * Cloudflare challenges, the user can always paste content manually.
 */

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 2_000_000; // 2 MB ceiling — guards against runaway downloads
const MAX_TEXT = 60_000;     // cap stored/returned text so we don't blow Brain blobs

export interface ScrapeResult {
  ok: boolean;
  url: string;
  finalUrl?: string;
  title?: string;
  text?: string;
  truncated?: boolean;
  error?: string;
  contentType?: string;
}

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  // Validate + normalise. We only handle http(s); anything else gets rejected
  // before we burn a network call.
  let normalised: URL;
  try {
    normalised = new URL(url);
  } catch {
    return { ok: false, url, error: 'Invalid URL' };
  }
  if (normalised.protocol !== 'http:' && normalised.protocol !== 'https:') {
    return { ok: false, url, error: 'Only http(s) URLs are supported' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(normalised.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Some sites refuse the default node UA. Pretend to be a recent
        // browser so we get the same HTML a user would see.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    });

    if (!res.ok) {
      return { ok: false, url, error: `Request returned ${res.status}` };
    }

    const contentType = res.headers.get('content-type') || '';

    // Plain-text and markdown URLs (e.g. raw GitHub files) can be returned
    // as-is — skip the HTML pipeline entirely.
    if (contentType.startsWith('text/plain') || contentType.includes('markdown')) {
      const raw = await readWithCap(res);
      return finalise({ url, finalUrl: res.url, contentType, text: raw });
    }

    // Non-text content types (PDFs, images, JSON, etc.) aren't useful as
    // free-text context — bail out so we don't store binary as a "doc".
    if (contentType && !contentType.includes('html') && !contentType.startsWith('text/')) {
      return {
        ok: false,
        url,
        finalUrl: res.url,
        contentType,
        error: `Content type "${contentType}" can't be scraped as text. Save the file directly instead.`,
      };
    }

    const html = await readWithCap(res);
    const { title, text } = extractFromHtml(html);
    return finalise({ url, finalUrl: res.url, contentType, title, text });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, url, error: `Timed out after ${FETCH_TIMEOUT_MS}ms` };
    }
    return { ok: false, url, error: err?.message || 'Fetch failed' };
  } finally {
    clearTimeout(timer);
  }
}

async function readWithCap(res: Response): Promise<string> {
  const text = await res.text();
  return text.slice(0, MAX_BYTES);
}

function finalise(
  partial: { url: string; finalUrl?: string; contentType?: string; title?: string; text?: string }
): ScrapeResult {
  const raw = (partial.text || '').trim();
  const truncated = raw.length > MAX_TEXT;
  return {
    ok: true,
    url: partial.url,
    finalUrl: partial.finalUrl,
    contentType: partial.contentType,
    title: partial.title,
    text: truncated ? raw.slice(0, MAX_TEXT) + '\n\n…[truncated]' : raw,
    truncated,
  };
}

/**
 * Pull a usable title and clean-ish body text out of an HTML string.
 * Strips <script>, <style>, <noscript>, comments, then all remaining tags,
 * then collapses whitespace. Good enough for most article-style pages;
 * SPAs with empty <body>s will return whatever shell HTML they ship with.
 */
function extractFromHtml(html: string): { title?: string; text: string } {
  // Title from <title> if present, else <h1>.
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  let title = titleMatch ? decodeEntities(stripTags(titleMatch[1])).trim() : undefined;
  if (!title) {
    const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    if (h1Match) title = decodeEntities(stripTags(h1Match[1])).trim();
  }

  let body = html
    // Comments
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Drop entire <head> — it's metadata, not content
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    // Scripts and styles, including their contents
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    // Nav/footer chrome — best-effort, helps article quality
    .replace(/<(nav|footer|aside|header)\b[\s\S]*?<\/\1>/gi, ' ');

  // Insert line breaks at block boundaries so paragraphs survive tag stripping.
  body = body
    .replace(/<\/(p|div|li|h[1-6]|tr|article|section|br)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  body = stripTags(body);
  body = decodeEntities(body);

  // Collapse runs of whitespace; preserve paragraph breaks.
  body = body
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map(l => l.trim()).join('\n')
    .trim();

  return { title, text: body };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
