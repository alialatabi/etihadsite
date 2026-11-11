import type { NextConfig } from "next";

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

export default nextConfig;
