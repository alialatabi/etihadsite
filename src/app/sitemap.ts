import type { MetadataRoute } from 'next';

// URLs are relative paths because `metadataBase` is not set in layout.tsx. To publish
// absolute URLs, set it there and prefix these with it.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: '/', changeFrequency: 'monthly', priority: 1 },
    { url: '/how-it-works', changeFrequency: 'monthly', priority: 0.7 },
  ];
}
