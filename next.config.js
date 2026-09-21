/** @type {import('next').NextConfig} */
const securityHeaders = [
  // Stop clickjacking — the app is never embedded by design.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Stop MIME sniffing — browser must trust the Content-Type we send.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Don't leak full URLs (with query params that may contain tokens) to
  // third-party origins via the Referer header.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable powerful browser features we never use; limits damage if
  // script execution is ever achieved.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  // Force HTTPS for two years, including subdomains. Netlify serves HTTPS
  // already; this just makes the browser remember.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig = {
  reactStrictMode: true,
  // LINT-V1: `next lint` defaults to app/pages/components/lib/src, which
  // leaves the scheduled functions in netlify/ unchecked — the very code that
  // had no fetch timeouts. Listing the dirs explicitly brings them in, for
  // both `npm run lint` and the build-time lint pass.
  eslint: {
    dirs: ['app', 'components', 'lib', 'netlify', 'types'],
  },
  // GRAPHIC-COMPOSE-V1
  // lib/compose-graphic.ts reads the brand font and the lion mark from disk at
  // render time, through paths built from process.cwd(). Next's tracer follows
  // static imports, not runtime path joins, so without this the files are left
  // out of the deployed function bundle. A missing logo is skipped with a
  // warning; a missing font makes the route throw by design, because the
  // alternative is Pango quietly substituting a face and shipping an off-brand
  // graphic nobody notices.
  outputFileTracingIncludes: {
    '/api/social/compose': ['./assets/fonts/**', './public/logo-lionFav-icon.png'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
