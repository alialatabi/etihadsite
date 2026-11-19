import 'server-only';
/**
 * Manual error reporting for SERVER code (route handlers, server actions, libs): the places that
 * catch an error and carry on (log + friendly response). Uncaught errors are reported by
 * `onRequestError` in src/instrumentation.ts; this helper is for the ones that never get there.
 *
 * - Never throws, never awaits at the call site (one line: `reportError(e, { route: '/api/orders' })`).
 * - Accepts any thrown value (a string from `result.error` too).
 * - Context is ids, route names and error codes ONLY. Never customer name, phone, address or file contents.
 * - Everything passes through the scrubber (src/lib/monitoring/scrub.ts) before it leaves.
 * - No-op while NEXT_PUBLIC_SENTRY_DSN is unset.
 * - Serverless functions freeze after the response: the events are flushed in `after()` (as
 *   Sentry's own onRequestError does), or fire-and-forget outside a request.
 *
 * Browser code uses ./report.client.ts instead. Keep Sentry out of src/lib/storage/local.ts,
 * src/lib/auth/token.ts and src/lib/staff-gate.ts (they run under tsx / in the proxy).
 */
import * as Sentry from '@sentry/nextjs';
import { after } from 'next/server';

export interface ReportContext {
  /** Short place name, e.g. 'orders.notify'. Becomes the `where` tag. */
  where?: string;
  /** Route or action, e.g. '/api/orders'. */
  route?: string;
  /** Searchable ids and codes (orderId, uploadId, error code). Strings only; no personal data. */
  tags?: Record<string, string | number | boolean>;
  /** Extra ids/numbers. No personal data. */
  extra?: Record<string, string | number | boolean | null | undefined>;
  /** Default 'error'. Use 'warning' for a degraded-but-working situation. */
  level?: 'warning' | 'error';
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  try {
    return new Error(`Non-error thrown: ${JSON.stringify(err)}`.slice(0, 300));
  } catch {
    return new Error('Non-error thrown');
  }
}

/** Reports `err` to Sentry. Safe to call anywhere on the server; never throws. */
export function reportError(err: unknown, context: ReportContext = {}): void {
  try {
    if (!Sentry.getClient()) return; // monitoring is off
    Sentry.withScope((scope) => {
      if (context.where) scope.setTag('where', context.where);
      if (context.route) scope.setTag('route', context.route);
      for (const [k, v] of Object.entries(context.tags ?? {})) scope.setTag(k, v);
      if (context.extra) scope.setExtras(context.extra);
      if (context.level) scope.setLevel(context.level);
      Sentry.captureException(toError(err), { mechanism: { handled: true, type: 'manual' } });
    });
    const flush = () => Sentry.flush(2000).then(() => undefined, () => undefined);
    try {
      after(flush);
    } catch {
      void flush(); // not inside a request (script, test)
    }
  } catch {
    /* reporting must never break the caller */
  }
}
