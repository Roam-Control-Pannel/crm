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
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
