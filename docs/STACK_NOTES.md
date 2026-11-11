# Stack notes (pinned 2026-11-07)

| Package | Version | Notes |
|---|---|---|
| next | 16.4.5 | App Router. `proxy.ts` replaces `middleware.ts`. `params`, `searchParams`, `cookies()`, `headers()` are **async**. Bundled docs: `node_modules/next/dist/docs/`. |
| react / react-dom | 19.3 | |
| tailwindcss | 4.x | No `tailwind.config.js`; tokens live in `@theme` in `src/app/globals.css`. Logical utilities: `ms- me- ps- pe- start- end-`. |
| shadcn | 4.23 (style `base-nova`, `rtl: true`) | Components are **Base UI** based (`@base-ui/react`), not Radix. Props differ from older shadcn: read the file in `src/components/ui/` before using. `DirectionProvider` wraps the app in `layout.tsx`. `cn` comes from the `cn` package: the generated `src/components/ui/*` files import it directly, app code imports it from `@/lib/utils` (a one-line re-export). |
| pdf-lib | 1.17.1 | Server: builds the sheet PDF and reads uploaded PDFs. Browser: loaded only by a dynamic import in `decode.client.ts` to read the TrimBox. No clip API → use `pushOperators` with raw `q … W n … Q`. `embedPage(page, { boundingBox })` for CropBox. Encrypted PDFs throw unless `ignoreEncryption` (do NOT set it; report `encrypted`). |
| sharp | 0.35.5 | Server only. `.rotate()` with no args = EXIF auto-orient. `.trim({ threshold })` trims transparent borders. `.toColorspace('srgb')` for CMYK. Allowed to build via `pnpm-workspace.yaml` `allowBuilds`. |
| pdfjs-dist | 5.4.149 | **Client only**, dynamic import of `pdfjs-dist/legacy/build/pdf.mjs`. Worker: copy `node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs` to `public/pdf.worker.min.mjs` (a `postinstall`/`scripts/copy-pdf-worker.mjs` step) and set `GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'`. Pass `isEvalSupported: false` to `getDocument`. Never import at module top level (breaks SSR). `canvas` is aliased to an empty module in `next.config.ts`. |
| zod | 4.x | `z.object(...).safeParse`. Note v4 API (`z.string().min()`, `.email()` → `z.email()`). |
| jose | 6.x | Admin session: HS256 JWT in an HttpOnly, SameSite=Lax cookie, 7-day expiry. |
| vitest | 5.x | `pnpm test`. Config: `vitest.config.mts`. Alias `@` → `src`, `server-only` → empty module (`src/lib/empty-module.ts`). |
| @playwright/test | 1.65 | `pnpm e2e`: starts `next dev` on port 3199 with `./data-e2e` (see `playwright.config.ts`). |

## Decisions
- **Cache Components OFF.** Pages that read settings/orders are dynamic (`export const dynamic = 'force-dynamic'` where Next would otherwise prerender). This avoids Suspense/`'use cache'` requirements for a small dynamic site. Settings are read once per server render through React `cache()` (`src/lib/settings.ts`); nothing is cached between requests.
- **Hosting = Vercel + Supabase.** The site is deployed on Vercel (`vercel.json`: region `bom1`, one daily cron) with `STORAGE=supabase`: Postgres tables plus a private bucket, called with plain `fetch` and the secret key (no SDK), see `src/lib/storage/supabase.ts`. `STORAGE=local` (files under `DATA_DIR`, default `./data`) is for development, unit tests and e2e. The `StorageAdapter` interface in `types.ts` is the seam between the two; `docs/ARCHITECTURE.md` has the path table.
- **Uploads on Vercel are direct.** Vercel caps request and response bodies at 4.5 MB, so the browser asks `POST /api/upload/direct` for a one-time signed URL, PUTs the file straight to the bucket, then calls `POST /api/upload/direct/commit`, where the server reads the stored bytes back and checks size and magic bytes. With local storage the first call answers `mode: 'server'` and the browser uses the multipart `POST /api/upload`. Admin downloads redirect to 60-second signed links for the same reason.
- **Rate limiting is in-memory and per instance.** On Vercel every serverless instance keeps its own counters, so the limits in `src/lib/rate-limit.ts` are a per-instance guard, not a site-wide quota. Site-wide limiting of `/api/upload/direct` and `/api/orders` is the job of a Vercel Firewall rate-limit rule (a project setting, not in this repo).
- **pdf-lib runs on both sides.** The server uses it to read uploaded PDFs and to build the sheet. The browser imports it lazily (never at module top level) only to read a PDF's TrimBox, so the preview size equals the server's `TrimBox ?? CropBox ?? MediaBox`.
- **Turnstile is half-wired.** `POST /api/orders` verifies a token when `TURNSTILE_SECRET_KEY` is set, but no page renders a widget or sends one. Keep the secret unset until a client widget exists.

## Known traps
- Phone JPGs: EXIF orientation. Browser `createImageBitmap(file, { imageOrientation: 'from-image' })`; server `sharp().rotate()`. The aspect ratio must come from the oriented image.
- PDF boxes: pdfjs uses CropBox + /Rotate for the viewport; pdf-lib `embedPage` uses MediaBox unless you pass `boundingBox`. Use TrimBox ?? CropBox ?? MediaBox on both sides.
- pdf-lib `drawImage` with `rotate` rotates about the image's lower-left corner — offset x/y by the rotated dimensions.
- Embed the artwork once, draw N times. Embedding per cell multiplies file size by N.
- `<input type="number">` misbehaves with Arabic keyboards. Use `type="text" inputMode="decimal" dir="ltr"` and `parseCm()`.
- Vercel function request and response bodies are limited to 4.5 MB. Files therefore never pass through a function on Vercel (direct upload, signed download links; see Decisions); the multipart `POST /api/upload` serves `STORAGE=local` only. Keep the JSON order route file-free.
- `pnpm purge` is a pnpm built-in (an alias of `pnpm clean`, which removes `node_modules`). The retention script is therefore named `purge:orders`.

## Rate limiting / TRUST_PROXY
- `x-forwarded-for` is client-controlled, so by default (`TRUST_PROXY=0`) it is **ignored**: every route uses one global bucket with limits x20 (uploads 400/h, orders 100/h, log 1200/h, admin login 200/15 min).
- Per-IP limiting (uploads 20/h, orders 5/h, log 60/h, login 10/15 min) needs a reverse proxy that appends to `x-forwarded-for` (nginx/Caddy, or Vercel) and `TRUST_PROXY=<hops>`; the n-th value from the END of the header is used (`1` = a single proxy in front; production on Vercel runs with `TRUST_PROXY=1`).
- `/api/track` is limited to 300 events per hour per visitor hash in both modes.
- Request bodies are capped before parsing: upload `maxUploadBytes + 64 KiB` with a mandatory `Content-Length` (and a byte-capped stream read), orders 64 KiB, log 8 KiB, direct-upload start/commit and track 4 KiB.
- Public order/upload/log paths read `getOrderEnv()` only; `ADMIN_PASSWORD`/`SESSION_SECRET` (`getAdminEnv()`) are needed for /admin alone. Placeholder values (`change-me...`) are rejected.
