import type { T } from './harness';
import { isBlockedAddress, checkUrl, UrlGuardError } from '@/lib/url-guard';

/** A resolver that answers from a fixed map, so no test touches real DNS. */
const resolver = (map: Record<string, string[]>) => async (host: string) => {
  const hit = map[host];
  if (!hit) throw new Error('NXDOMAIN');
  return hit;
};

const PUBLIC = { mode: 'public' as const, resolve: resolver({ 'example.com': ['93.184.216.34'] }) };

export async function run(t: T) {
  t.group('addresses the server must never be made to fetch');
  for (const addr of [
    '127.0.0.1', '127.1.2.3',            // loopback
    '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1', // private
    '169.254.169.254',                    // cloud metadata — the one that matters
    '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1',
    '::ffff:169.254.169.254',             // IPv4-mapped metadata
    '::ffff:127.0.0.1',
    '64:ff9b::a9fe:a9fe',                 // NAT64-wrapped metadata
    'not-an-ip', '',
  ]) {
    t.ok(`blocked: ${addr || '(empty)'}`, isBlockedAddress(addr));
  }

  t.group('ordinary public addresses are allowed');
  for (const addr of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '192.167.1.1', '2606:4700::1111']) {
    t.ok(`allowed: ${addr}`, !isBlockedAddress(addr));
  }

  t.group('scheme');
  for (const raw of ['file:///etc/passwd', 'gopher://x/', 'data:text/html,hi', 'ftp://x/']) {
    const v = await checkUrl(raw, PUBLIC);
    t.ok(`rejected: ${raw.slice(0, 20)}`, !v.ok);
  }
  t.ok('http allowed', (await checkUrl('http://example.com/x', PUBLIC)).ok);
  t.ok('https allowed', (await checkUrl('https://example.com/x', PUBLIC)).ok);

  t.group('public mode: literal private addresses');
  {
    const v = await checkUrl('http://169.254.169.254/latest/meta-data/', PUBLIC);
    t.ok('metadata IP refused', !v.ok);
    t.is('with a message that reveals nothing', v.reason, 'That address is not reachable from here.');
  }

  t.group('public mode: a hostname that RESOLVES to a private address');
  {
    const sneaky = {
      mode: 'public' as const,
      resolve: resolver({ 'internal.example.com': ['169.254.169.254'] }),
    };
    const v = await checkUrl('https://internal.example.com/', sneaky);
    t.ok('refused on the resolved address, not the name', !v.ok);

    // One public and one private record is a rebinding attempt, not a fallback.
    const mixed = {
      mode: 'public' as const,
      resolve: resolver({ 'both.example.com': ['93.184.216.34', '10.0.0.1'] }),
    };
    t.ok('refused when ANY resolved address is private', !(await checkUrl('https://both.example.com/', mixed)).ok);

    const clean = { mode: 'public' as const, resolve: resolver({ 'ok.example.com': ['93.184.216.34'] }) };
    t.ok('allowed when every resolved address is public', (await checkUrl('https://ok.example.com/', clean)).ok);

    const dead = { mode: 'public' as const, resolve: resolver({}) };
    t.ok('refused when the name does not resolve', !(await checkUrl('https://nope.example.com/', dead)).ok);
  }

  t.group('allowlist mode: the publish image fetch');
  {
    const opts = { mode: 'allowlist' as const, allowedHosts: ['images.unsplash.com', 'roam-crm-platform.netlify.app'] };
    t.ok('an allowed host passes', (await checkUrl('https://images.unsplash.com/photo-1', opts)).ok);
    t.ok('our own origin passes', (await checkUrl('https://roam-crm-platform.netlify.app/api/images/abc', opts)).ok);
    t.ok('case-insensitive on the host', (await checkUrl('https://IMAGES.UNSPLASH.COM/x', opts)).ok);

    const bad = await checkUrl('http://10.0.0.5:8080/internal-dashboard', opts);
    t.ok('an internal address is refused', !bad.ok);
    t.is('message reveals nothing', bad.reason, 'That image host is not permitted.');
    t.ok('any other public host is refused too', !(await checkUrl('https://evil.example.com/x.jpg', opts)).ok);
    t.ok('a lookalike subdomain is refused', !(await checkUrl('https://images.unsplash.com.evil.test/x', opts)).ok);
    t.ok('userinfo cannot spoof the host',
      !(await checkUrl('https://images.unsplash.com@10.0.0.5/x', opts)).ok);
  }

  t.group('malformed input');
  for (const raw of ['', 'http://', 'not a url', '///', 'https://[::ffff:169.254.169.254]/']) {
    const v = await checkUrl(raw, PUBLIC);
    t.ok(`refused: ${JSON.stringify(raw)}`, !v.ok);
  }

  t.group('the guard error is safe to show');
  {
    const e = new UrlGuardError('That address is not reachable from here.');
    t.is('name', e.name, 'UrlGuardError');
    t.ok('carries no upstream status', !/\d{3}/.test(e.message));
  }
}
