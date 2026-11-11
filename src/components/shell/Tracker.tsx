'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { sendTrack, type TrackPayload } from '@/lib/analytics/client';
import { isStaffPath } from '@/lib/analytics/paths';

const FIRST_KEY = 'softy-tracked';

/** Mounted once in the root layout: one pageview per route; referrer/utm only on the session's first. */
export function Tracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname.startsWith('/admin') || isStaffPath(pathname)) return;
    const payload: Extract<TrackPayload, { type: 'pageview' }> = { type: 'pageview', path: pathname.slice(0, 200) };
    let first = true;
    try {
      first = sessionStorage.getItem(FIRST_KEY) !== '1';
      if (first) sessionStorage.setItem(FIRST_KEY, '1');
    } catch {}
    if (first) {
      payload.referrer = document.referrer.slice(0, 500);
      const utm = new URLSearchParams(window.location.search).get('utm_source');
      if (utm) payload.utm = utm.slice(0, 60);
    }
    sendTrack(payload);
  }, [pathname]);

  return null;
}
