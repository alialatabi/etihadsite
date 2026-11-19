import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

/**
 * - Cache Components are OFF for v1: pages read settings/orders at request time;
 *   see docs/STACK_NOTES.md. Dynamic pages opt in with `export const dynamic = 'force-dynamic'`.
 * - sharp and pdf-lib stay external to the server bundle.
 * - pdfjs-dist optionally requires `canvas`; alias it to an empty module.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "pdf-lib"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
    resolveAlias: {
      canvas: "./src/lib/empty-module.ts",
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

/**
 * Error monitoring (Sentry), see docs/ARCHITECTURE.md "Error monitoring (Sentry)". With no
 * SENTRY_AUTH_TOKEN the build uploads nothing and still passes. Errors only: tracing code is left
 * out of the bundle, and no build-time instrumentation touches the pinned PDF/layout code.
 * The browser tunnel is configured in src/instrumentation-client.ts (tunnel) and
 * src/sentry.server.config.ts (serveTunnelIntegration), not here (the `tunnelRoute` option is deprecated).
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  // Source maps are uploaded only when SENTRY_AUTH_TOKEN is set, then removed from the build output.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  buildTimeInstrumentation: false,
  bundleSizeOptimizations: { excludeTracing: true },
  suppressOnRouterTransitionStartWarning: true,
});
