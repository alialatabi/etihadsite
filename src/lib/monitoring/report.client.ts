/**
 * Manual error reporting for BROWSER code: errors that are caught and handled (a degraded screen,
 * a failed upload, a design that cannot be read) but that the owner wants to know about.
 * Server code uses ./report.ts.
 *
 * - Never throws; safe to call anywhere (a no-op while NEXT_PUBLIC_SENTRY_DSN is unset).
 * - Context is ids, step names and error codes ONLY. Never the customer's name, phone, address,
 *   file name or file contents.
 * - Everything passes through the scrubber (src/instrumentation-client.ts: beforeSend).
 */
import * as Sentry from '@sentry/nextjs';
import { toError } from './to-error';

export interface ClientReportContext {
  /** Short place name, e.g. 'builder.submit'. Becomes the `where` tag. */
  where?: string;
  /** Searchable ids and codes (orderId, error code). No personal data. */
  tags?: Record<string, string | number | boolean>;
  extra?: Record<string, string | number | boolean | null | undefined>;
  level?: 'warning' | 'error';
}

/** Reports `err` to Sentry from the browser. Never throws. */
export function reportClientError(err: unknown, context: ClientReportContext = {}): void {
  try {
    if (!Sentry.getClient()) return;
    Sentry.withScope((scope) => {
      if (context.where) scope.setTag('where', context.where);
      for (const [k, v] of Object.entries(context.tags ?? {})) scope.setTag(k, v);
      if (context.extra) scope.setExtras(context.extra);
      if (context.level) scope.setLevel(context.level);
      Sentry.captureException(toError(err), { mechanism: { handled: true, type: 'manual' } });
    });
  } catch {
    /* reporting must never break the caller */
  }
}
