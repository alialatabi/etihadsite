/**
 * Browser error monitoring (Sentry). Runs before the app becomes interactive. Errors only: no
 * tracing, no session replay, no profiling, no logs. A no-op while NEXT_PUBLIC_SENTRY_DSN is unset.
 * Everything sent passes through the scrubber (src/lib/monitoring/scrub.ts).
 * The tracing hook `onRouterTransitionStart` is deliberately not exported.
 */
import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION, SENTRY_TUNNEL_PATH, sentryDsn } from '@/lib/monitoring/config';
import { makeScrubbers } from '@/lib/monitoring/scrub';

const dsn = sentryDsn();

if (dsn) {
  const { scrubEvent, scrubBreadcrumb } = makeScrubbers();
  Sentry.init({
    dsn,
    dataCollection: SENTRY_DATA_COLLECTION,
    // `tracesSampleRate` stays unset on purpose: 0 would still create (unsampled) spans.
    // The tracing and session (release health) integrations are removed; errors are all we send.
    integrations: (defaults) => defaults.filter((i) => i.name !== 'BrowserTracing' && i.name !== 'BrowserSession'),
    tunnel: { path: SENTRY_TUNNEL_PATH },
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
}
