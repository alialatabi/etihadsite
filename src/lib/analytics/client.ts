/** Browser side of the first-party analytics beacon (POST /api/track). No React, no server code. */
import type { BuilderStep, InstallEvent } from '@/lib/types';

/** What the browser sends; the route validates it again. */
export type TrackPayload =
  | { type: 'pageview'; path: string; referrer?: string; utm?: string }
  | { type: 'step'; step: BuilderStep; path: string }
  | { type: 'install'; step: InstallEvent; path: string };

/** Fire-and-forget analytics beacon to /api/track (sendBeacon, fetch keepalive fallback). */
export function sendTrack(payload: TrackPayload): void {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))) return;
    }
    void fetch('/api/track', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      keepalive: true,
    }).catch(() => {});
  } catch {}
}
