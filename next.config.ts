import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { withSentryConfig } from "@sentry/nextjs/config";

/**
 * - Cache Components are OFF for v1: pages read settings/orders at request time;
 *   see docs/STACK_NOTES.md. Dynamic pages opt in with `export const dynamic = 'force-dynamic'`.
 * - sharp and pdf-lib stay external to the server bundle.
 * - pdfjs-dist optionally requires `canvas`; alias it to an empty module.
 * - Bot check (Vercel BotID): `withBotId` adds two rewrites and one header rule, all under its own
 *   fixed random path prefix (botid/next/config), never under /staff. See docs/ARCHITECTURE.md section 4.
 * - Security headers: one site-wide rule (see `securityHeaders`), and no `X-Powered-By`.
 */
export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // frame-ancestors only: no script-src or other directive (Next inline scripts, Sentry and the PDF worker would break).
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    // One rule for every path, so /staff/<wrong key> and an unknown URL get identical headers
    // (invariant 11). Referrer-Policy is not set here: src/proxy.ts sets no-referrer on the staff page.
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
export default withSentryConfig(withBotId(nextConfig), {
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
