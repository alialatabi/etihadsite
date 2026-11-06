import type { ClientLogEvent } from '@/lib/types';

/** Fire-and-forget client error log. Never throws, never awaited. */
export function logClient(event: ClientLogEvent): void {
  try {
    const body: ClientLogEvent = {
      ...event,
      message: event.message.slice(0, 500),
      userAgent: event.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : undefined),
    };
    void fetch('/api/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}
