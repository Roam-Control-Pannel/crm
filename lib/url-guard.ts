// URL-GUARD-V1
//
// One place that decides whether this server is allowed to fetch a URL.
//
// A serverless function sits inside a network the public cannot reach, so a
// fetch whose address comes from a request body lets the caller borrow that
// position: cloud metadata endpoints, anything else on the private network,
// and — because an error message that echoes the upstream status tells the
// caller whether a port answered — a working scanner.
//
// Three call sites need this, and they do NOT need the same rule, which is
// why the mode is explicit rather than a default:
//
//   'allowlist'  the LinkedIn publish image fetch. The bytes it returns are
//                PUT to LinkedIn as the post image, so the set of acceptable
//                sources is small and knowable: our own origin, and the
//                image host the Unsplash fallback uses. Anything else is a
//                mistake or an attack, and there is no legitimate third case.
//
//   'public'     the two scrapers. Their whole job is to read business
//                websites nobody listed in advance, so a host allowlist
//                would defeat them. They get the weaker but correct rule:
//                any public address, never a private one.
//
// What 'public' actually checks, and what it does not:
//
//   - the scheme is http(s) — no file:, gopher:, data:
//   - the host is not a literal address inside a private, loopback,
//     link-local, carrier-grade-NAT, or metadata range (v4 and v6, including
//     IPv4-mapped v6 like ::ffff:169.254.169.254, which is the form that
//     slips past a naive string check)
//   - every address the hostname RESOLVES to passes the same test, because
//     an attacker controls their own DNS and `internal.example.com` can
//     point at 169.254.169.254
//   - each redirect hop is re-checked, because an allowed host answering 302
//     to an internal address is the same attack with one extra step
//
// It does not close DNS rebinding: between our lookup and the socket, a
// record with a one-second TTL can change. Closing that needs the request to
// be pinned to the address we validated, which Node's fetch does not expose.
// It is a much narrower window than the hole it replaces, and saying so is
// better than implying the problem is solved.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type UrlGuardMode = 'allowlist' | 'public';

export interface UrlGuardOptions {
  mode: UrlGuardMode;
  /** Hosts permitted in 'allowlist' mode, lowercase, exact match. */
  allowedHosts?: string[];
  /** Injectable for tests; defaults to a real DNS lookup. */
  resolve?: (hostname: string) => Promise<string[]>;
}

export interface UrlGuardResult {
  ok: boolean;
  url?: URL;
  /** Safe to show a user and to log. Never contains the upstream's answer. */
  reason?: string;
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true });
  return records.map(r => r.address);
}

/** Expand an IPv6 address to its eight 16-bit groups, or null if malformed. */
function expandV6(address: string): number[] | null {
  const plain = address.replace(/^\[|\]$/g, '').split('%')[0];
  const halves = plain.split('::');
  if (halves.length > 2) return null;

  const parse = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const piece of part.split(':')) {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(piece)) {
        // An embedded IPv4 tail, as in ::ffff:169.254.169.254.
        const octets = piece.split('.').map(Number);
        if (octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        out.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };

  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const gap = 8 - head.length - tail.length;
  if (gap < 0) return null;
  return [...head, ...Array(gap).fill(0), ...tail];
}

/**
 * Is this literal IP address one the server must never be made to fetch?
 *
 * Unknown or unparseable input returns true: refusing something we cannot
 * classify is recoverable, fetching it is not.
 */
export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address);

  if (kind === 4) {
    const o = address.split('.').map(Number);
    if (o.length !== 4 || o.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = o;
    if (a === 0) return true;                         // 0.0.0.0/8 "this network"
    if (a === 10) return true;                        // private
    if (a === 127) return true;                       // loopback
    if (a === 169 && b === 254) return true;          // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true;          // private
    if (a === 100 && b >= 64 && b <= 127) return true;// carrier-grade NAT
    if (a === 192 && b === 0) return true;            // 192.0.0.0/24 and test nets
    if (a >= 224) return true;                        // multicast, reserved, broadcast
    return false;
  }

  if (kind === 6) {
    const g = expandV6(address);
    if (!g) return true;
    const allZero = g.every(x => x === 0);
    if (allZero) return true;                                     // ::
    if (g.slice(0, 7).every(x => x === 0) && g[7] === 1) return true; // ::1 loopback
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — re-test as v4.
    if (g.slice(0, 5).every(x => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
      const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
      return isBlockedAddress(v4);
    }
    if ((g[0] & 0xfe00) === 0xfc00) return true;  // fc00::/7 unique local
    if ((g[0] & 0xffc0) === 0xfe80) return true;  // fe80::/10 link-local
    if (g[0] === 0xff00 || (g[0] & 0xff00) === 0xff00) return true; // multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    if (g[0] === 0x0064 && g[1] === 0xff9b) {
      // 64:ff9b::/96 NAT64 — the embedded v4 decides.
      const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
      return isBlockedAddress(v4);
    }
    return false;
  }

  return true; // not an IP literal at all
}

/**
 * Decide whether `raw` may be fetched. Does not perform the fetch.
 *
 * Call this again for every redirect hop — see fetchGuarded, which does.
 */
export async function checkUrl(raw: string, options: UrlGuardOptions): Promise<UrlGuardResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https URLs can be fetched.' };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (options.mode === 'allowlist') {
    const allowed = (options.allowedHosts || []).map(h => h.toLowerCase());
    if (!allowed.includes(host)) {
      return { ok: false, reason: 'That image host is not permitted.' };
    }
    // An allowlisted host still has to not be a private address, in case the
    // allowlist itself ever names one.
    if (isIP(host) && isBlockedAddress(host)) {
      return { ok: false, reason: 'That image host is not permitted.' };
    }
    return { ok: true, url };
  }

  // 'public': any host on the public internet, never a private address.
  if (isIP(host)) {
    return isBlockedAddress(host)
      ? { ok: false, reason: 'That address is not reachable from here.' }
      : { ok: true, url };
  }

  let addresses: string[];
  try {
    addresses = await (options.resolve || defaultResolve)(host);
  } catch {
    return { ok: false, reason: 'That hostname could not be resolved.' };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: 'That hostname could not be resolved.' };
  }
  // EVERY address must pass: a name with one public and one private record
  // is a rebinding attempt, not a fallback.
  if (addresses.some(isBlockedAddress)) {
    return { ok: false, reason: 'That address is not reachable from here.' };
  }
  return { ok: true, url };
}

export class UrlGuardError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'UrlGuardError';
  }
}

export interface FetchGuardedOptions extends UrlGuardOptions {
  init?: RequestInit;
  /** Redirects to follow, each re-checked. Default 3. */
  maxRedirects?: number;
}

/**
 * Fetch a URL only if the guard allows it, re-checking after every redirect.
 *
 * `redirect: 'manual'` is the point: following redirects automatically means
 * only the first address is ever checked, and an allowed host answering 302
 * to 169.254.169.254 walks straight through.
 *
 * Throws UrlGuardError when the guard refuses. The message is fixed text
 * chosen for a user to read — it must never carry the upstream's status or
 * body, because that is what turns a blocked fetch into a port scanner.
 */
export async function fetchGuarded(
  raw: string,
  options: FetchGuardedOptions
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3;
  let target = raw;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const verdict = await checkUrl(target, options);
    if (!verdict.ok) throw new UrlGuardError(verdict.reason || 'That URL cannot be fetched.');

    const res = await fetch(verdict.url!.toString(), {
      ...options.init,
      redirect: 'manual',
    });

    if (res.status < 300 || res.status > 399) return res;

    const location = res.headers.get('location');
    if (!location) return res;
    // Resolve relative redirects against the hop we just made.
    target = new URL(location, verdict.url!).toString();
  }

  throw new UrlGuardError('That URL redirected too many times.');
}
