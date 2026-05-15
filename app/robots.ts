import type { MetadataRoute } from 'next';

// Roam Growth Engine is a private CRM behind a login wall. Nothing here
// should be indexed by search engines.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
