/**
 * Sentry settings shared by the browser init (src/instrumentation-client.ts) and the server init
 * (src/sentry.server.config.ts). Pure: no Sentry import. See docs/ARCHITECTURE.md, "Error monitoring (Sentry)".
 */

/**
 * Same-origin path the browser sends events to, so ad-blockers do not drop them. The server answers
 * it (serveTunnelIntegration) and forwards only the event body to Sentry. Not matched by src/proxy.ts
 * (robots.ts does not list it: it is golden-pinned, and crawlers only GET, which gets 405).
 */
export const SENTRY_TUNNEL_PATH = '/monitoring';

/**
 * The SDK (11.x) has no `sendDefaultPii`; `dataCollection` replaces it and collects EVERYTHING by
 * default. Everything below is switched off: no user info (so no IP address), no cookies, no
 * headers, no request/response bodies, no query strings, no local variables of stack frames
 * (the order route holds name, phone and address in locals), no database or queue payloads.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

/** The DSN, or undefined when monitoring is off (everything is then a no-op). */
export function sentryDsn(): string | undefined {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  return dsn ? dsn : undefined;
}
