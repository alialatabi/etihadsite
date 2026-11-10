import type { MetadataRoute } from 'next';
import { common, pages } from '@/content/ar';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: common.brand,
    short_name: pages.seo.manifestShort,
    description: pages.seo.description,
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    display: 'standalone',
    theme_color: '#d01c4a',
    background_color: '#fdfbfa',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
