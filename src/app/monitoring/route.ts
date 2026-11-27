/**
 * The Sentry tunnel itself (see SENTRY_TUNNEL_PATH in src/lib/monitoring/config.ts): the browser posts
 * its error events to /monitoring so ad-blockers do not drop them. This route file answers it everywhere
 * (locally and on Vercel): the server SDK's serveTunnelIntegration runs with `intercept: false`
 * (src/sentry.server.config.ts), so it only registers the allowed DSN and never answers the path itself.
 * Forwards only the event body (no cookies or headers) and only for this site's own DSN; it refuses
 * everything while NEXT_PUBLIC_SENTRY_DSN is unset. Not matched by src/proxy.ts.
 *
 * The SDK handler waits on the incoming body without a deadline, so a browser that drops the connection
 * mid-send used to hold the request for 300 s. The handler is wrapped (src/lib/monitoring/tunnel.ts):
 * body read within 5 s (else 408), whole request capped at 10 s (else 504), maxDuration 15 as a backstop.
 */
export { POST } from '@/lib/monitoring/tunnel';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;
