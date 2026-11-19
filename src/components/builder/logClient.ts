import { reportClientError } from '@/lib/monitoring/report.client';
import type { ClientLogEvent } from '@/lib/types';

export interface LogClientOptions {
  /**
   * Also send this to Sentry. Pass it only for a REAL failure (a thrown error, a degraded order),
   * never for an expected user error (unsupported file, validation). `error` is the thrown value, if any.
   * Only ids and codes go along: the file type and size, never the file name or the customer's data.
   */
  report?: { error?: unknown };
}

/** Fire-and-forget client error log. Never throws, never awaited. */
export function logClient(event: ClientLogEvent, options: LogClientOptions = {}): void {
  if (options.report) {
    reportClientError(options.report.error ?? new Error(`[client:${event.step}] ${event.message.slice(0, 200)}`), {
      where: `builder.${event.step}`,
      extra: { fileType: event.fileType, fileSize: event.fileSize },
    });
  }
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
