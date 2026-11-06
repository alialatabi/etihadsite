import type { MetadataRoute } from 'next';

// No domain yet, so URLs are relative paths. When a domain exists, set
// `metadataBase` in layout.tsx and prefix these with it.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: '/', changeFrequency: 'monthly', priority: 1 },
    { url: '/how-it-works', changeFrequency: 'monthly', priority: 0.7 },
  ];
}
