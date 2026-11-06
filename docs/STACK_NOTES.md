# Stack notes (pinned 2026-11-07)

| Package | Version | Notes |
|---|---|---|
| next | 16.4.5 | App Router. `proxy.ts` replaces `middleware.ts`. `params`, `searchParams`, `cookies()`, `headers()` are **async**. Bundled docs: `node_modules/next/dist/docs/`. |
| react / react-dom | 19.3 | |
| tailwindcss | 4.x | No `tailwind.config.js`; tokens live in `@theme` in `src/app/globals.css`. Logical utilities: `ms- me- ps- pe- start- end-`. |
| shadcn | 4.23 (style `base-nova`, `rtl: true`) | Components are **Base UI** based (`@base-ui/react`), not Radix. Props differ from older shadcn: read the file in `src/components/ui/` before using. `DirectionProvider` wraps the app in `layout.tsx`. `cn` comes from the `cn` package. |
| pdf-lib | 1.17.1 | Server only. No clip API → use `pushOperators` with raw `q … W n … Q`. `embedPage(page, { boundingBox })` for CropBox. Encrypted PDFs throw unless `ignoreEncryption` (do NOT set it; report `encrypted`). |
| sharp | 0.35.5 | Server only. `.rotate()` with no args = EXIF auto-orient. `.trim({ threshold })` trims transparent borders. `.toColorspace('srgb')` for CMYK. Allowed to build via `pnpm-workspace.yaml` `allowBuilds`. |
| pdfjs-dist | 5.4.149 | **Client only**, dynamic import of `pdfjs-dist/legacy/build/pdf.mjs`. Worker: copy `node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs` to `public/pdf.worker.min.mjs` (a `postinstall`/`scripts/copy-pdf-worker.mjs` step) and set `GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'`. Pass `isEvalSupported: false` to `getDocument`. Never import at module top level (breaks SSR). `canvas` is aliased to an empty module in `next.config.ts`. |
| zod | 4.x | `z.object(...).safeParse`. Note v4 API (`z.string().min()`, `.email()` → `z.email()`). |
| jose | 6.x | Admin session: HS256 JWT in an HttpOnly, SameSite=Lax cookie, 7-day expiry. |
| vitest | 5.x | `pnpm test`. Alias `@` → `src`, `server-only` → empty module. |
| @playwright/test | 1.65 | `pnpm e2e` (Phase 3). |

## Decisions
- **Cache Components OFF.** Pages that read settings/orders are dynamic (`export const dynamic = 'force-dynamic'` where Next would otherwise prerender). This avoids Suspense/`'use cache'` requirements for a small dynamic site.
- **Storage = local files** under `./data/` (gitignored). The `StorageAdapter` interface in `types.ts` is the seam for a future Vercel Blob adapter (serverless has no persistent disk).
- **Rate limiting** is in-memory (fine for one local/VPS process). Replace with a hosted limiter before deploying to serverless.
- **No deploy** for now (owner's decision). When deploying later: GitHub repo + Vercel project under the owner's accounts, Vercel Pro (commercial use), `STORAGE=blob`, `ORDER_TRANSPORT=telegram`, Turnstile keys.

## Known traps
- Phone JPGs: EXIF orientation. Browser `createImageBitmap(file, { imageOrientation: 'from-image' })`; server `sharp().rotate()`. The aspect ratio must come from the oriented image.
- PDF boxes: pdfjs uses CropBox + /Rotate for the viewport; pdf-lib `embedPage` uses MediaBox unless you pass `boundingBox`. Use TrimBox ?? CropBox ?? MediaBox on both sides.
- pdf-lib `drawImage` with `rotate` rotates about the image's lower-left corner — offset x/y by the rotated dimensions.
- Embed the artwork once, draw N times. Embedding per cell multiplies file size by N.
- `<input type="number">` misbehaves with Arabic keyboards. Use `type="text" inputMode="decimal" dir="ltr"` and `parseCm()`.
- Vercel function bodies are limited to 4.5 MB; our upload route is multipart on a local Node server, so fine for now, but keep the JSON order route file-free.
