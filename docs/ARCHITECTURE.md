# Architecture

How the code is organised today, and what must not change by accident. For framework gotchas (Next 16, Tailwind v4, pdfjs, sharp) see `docs/STACK_NOTES.md`. `docs/PLAN.md` is the original plan and is historical.

The site is live. The owner is not a developer, so a change that alters stored data, the printed PDF or visible Arabic text has no reviewer but the tests: read "Hard invariants" at the end before any refactor.

## 1. Route map

Pages (`src/app`):

| URL | File | Notes |
|---|---|---|
| `/` | `page.tsx` | Hero and the order builder (`src/components/builder/Builder.tsx`, a client component). |
| `/how-it-works` | `how-it-works/page.tsx` | Sheet spec, gap rules, example counts and prices, all computed from the live settings with the real layout engine. |
| `/order/success` | `order/success/page.tsx` | Client page. Reads the last order answer from `sessionStorage`; without one it goes back to `/`. |
| 404 | `not-found.tsx` | |
| `/admin/login` | `admin/login/page.tsx` | Password form (`loginAction`). |
| `/admin` | `admin/page.tsx` | Orders list. |
| `/admin/orders/<orderId>` | `admin/orders/[orderId]/page.tsx` | Order detail, status form, file downloads. |
| `/admin/stats` | `admin/stats/page.tsx` | Statistics for the last 7, 30 or 90 days (`aggregate.ts` computes, `rows.ts` labels, `parts.tsx` draws). |
| `/admin/customers` | `admin/customers/page.tsx` | Customer list with search and filter; CSV download. |
| `/admin/settings` | `admin/settings/page.tsx` | Settings form (`SettingsForm.tsx`, `saveSettingsAction`). Also shows the full staff link when `STAFF_PAGE_KEY` is set. |
| `/staff/<key>` | `staff-sheets/page.tsx` | Hidden staff page (see "The staff page" below). `src/proxy.ts` rewrites only the right key to the real route `/staff-sheets`; any other `/staff` URL, and `/staff-sheets` asked for directly, is the normal 404, byte for byte the same answer as an unknown URL. |

Metadata routes: `manifest.ts`, `robots.ts` (disallows `/admin` and `/api`; it deliberately does not mention `/staff`, which would advertise it), `sitemap.ts`, `opengraph-image.tsx`, plus the committed icon files.

API (`src/app/api`):

| Method and URL | Purpose |
|---|---|
| `POST /api/upload/direct` | Step 1 of an upload. Returns a one-time signed PUT URL, or `mode: 'server'` when the storage is the local disk. |
| `POST /api/upload/direct/commit` | Step 2. The server reads the stored bytes back, checks size and magic bytes, then writes the meta file. |
| `POST /api/upload` | Multipart upload for local storage. Same checks. |
| `POST /api/orders` | Creates the order (section 2). |
| `POST /api/track` | Analytics beacon (section 5). |
| `POST /api/log` | Client error log to `console.warn`. Answers 204 even when it ignores the body (413 only for a body over 8 KiB). |
| `GET /api/cron/purge` | Daily retention purge. Needs `Authorization: Bearer $CRON_SECRET`. `?dry=1` only reports. |
| `GET /api/admin/files/<orderId>/<pdf\|design>` | Admin download (a 302 to a 60-second signed link on Supabase). |
| `GET /api/admin/customers` | Customer list as CSV (UTF-8 with BOM). |

Server actions (`src/app/admin/actions.ts`): `loginAction`, `logoutAction`, `updateOrderStatus`, `saveSettingsAction`.

Admin protection has two layers and both stay:

1. `src/proxy.ts` (Next 16's replacement for `middleware.ts`) guards `/admin/*` and `/api/admin/*`, except `/admin/login`. No valid cookie: pages redirect to the login page, API routes answer 401 JSON. (The same file also gates the staff page, below; its matcher has `/staff/:path*` and `/staff-sheets` for that.)
2. Every admin page behind the login and the two guarded actions (`updateOrderStatus`, `saveSettingsAction`) call `await requireAdmin()` (`src/lib/auth/guard.ts`) as their first statement, and every admin route handler calls `adminApiGuard()` (`src/lib/auth/session.ts`). The login page and the admin layout call `verifySession()` directly.

The session is an HS256 JWT (`src/lib/auth/token.ts`) in the HttpOnly cookie `ep_admin`, valid 7 days.

**The staff page** (`/staff/<key>`, added 2026-11-12) is NOT behind the admin login: it is a secret link, no password (owner decision D3). There is no `/staff/[key]` route: a page's own `notFound()` would answer with an error shell whose embedded route data names the route and echoes the key, which an unknown URL never does. Instead `src/proxy.ts` checks the key with `matchesStaffKey()` from `src/lib/staff-gate.ts` (constant time over sha256 digests, case-sensitive; a `STAFF_PAGE_KEY` shorter than 24 characters counts as "not set") and:
- right key: rewrites to the real route `/staff-sheets` (`STAFF_PAGE_ROUTE`), passes the key in the request header `x-staff-key` (`STAFF_KEY_HEADER`, always overwritten by the proxy) and adds the response headers `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow`. They are set there, not in `next.config` `headers()`, because a config rule for `/staff/:path*` would also put them on the wrong-key 404 and make it differ from an unknown URL;
- any other `/staff` URL (wrong, missing or unset key, other letter case, extra segments): `NextResponse.next()`. No route matches it, so Next serves its normal 404 with the same bytes and headers as an unknown URL (checked against a production build). A proxy rewrite is not used here on purpose: Next copies every rewrite target into an `x-middleware-rewrite` response header;
- `/staff-sheets` asked for directly: rewritten to `/staff-sheets/not-found`, a path with no route, so it gets the same 404 page (it is the one URL whose answer also carries `x-middleware-rewrite`).

The page (`force-dynamic`) checks the key again with `isStaffKey()` from `src/lib/staff-key.ts` (`server-only`) on the request header and calls `notFound()` otherwise, as a second line of defence. It is `noindex, nofollow` and `no-referrer` in its metadata too, is absent from the sitemap and `robots.txt`, and is ignored by analytics (`src/lib/analytics/paths.ts` `isStaffPath`, in any letter case, used by `Tracker`, `/api/track` and `InstallPrompt`; the browser keeps the `/staff/<key>` URL, which is what `Tracker` sees), so the key never reaches the stats. The admin settings link is built by `src/app/admin/settings/staff-link.ts` from the first value of `x-forwarded-host` / `x-forwarded-proto`. The page changes no customer data and uploads nothing: the client component (`src/components/staff/StaffSheets.tsx`, with `StaffCard`, `useStaffItems` and the pure `staff-logic.ts`) decodes each design in the browser (`decodeDesign`), arranges it with the website's own layout engine (`layoutParamsFor`, so the same margin, gaps, rotation and dots), prepares the artwork (`prepareArtwork` in `src/lib/design/prepare.client.ts`: EXIF upright, alpha trim, 300 DPI downscale, or the original PDF with the server's box and turn from `src/lib/design/pdf-box.ts`) and builds one PDF with one A4 page per design (`buildStaffPdf`, dynamically imported). Limits: 30 files, 50 MB each. Copy is in `src/content/ar/staff.ts`. The owner changes the link only through the Vercel variable (then redeploys).

## 2. Order pipeline

In the browser (`src/components/builder`): `useBuilder.ts` holds the step state, `src/lib/design/decode.client.ts` decodes the file for the preview, and `useSubmitOrder.ts` runs `submitFlow.ts` (the upload and order sequence, free of React) through `orderApi.ts` (the HTTP calls). The quantity step takes a STICKER count: `useBuilder` keeps what was typed (`null` = never typed, the box then shows the minimum for the current layout and follows it when the size changes), and derives sheets, the error (`validateStickers`) and the price (`priceForStickers`). The − / + buttons, quick picks and the discount chips/nudge are in stickers (`logic.ts`: `stepStickers`, `quickPickStickers`, `nextTierNudgeStickers`); the settings stay in sheets. The saved form (`ub:form:v1`) stores `stickersText`; an old `sheetsText` is ignored.

1. **Start the upload.** `POST /api/upload/direct` with the file size and name. On Supabase the answer carries an upload id and a signed URL. On local storage it is `mode: 'server'` and the browser falls back to the multipart `POST /api/upload`.
2. **Send the file.** The browser PUTs it straight to the bucket (`uploads/<id>.bin`). Vercel caps request bodies at 4.5 MB, so the file never passes through a function.
3. **Commit.** `POST /api/upload/direct/commit`. The server reads the real bytes back, rejects empty, oversize or unknown files (and deletes them), then writes `uploads/<id>.json`. `readUpload()` needs both files, so an unchecked file can never reach an order.
4. **Order.** `POST /api/orders` with `{ orderId, uploadId, spec, material, stickers, customer }` (`stickers` is the count the customer typed; pages cached before 2026-11-11 send `sheets` instead, and that path still works: see "Pricing" below). `orderId` is made by the browser and is the idempotency key: a repeat returns the stored result. The route, in this order:
   1. rate limit, before the body is read; body capped at 64 KiB; zod validation (`src/lib/order-schema.ts`); then `getSettings()`, then idempotency: an order already stored under this `orderId` is answered as is, and a request still running for it is awaited (none of the checks below run again);
   2. Turnstile check, only when `TURNSTILE_SECRET_KEY` is set (it must not be, see section 4);
   3. phone normalisation, quantity validation, `readUpload`. With `stickers` the quantity is checked by `validateStickers` against a layout the route computes right there (pure, the same call as step 4); when that layout fails only the material is checked, so the layout error still comes at step 4. With `sheets` only, `validateQuantity` as before;
   4. **layout**: `computeLayout(spec, layoutParamsFor(spec, settings.layout))` (`src/lib/layout`);
   5. **normalise**: `normaliseArtwork` (`src/lib/design/normalise.server.ts`, sharp and pdf-lib; includes the DPI gate);
   6. **PDF**: `buildSheetPdf` (`src/lib/pdf/build-sheet.ts`);
   7. price: `priceForStickers` (or `priceFor` for a sheets-only request) on the server. The browser never sends a price, and a request with `stickers` never uses the client's `sheets`;
   8. **save**: `savePdf`, then `saveOrder` with the record built by `src/lib/order-record.ts`;
   9. **customer upsert**: `upsertCustomerFromOrder` (best effort, a failure is logged);
   10. **analytics**: an `order` event (best effort);
   11. **notify**: `notifyShop` (`src/lib/notify`): Telegram `sendDocument` with the PDF, or a console log. It never throws. The result is stored on the order as `notified`.
5. **Answer.** `{ ok: true, orderId, displayNo, summary, whatsappUrl, notified }`. The browser stores it in `sessionStorage` and opens `/order/success`.

Failures are `{ ok: false, error, message }` with the status from the table in the route. Two are handled specially by the browser: `needs_raster` (it renders the PDF page to a PNG, uploads that and retries once) and `server_error` or a network failure (it shows the "degraded" screen with a ready WhatsApp message built by `degraded.ts`).

**Cutter dots (sheet marks).** The camera cutter reads only the printed paper and finds the sheet by 4 black dots (owner decisions, 2026-11-12). Every sheet PDF carries them: customer orders and the staff page. The geometry is fixed in code (`REG_MARKS` in `src/lib/layout/marks.ts`), not a setting: dot diameter 5 mm, centre 7 mm from both nearest edges (TL (7,7), TR (203,7), BL (7,290), BR (203,290) mm), no printed part of a sticker within 3 mm of a dot's edge (keep-out radius 5.5 mm around each centre). `layoutParamsFor()` always passes `marks`, so the website builder, `POST /api/orders`, `/how-it-works` and the staff page share one rule. `computeLayout` without `params.marks` behaves exactly as before (`layout-cases.json` is never edited; mark cases live in their own fixtures). With `marks` the engine searches three candidate areas (the usable area, then the area with the left and right edges, or the top and bottom, moved in to clear the dots), removes placements near a dot, and keeps the arrangement with the most stickers after removal (`LayoutResult.marks`, `removedNearMarks`; `countPerSheet` and `turnedCount` are counted after removal). For circle clips the printed shape is the inscribed circle; for every other shape the whole cell. The default margin is 3 mm (`DEFAULT_SETTINGS.layout.marginUm = 3000`). In the PDF the dots are one path (4 circles, `f*`) in DeviceCMYK `0 0 0 1`, inside the optional-content layer `sk_marks`, copied from the shop's hand-made `example.pdf`; rounded rectangles are clipped to their rounded corners (the camera cuts what is printed); the document asks viewers not to scale when printing (`/ViewerPreferences /PrintScaling /None`). `drawCount` still counts artwork draws only. The preview (`SheetPreview`, `SheetIllustration`) draws the dots in black and shows `common.marksHint`.

**Pricing** (`src/lib/pricing.ts`, pure, shared by the builder and the route; owner rules of 2026-11-10 and 2026-11-11):

- The customer types a sticker count. `sheets = ceil(stickers / countPerSheet)` (`sheetsForStickers`); the customer receives the whole last sheet (`totalStickers = sheets × countPerSheet`). Allowed range: `minStickers` = `pricing.minSheets × countPerSheet` to `maxStickers` = `pricing.maxSheets × countPerSheet`, whole numbers only (`validateStickers`). A count per sheet ≤ 0 never divides: it gives 0 sheets and `below_min`.
- Per-sheet price, volume tiers and quick picks stay in SHEETS in the settings; the tier is chosen on the rounded-up sheet count.
- `raw = unitPrice × sheets + delivery`; `totalIqd = max(delivery, raw rounded to the nearest PRICE_ROUND_IQD = 1,000, halves up)`; `subtotalIqd = totalIqd − delivery`; `roundingIqd = totalIqd − raw` (may be negative). `perStickerIqd = round(totalIqd / totalStickers)`. Unpublished prices: every money field null. The step is a constant in `pricing.ts`, not a setting.
- The typed count is stored as `price.requestedStickers` and returned as `summary.requestedStickers`; the Telegram caption, the WhatsApp text and the admin order page show it as «العدد المطلوب». Orders saved before 2026-11-11 have neither `requestedStickers` nor `roundingIqd` and their totals are not rounded; every screen handles that.

The order of steps 8 to 11 is deliberate: the PDF is saved before the order, the order before the notification, and the three side effects run one after another.

## 3. Storage

Everything stored goes through the `StorageAdapter` interface in `src/lib/types.ts`. `getStorage()` (`src/lib/storage/index.ts`) returns one adapter per process:

- `STORAGE=supabase` (production): `src/lib/storage/supabase.ts`. Plain `fetch` with the secret key, a timeout on every call, and an outage throws.
- anything else (development, unit tests, e2e): `src/lib/storage/local.ts`, files under `DATA_DIR` (default `./data`).

| Data | Shape (`types.ts`) | Local (under `DATA_DIR`) | Supabase |
|---|---|---|---|
| Uploaded design | bytes | `uploads/<id>.bin` | bucket `etihad`, same key |
| Upload meta | `StoredFileMeta` | `uploads/<id>.json` | bucket, same key |
| Sheet PDF | bytes | `orders/<id>.pdf` | bucket, same key |
| Order | `OrderRecord` | `orders/<id>.json` | table `orders` (`record` jsonb) |
| Settings | `ShopSettings` | `settings.json` | table `settings` (row `id = 1`, `data` jsonb) |
| Analytics events | `AnalyticsEvent` | `analytics/events-YYYY-MM.jsonl` | table `events` |
| Customers | `CustomerRecord` | `customers.json` | table `customers` (RPC `upsert_customer`) |

Path builders live in `src/lib/storage/paths.ts`; both adapters validate a path before using it. The schema is in `supabase/migrations/`. Row level security is on with no policies, so only the secret key can read or write.

Settings are stored as the owner saved them. On read they are deep-merged over `DEFAULT_SETTINGS` and validated (`parseStoredSettings` in `settings-schema.ts`), so a newly added key gets its default without a data migration. Pages read them through `getSettings()` in `src/lib/settings.ts`, which shares one read per server render (React `cache()`). Code that writes settings reads through `getStorage().getSettings()` instead.

**Why `local.ts` is written the way it is.** `scripts/purge-orders.ts` runs it directly under `tsx`, outside Next. So `local.ts`, and every file it loads at runtime (`paths.ts`, `settings-schema.ts`, `settings-limits.ts`, `src/config/defaults.ts`), must not import `server-only` and must use relative imports, not `@/`. `import type` from `@/...` is fine because it is erased. Keep the `/*turbopackIgnore: true*/` comments.

## 4. Environment variables

| Variable | Read in | How |
|---|---|---|
| `ADMIN_PASSWORD` | `auth/session.ts` (login) | `getAdminEnv()` |
| `SESSION_SECRET` | `auth/session.ts` (sign and verify), `src/proxy.ts` (verify), `analytics/server.ts` (salt of the visitor hash) | `getAdminEnv()` to sign; `process.env` directly elsewhere |
| `STORAGE`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DATA_DIR` | `storage/index.ts`; `DATA_DIR` also in `scripts/purge-orders.ts` | `process.env` directly |
| `ORDER_TRANSPORT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | `notify/index.ts` | `getOrderEnv()` |
| `TURNSTILE_SECRET_KEY` | `api/orders/route.ts` | `getOrderEnv()` |
| `TRUST_PROXY` | `rate-limit.ts` | `process.env` directly |
| `STAFF_PAGE_KEY` | `src/proxy.ts` (through `staff-gate.ts`), `staff-key.ts` (the staff page and the admin settings page) | `process.env` directly; 24+ characters, otherwise the staff page is a 404 and the admin page shows no link |
| `CRON_SECRET` | `api/cron/purge/route.ts` | `process.env` directly |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | nowhere | listed in `.env.example` only |

`src/lib/env.ts` holds two zod schemas: `getOrderEnv()` for the public order path and `getAdminEnv()` for the admin secrets, so placing an order never depends on admin variables. Both parse on every call and throw when a variable is invalid.

The direct reads are deliberate:

- The storage adapter and the rate limiter are needed by every page and route. Choosing them must not fail because an unrelated variable is invalid.
- `auth/token.ts` must stay free of `server-only` and `next/*` imports because `proxy.ts` imports it, and for the proxy and `verifySession()` a missing secret has to mean "not logged in", not an exception.
- `staff-gate.ts` follows the same rule for the same reason (`proxy.ts` imports it): no `server-only`, no `next/*`. It uses `node:crypto`, which the Next 16 proxy has because it runs on the Node.js runtime. A missing or short `STAFF_PAGE_KEY` means "not configured" (every `/staff` URL is a 404), never an exception.
- `CRON_SECRET` belongs to one route, which answers 401 when it is missing or shorter than 16 characters.
- `getOrderEnv()` still validates `STORAGE` (`local` or `supabase`, no surrounding spaces), `DATA_DIR` and `TRUST_PROXY` (whole number 0-10). A value the adapter or the limiter tolerates (for example `TRUST_PROXY=11` or `STORAGE=blob`) still makes every new `POST /api/orders` answer `server_error`.

**Turnstile is half-wired.** The server verifies a token when `TURNSTILE_SECRET_KEY` is set, but no page renders a widget or sends a token. With the secret set every order fails with `captcha_failed`. Keep it unset until a client widget is built.

## 5. Analytics: privacy model and retention

First-party and cookieless. Events: `pageview` (sent by `src/components/shell/Tracker.tsx`), `step` (once per builder step per browser session), `install` (the install card), and the server-side `upload` and `order`. The browser part is `src/lib/analytics/client.ts`, the server part `src/lib/analytics/server.ts`.

- **Stored per event:** time, type, visitor hash, path, step, traffic source, device class, city, region and country (from Vercel's `x-vercel-ip-*` headers, absent locally) and a small `meta` object (for an order: material, sheets, the typed sticker count when there is one, total, governorate, shape, size).
- **Never stored:** IP address, user agent, the referrer URL (it is reduced to a source name such as `instagram`), cookies, names or phone numbers.
- **Visitor hash:** the first 16 hex characters of `sha256(shop day | IP | user agent | salt)`. It changes every day, so one visitor cannot be followed across days. The salt is `SESSION_SECRET`: changing that secret splits the same day's visitors in two.
- **Dropped:** bots, an empty user agent, every `/admin` and `/staff` path in any letter case (`isAdminPath`, `isStaffPath`), and anything beyond 300 events per hour from one visitor hash. `/api/track` answers 204 whether it stored the event or not (400 only for an invalid body).

Retention:

| Data | Kept for | Removed by |
|---|---|---|
| Orders, sheet PDFs, designs | `settings.retentionDays` (default 30) | `GET /api/cron/purge` daily on Vercel; `pnpm purge:orders` locally |
| Direct uploads never committed | 3 hours | the cron |
| Analytics events | 400 days | the cron (the local script does not remove them) |
| Customers | permanently (owner decision; the consent text says so) | never |

## 6. Module homes

Shared helpers that have exactly one home. Use them instead of writing the same thing again.

| Module | What lives there |
|---|---|
| `src/lib/shop-time.ts` | `SHOP_TIME_ZONE` formatting: `formatShopDateTime`, `shopDayKey`, `DAY_MS`. The zone itself is defined once, in `src/config/defaults.ts`. |
| `src/components/Money.tsx` | `<Money amount />`: the grouped number in `<Ltr>` plus the currency word. |
| `src/components/fill-ltr.tsx` | `fillLtr(template, values)`: like `fill()`, with each value wrapped in `<Ltr>`. |
| `src/lib/design/kind.ts` | `sniffKind` (magic bytes), `MIME_BY_KIND`, `EXT_BY_KIND`. |
| `src/lib/parse/digits.ts` | `normaliseDigits` (Arabic-Indic and Persian digits to 0-9). |
| `src/lib/analytics/client.ts` | `sendTrack` and the beacon payload type. |
| `src/lib/order-record.ts` | `buildOrderRecord`, `summaryOf`. Their key order is the key order of the stored JSON and of the API answer. |
| `src/lib/order-price-view.ts` | `orderPriceView`: price fields of a stored order, including orders saved before per-sheet pricing and before sticker counts (`requestedStickers: null`). |
| `src/lib/auth/guard.ts` | `requireAdmin()` for pages and actions. `adminApiGuard()` for route handlers is in `auth/session.ts`. |
| `src/app/api/_lib/upload.ts` | Status table, JSON answers and file-name clean-up of the three upload routes, and the size cap of the two direct-upload steps (the multipart route has its own). `_lib/body.ts` has the byte-capped body readers and `SMALL_JSON_MAX_BYTES`, the cap of the small JSON bodies (direct-upload start and commit, analytics beacon). |
| `src/lib/storage/settings-limits.ts` | Numeric limits shared by the settings schema and the settings form parser. |
| `src/lib/turnstile.ts` | `verifyTurnstile`. |
| `src/lib/layout/marks.ts` | The cutter-dot constants (`REG_MARKS`: centre 7 mm from both edges, 5 mm wide, 3 mm clearance), `markCentres`, `isNearMark`. Pure and isomorphic. |
| `src/lib/pdf/sheet-page.ts` | `drawSheetPage`: one A4 sheet page (stickers drawn from one embedded artwork, rounded-corner clip, the 4 dots in the `sk_marks` layer) and `setPrintAtActualSize`. Isomorphic (no `server-only`): the server (`build-sheet.ts`) and the browser (`build-staff-pdf.ts`) both call it. |
| `src/lib/pdf/build-staff-pdf.ts` | `buildStaffPdf`: the staff page's multi-page PDF. Isomorphic. |
| `src/lib/design/pdf-box.ts` | `pdfArtworkBox`: which box (Trim, Crop or Media) and turn a PDF design uses, shared by `normalise.server.ts` and `prepare.client.ts`. |
| `src/lib/staff-gate.ts` | `matchesStaffKey` (the constant-time key comparison), `STAFF_KEY_MIN_LENGTH`, `STAFF_PAGE_ROUTE`, `STAFF_KEY_HEADER`: what the proxy and the staff page share. No `server-only` (section 4). |
| `src/lib/staff-key.ts` | `isStaffKey`, `staffPagePath`: the secret-link check for server code, on top of `staff-gate.ts`. |
| `src/app/admin/settings/parse-form.ts`, `fields.ts` | Form data to `ShopSettings`, and the table of layout fields typed in millimetres. |
| `src/components/builder/submitFlow.ts`, `orderApi.ts` | The upload and order sequence, and its HTTP calls. |

Other rules of thumb: every dimension is an integer number of micrometres (`src/lib/units.ts`); every visible string comes from `src/content/ar`; app code imports `cn` from `@/lib/utils`; server modules under `src/lib` that touch `fs`, sharp, pdf-lib or secrets start with `import 'server-only'` (except `storage/local.ts`, see section 3, and `auth/token.ts` and `staff-gate.ts`, see section 4; `src/proxy.ts` and route handlers are server code by nature and carry no marker).

## 7. Tests

- **Pure library code**: a `*.test.ts` file next to the module (`src/lib/pricing.test.ts`, `src/lib/layout/layout.test.ts`).
- **Anything that needs fixtures, environment variables, a mocked `fetch` or a route handler**: `tests/unit/<area>/` (`server`, `builder`, `admin`, `analytics`, `design`, `pdf`, `pages`, `components`).
- **`tests/unit/golden/`**: the behaviour oracle. It pins what the code does today: every Arabic string, layout results, PDF content hashes, API status codes and bodies, stored JSON, exact Supabase requests. A failing golden test means behaviour changed. Fix the code. Update a snapshot only for a change the owner asked for, one file at a time (`pnpm exec vitest run <file> -u`), and read the snapshot diff line by line.
- **`tests/e2e/`**: Playwright against `next dev` on port 3199 with `./data-e2e`. Run the whole suite: the admin spec uses the order that the order-flow spec creates. `staff.spec.ts` opens the hidden staff page with the test key from `playwright.config.ts`, adds two designs, downloads the PDF and checks 2 pages with the `sk_marks` dots and the privacy headers; a wrong key is a 404 identical to `/nonexistent-page` (`next dev` echoes each 404's own URL in the flight data, so the test removes that echo before comparing). `data-e2e/settings.json` is gitignored and local only: if an older copy has `layout.marginUm` at 7000, `admin.spec.ts` fails on the margin round-trip; delete the file so the defaults (3 mm) apply.

React `cache()` only memoises inside a server render, so under vitest `getSettings()` reads storage on every call and no unit test can see the memoisation; the rule "writers read through `getStorage().getSettings()`" is kept by review, not by a test.

`pnpm check` runs typecheck, unit tests, lint and the RTL lint. In CI or before a release run the tests with `CI=1`, so a missing snapshot fails instead of being written.

## 8. How to

**Add or change a visible string**

1. Edit the right file in `src/content/ar/` (`common`, `builder`, `order`, `pages`, `admin`). Placeholders are `{name}`.
2. Use it through `import { builder, fill } from '@/content/ar'`. Wrap numbers, units and ids in `<Ltr>`, or use `fillLtr` / `<Money>`. Never write Arabic or English text in a component.
3. `pnpm check`. The copy golden test fails on purpose. Update only that snapshot (`pnpm exec vitest run tests/unit/golden/copy.golden.test.ts -u`) and check that its diff shows your string and nothing else. A string that another golden file also prints (order text, Telegram caption, API error messages, page metadata) makes that snapshot fail too: update it the same way, one file at a time.

**Add a setting the owner can edit**

1. `src/lib/types.ts`: add the field to `ShopSettings` (or a nested type).
2. `src/config/defaults.ts`: add its value to `DEFAULT_SETTINGS`. Stored settings are merged over the defaults, so existing data keeps working.
3. `src/lib/storage/settings-schema.ts`: add it to `shopSettingsSchema`. A limit that the form also needs goes in `settings-limits.ts`.
4. `src/app/admin/settings/SettingsForm.tsx` (the input) and `parse-form.ts` (reading it). A layout distance typed in millimetres goes in `fields.ts` instead.
5. `src/content/ar/admin.ts`: the label, under `admin.settings`.
6. Tests: `tests/unit/admin/settings-form.test.ts`. The settings and copy golden snapshots change; update them deliberately.

**Add a Supabase migration**

1. Create a new file `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`. Never edit a file that has been applied: the database has already run it.
2. Turn row level security on for a new table and add no policies.
3. Mirror the behaviour in `src/lib/storage/local.ts`, and extend `StorageAdapter` in `types.ts` if a method is new, so development and tests behave like production.
4. Add tests for both adapters (`tests/unit/server/storage*.test.ts`, `supabase-storage.test.ts`).
5. Apply the migration to the Supabase project before deploying the code that needs it.

## 9. Hard invariants

Breaking one of these loses data, breaks a customer in the middle of an order, or changes what gets printed. Each needs an explicit decision by the owner.

1. **Applied migrations** in `supabase/migrations/` are never edited, including their old-brand header comments.
2. **Stored JSON shapes**: `OrderRecord`, `ShopSettings`, `CustomerRecord`, `AnalyticsEvent`, `StoredFileMeta`. Add fields as optional or with a default; never rename or remove one. Orders saved before per-sheet pricing have another `price` shape and must keep rendering (`order-price-view.ts`).
3. **Bucket and paths**: the bucket `etihad` and the keys `uploads/<id>.bin`, `uploads/<id>.json`, `orders/<id>.pdf`.
4. **PDF bytes and geometry**: the layout engine (`src/lib/layout`, fixtures in `src/lib/__fixtures__/layout-cases.json`) and `build-sheet.ts` and `sheet-page.ts` decide what is printed. Their output is pinned by fixtures and golden hashes; an "equivalent" rewrite that changes one byte or one micrometre is a behaviour change.
5. **Visible copy**: every string in `src/content/ar`, the order summary text and the Telegram caption.
6. **Old-brand identifiers that are data.** They look like leftovers of the previous shop name but they are stored in browsers, databases or URLs: the bucket `etihad`, the cookie `ep_admin`, the order number prefix `EP-`, the `sessionStorage` keys `ub:form:v1`, `ub:order-success:v1`, `softy-tracked`, `softy-step-<id>` and `softy-install-dismissed`, the `globalThis` keys `__epStorage` and `__epLimiters`, the package name `etihad`, and every environment variable name.
7. **API surface**: route paths, status codes, the JSON bodies and their key order.
8. **Security boundaries**: the session check stays the first statement of every admin page behind the login, of `updateOrderStatus` and `saveSettingsAction`, and of both `/api/admin` route handlers (see section 1); server modules keep `import 'server-only'`; the price is always recomputed on the server; no IP or user agent is added to a stored event.
9. **The visitor hash inputs** (section 5). `ipOf()` in `analytics/server.ts` and `clientIp()` in `rate-limit.ts` are separate on purpose: merging them changes stored hashes.
10. **The dots geometry** (`REG_MARKS`: 5 mm wide, centre 7 mm from both edges, 3 mm clearance, K black, layer `sk_marks`) matches the plotter's template. A dot at 6.8 mm or 4.8 mm wide may be rejected by the machine, and a sticker within 3 mm of a dot may make the camera misread the sheet. Change it only on the owner's word after a plotter test. The same goes for `PrintScaling /None`: a sheet shrunk by "fit to page" moves the dots off the template.
11. **The staff key never leaks**: `/staff` stays out of the sitemap, `robots.txt` and analytics, the staff page sends no design file to the server, and a wrong key gets exactly the answer of an unknown URL (so no route may match `/staff/<anything>`; the page stays behind the proxy rewrite).
