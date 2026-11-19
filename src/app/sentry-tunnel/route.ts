/**
 * Fallback endpoint of the Sentry tunnel (see src/lib/monitoring/config.ts). The browser posts to
 * /monitoring; on Vercel, withSentryConfig rewrites such envelope requests here because Vercel would
 * otherwise answer an unknown path without running the app. Forwards only the event body (no cookies
 * or headers) and only for this site's own DSN. Not matched by src/proxy.ts.
 */
export { POST } from '@sentry/nextjs/tunnel';

export const dynamic = 'force-dynamic';
