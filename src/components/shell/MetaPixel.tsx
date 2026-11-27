'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isMetaExcludedPath } from '@/lib/meta/config';
import { metaTrack } from '@/lib/meta/pixel.client';

/**
 * Mounted once in the root layout next to Tracker: one Meta PageView per route. Renders nothing,
 * and loads nothing without NEXT_PUBLIC_META_PIXEL_ID or on an admin or staff path.
 */
export function MetaPixel() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || isMetaExcludedPath(pathname)) return;
    metaTrack('PageView');
  }, [pathname]);

  return null;
}
