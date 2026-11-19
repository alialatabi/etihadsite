import * as Sentry from '@sentry/nextjs';

/** Starts server error monitoring. Only the Node.js runtime is used (see src/sentry.server.config.ts). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
}

/** Reports every uncaught server error (pages, route handlers, server actions, the proxy). */
export const onRequestError = Sentry.captureRequestError;
