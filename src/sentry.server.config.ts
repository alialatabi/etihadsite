/**
 * Server error monitoring (Sentry), loaded by register() in src/instrumentation.ts for the Node.js
 * runtime. The Next 16 proxy (src/proxy.ts) also runs on Node.js, and no route uses the edge runtime,
 * so there is no edge config. Errors only: no tracing, profiling or logs. A no-op while
 * NEXT_PUBLIC_SENTRY_DSN is unset. Everything sent passes through the scrubber, which also blanks the
 * literal secret values below if they ever show up in a message.
 */
import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION, SENTRY_TUNNEL_PATH, sentryDsn } from '@/lib/monitoring/config';
import { makeScrubbers } from '@/lib/monitoring/scrub';

const dsn = sentryDsn();

if (dsn) {
  const { scrubEvent, scrubBreadcrumb } = makeScrubbers({
    secrets: [
      process.env.STAFF_PAGE_KEY,
      process.env.SESSION_SECRET,
      process.env.ADMIN_PASSWORD,
      process.env.CRON_SECRET,
      process.env.SUPABASE_SECRET_KEY,
      process.env.TELEGRAM_BOT_TOKEN,
      process.env.TURNSTILE_SECRET_KEY,
      process.env.OPENAI_API_KEY,
      process.env.META_CAPI_TOKEN,
    ],
  });
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || undefined,
    dataCollection: SENTRY_DATA_COLLECTION,
    // `tracesSampleRate` stays unset on purpose: 0 would still create (unsampled) spans.
    // Errors only: the release-health session pings are switched off (ProcessSession, and the per-request
    // sessions of the Http integration, which @sentry/nextjs itself re-adds the same way with
    // disableIncomingRequestSpans). The tunnel allowlist (this DSN) is registered here, but `intercept: false`
    // keeps the SDK from answering /monitoring itself: it would read the request body with no deadline.
    // The route files (src/app/monitoring, src/app/sentry-tunnel) answer it through src/lib/monitoring/tunnel.ts.
    integrations: (defaults) => [
      ...defaults.filter((i) => i.name !== 'ProcessSession' && i.name !== 'Http'),
      Sentry.httpIntegration({ disableIncomingRequestSpans: true, sessions: false }),
      Sentry.serveTunnelIntegration({ path: SENTRY_TUNNEL_PATH, intercept: false }),
    ],
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
}
