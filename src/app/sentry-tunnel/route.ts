/**
 * Second endpoint of the Sentry tunnel (see src/lib/monitoring/config.ts). The browser posts to
 * /monitoring (src/app/monitoring/route.ts); on Vercel, withSentryConfig also rewrites such envelope
 * requests here. Like /monitoring, this route file answers everywhere: the server SDK does not answer
 * the tunnel path itself (`intercept: false` in src/sentry.server.config.ts). Forwards only the event
 * body (no cookies or headers) and only for this site's own DSN. Not matched by src/proxy.ts.
 *
 * Wrapped with a deadline (src/lib/monitoring/tunnel.ts) because the SDK handler waits on the incoming
 * body without one: body read within 5 s (else 408), whole request capped at 10 s (else 504),
 * maxDuration 15 as a backstop.
 */
export { POST } from '@/lib/monitoring/tunnel';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;
