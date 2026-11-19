/**
 * The Sentry tunnel itself (see SENTRY_TUNNEL_PATH in src/lib/monitoring/config.ts): the browser posts
 * its error events to /monitoring so ad-blockers do not drop them. Locally the Sentry SDK answers this
 * path before any route runs; on Vercel (which answers an unknown path without running the app) this
 * route file is what is reached. Forwards only the event body (no cookies or headers) and only for this
 * site's own DSN; it refuses everything while NEXT_PUBLIC_SENTRY_DSN is unset. Not matched by src/proxy.ts.
 */
export { POST } from '@sentry/nextjs/tunnel';

export const dynamic = 'force-dynamic';
