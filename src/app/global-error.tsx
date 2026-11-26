'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { common } from '@/content/ar';
import { ctaCls } from '@/components/collage';
import './globals.css';

/**
 * Last-resort error page: shown when the root layout itself fails, and reports the error to Sentry
 * (a no-op while NEXT_PUBLIC_SENTRY_DSN is unset). It replaces the root layout, so it renders its
 * own <html>/<body>. All text comes from src/content/ar. Pass `retry`, not `reset` (Next 16.4).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error, { mechanism: { handled: true, type: 'auto.function.nextjs.global_error_boundary' } });
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground">
        <h1 className="scrap scrap-navy inline-block px-4 pt-1 pb-2.5 text-2xl font-bold">{common.errors.generic}</h1>
        <button type="button" onClick={() => retry()} className={ctaCls('md')}>
          {common.actions.retry}
        </button>
      </body>
    </html>
  );
}
