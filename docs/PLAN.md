# الاتحاد برنت — Rebuild Plan v3 (2026-11-07, approved decisions applied)

v1 was reviewed by four independent reviewer agents (print geometry, Arabic UX, architecture/security, completeness); v2 folded in their findings. **v3 applies the owner's answers (2026-11-07):**

| Question | Owner's answer | Effect |
|---|---|---|
| Q1 circle gaps | **B**: 2 mm between columns, rows touching | gapX = 2 mm, gapY = 0 mm; 3 cm circle → 54 per sheet |
| Q2 order channel | **Telegram + admin dashboard in the site** | Email dropped. Admin dashboard is a v1 feature (orders + settings) |
| Q3 cutting | Cutter plotter; **cut lines added manually by the shop** | PDF contains artwork only: no cut paths, no tick marks, no printed text. Order id goes in PDF metadata |
| Q4 size lock | Confirmed: proportions follow the design | as planned |
| Q5 offers | **Delivery 5,000 IQD on top of any order**; tiers as default | `deliveryFeeIqd` setting; shown as its own line in summary and notification |
| Q6 hosting | **Do not deploy to Vercel for now** | Local dev only. File-system storage adapter; Vercel Blob adapter left as a documented later step. Settings editable in the admin dashboard, not Vercel Global Config |

Items marked **[my call]** are decisions I made; override any of them.

## 1. What we are building

A polished, Arabic-only (RTL, Iraqi dialect) web app for an A4 sticker print shop. The customer:

1. Picks the sticker shape: **دائري** (circle) / **مستطيل** (rectangle: زوايا دائرية or زوايا حادة) / **شكل مخصص** (custom die-cut).
2. Uploads one design: **PNG, JPG, or PDF** (page 1 only, told clearly).
3. Enters the sticker size in **cm**. The second dimension follows the design's proportions automatically (circle: one diameter field).
4. Watches a live A4 preview with the per-sheet count.
5. Picks an **offer** (الباقة): bundles of A4 sheets starting at 20.
6. Enters name, phone, address and submits.
7. The shop receives the order with the arranged **print-ready A4 PDF**, generated on the server.

Brand, logo (`/brand/united-print-logo.jpg`) and the Iraqi-dialect tone of the current site are kept. Everything else is rebuilt.

## 2. Layout rules

Engine works in **integer micrometres** (no float drift). A4 = 210 × 297 mm. **Margin 7 mm** → usable 196 × 283 mm.

| Shape | Gap X (between columns) | Gap Y (between rows) | Image clipping | Notes |
|---|---|---|---|---|
| Circle | **2 mm** | **0 mm** (rows touch) | Clipped to circle in preview and PDF | Owner's choice (Q1 = B). Both gaps remain config values. |
| Rectangle, rounded | 2 mm | 2 mm | Not clipped; corner radius 3 mm shown in the on-screen preview only **[my call]** | Unclipped art acts as free bleed under the cut |
| Rectangle, sharp | 0 mm | 0 mm | None | Shared cut lines |
| Custom | 2 mm | 2 mm | Alpha defines the cut | **PNG with transparency only.** Auto-trimmed to the opaque bounding box before size/ratio. JPG/PDF rejected with an Arabic message offering to switch to rectangle |

Rules:
- cols = floor((usableW + gapX) / (w + gapX)), rows likewise; count = cols × rows. The block is centred in the usable area.
- Gaps are page-axis properties (never rotate with the sticker).
- **Auto-rotate is OFF by default** (config flag `allowRotate`). The engine supports it, the UI does not expose it in v1.
- Size entry: text input, `inputMode="decimal"`, LTR, unit «سم» outside the field. Accepts Arabic-Indic digits and `.` `,` `٫` decimals. Parsed once to µm. The dependent dimension stays unrounded internally and is rounded for display only.
- Range: min 1 cm; max = fits once inside the usable area (A4 minus the margin). Specific Arabic errors for "too big" and "ratio too extreme".
- PDF uploads prefill the size from the page's trim/crop box (in cm); user can override.
- Circle with a non-square image: centre-cropped, visibly, with hint «ارفع صورة مربعة للحصول على أفضل نتيجة».
- Print resolution: effective DPI = px / (mm / 25.4). Warning below 150 DPI, hard block below 72 DPI (not for vector PDFs). DPI stored in the order.

## 3. Design normalisation (one source of truth)

Every upload becomes a `DesignSource` before the layout engine sees it:
- **Client (preview):** raster decoded via `createImageBitmap(file, { imageOrientation: 'from-image' })` so EXIF rotation is baked in; PDF page 1 rendered with `pdfjs-dist` (legacy build, worker in `/public`, `isEvalSupported: false`, version ≥ 4.2.67 for CVE-2024-4367). HEIC and unknown types rejected in Arabic.
- **Server (print):** `sharp` auto-orients, alpha-trims (custom shape), converts CMYK JPEG to RGB, resamples to 300 DPI at the ordered physical size, PNG if alpha else JPEG q92. PDF page 1 embedded as vector with pdf-lib honouring CropBox/TrimBox and `/Rotate`; encrypted PDFs rejected; on embed failure the client is asked to resend its 300-DPI pdfjs raster.
- Both sides derive the aspect ratio from the same normalised box, so preview and print always agree. Fixtures: EXIF-6 JPG, PDF with CropBox ≠ MediaBox, PDF with /Rotate 90, padded transparent PNG.
- Uploaded files are stored only through the storage adapter; the server never fetches client-supplied URLs.

## 4. PDF output (what the shop receives)

- One A4 page (595.2756 × 841.8898 pt ± 0.01), artwork embedded **once** and drawn N times, clipped per the table above.
- **No cut guides** (Q3): the shop draws cut lines in the plotter software. Config flags `cutGuides.tickMarks` and `cutGuides.vectorPathsPage` exist but default OFF.
- Colour: RGB output; uploaded vector PDFs keep their own colour space. No colour management in v1 (stated in README).
- No text drawn inside the PDF at all. Order number, shape, size and count go into the PDF metadata (Title/Subject/Keywords).
- Filename: `EP-251107-AB3C_circle-30mm_x20.pdf` (order no., shape, size, sheets).
- Acceptance: nothing inside the 7 mm margin; content stream has exactly N image draws; every placement inside the usable area.
- README line for the shop: print at 100% / «الحجم الفعلي», never «Fit to page».

## 5. Order flow

1. Client generates `orderId` (nanoid) up front → idempotency key and storage path prefix.
2. Turnstile (invisible captcha) is **optional**: enforced only when keys are configured (not needed for local dev).
3. Client uploads the **original design only** via `POST /api/upload` (multipart, 10 MB, PNG/JPEG/PDF by magic bytes) to the storage adapter, with a progress bar.
4. `POST /api/orders` (JSON, `maxDuration = 60`): zod-validate spec + offer + customer; re-verify Turnstile; verify the stored upload exists and passes magic-byte checks; recompute price server-side from `offerId`; run layout engine; build PDF; store PDF + order JSON; notify; return order number. Repeat calls with the same `orderId` return the existing order.
5. **Notification (Q2):** **Telegram bot `sendDocument`** to the owner's chat with the PDF and an Arabic summary (phone as `tel:`/`wa.me` links, address, DPI, delivery fee, total). Adapter `ORDER_TRANSPORT=console|telegram`. The order is always saved to storage first, so the admin dashboard is the record of truth even if Telegram fails.
6. Success screen: order number, summary, **«أرسل عبر واتساب»** button (pre-filled text with order no., shape, size, sheets). If Telegram failed, the WhatsApp button is presented as required.
7. **Degraded path:** if upload or API fails, the customer gets «أرسله لنا على واتساب» with the summary text so the order still reaches the shop.
8. Form state (not files) persisted in sessionStorage against back-swipes.

Order record: `{ orderId, displayNo (EP-YYMMDD-XXXX), spec, layout summary, dpi, offerId, offerPrice, deliveryFee, total, customer, designPath, pdfPath, createdAt, status, notified: {telegram} }` saved through the **storage adapter** (`STORAGE=local` writes under `./data/`; a `blob` adapter is a later step for hosting). Success page shows **no PII** and fetches nothing (number passed in client state).

Customer fields: «الاسم» (optional), «رقم الموبايل» (`+964` prefix shown, normalises ٠-٩, 00964/964/0 prefixes; must be 10 digits starting with 7; stored `+9647XXXXXXXXX`; rendered as `tel:` and `wa.me` links for the shop), «المحافظة» (select, 19 governorates incl. حلبجة, بغداد first), «المنطقة / القضاء», «أقرب نقطة دالة» (required), «ملاحظات» (optional).

Consent line above submit: «بياناتك وملفك تُستخدم لتنفيذ طلبك فقط وتُحذف بعد 30 يوم. تتم الطباعة حسب الملف المرفوع.» `retentionDays = 30` with a Vercel Cron purge job.

**Admin dashboard `/admin`** (Q2), protected by a password from `ADMIN_PASSWORD` with a signed HttpOnly cookie session:
- **الطلبات**: table of orders (newest first) with status (جديد / قيد الطباعة / مكتمل / ملغي), customer phone as tap-to-call and WhatsApp links, download buttons for the arranged PDF and the original design, order detail view with the full summary.
- **الإعدادات**: offers (sheets + price per offer, badge, enabled), delivery fee (default 5,000 IQD), shop WhatsApp number and phone, hours, Telegram chat id, feature flags (prices published, circle gap values, allowRotate). Saved through the storage adapter; the public site reads them at request time.

Client errors (decode/preview/upload failures with step, file type/size, UA) posted to a tiny `/api/log` so they show in Vercel runtime logs.

## 6. Offers and prices (superseded, see note)

> **UPDATE 2026-11-10 (owner decision): the fixed offers/packages («الباقات») below are REPLACED by per-sheet pricing.** Customer picks the material and types any whole number of sheets in the same step (quantity step, with − / + and quick picks 10/20/50/100). Minimum 10 sheets. Paper «ورقي» 800 IQD/sheet, plastic «بلاستك» 1,500 IQD/sheet. Volume discount on the whole order: 10-19 = 0%, 20-49 = 10%, 50-99 = 15%, 100+ = 20%. Delivery flat 5,000 IQD to every governorate. All values (material prices/enabled, min/max, tiers, quick picks, delivery, pricesPublished) are editable in /admin/settings (`settings.pricing`). The server recomputes the price from `{material, sheets}` via `priceFor` in `src/lib/pricing.ts`; clients never send prices. Steps are now: الشكل → التصميم → القياس → العدد والخامة → بياناتك. The text below is kept as history.

`Offer = { id, sheets, priceIqd: number | null, badge?: string, enabled: boolean }`, default tiers 20 / 50 / 100 sheets **[my call]**. Cards show sheets, **total stickers** (sheets × per-sheet), offer price and ≈ price per sticker, formatted with `Intl.NumberFormat('ar-IQ-u-nu-latn')`. While `priceIqd` is null the card shows «السعر يُحدد عند التأكيد»; **no fake placeholder prices are ever shown publicly.**

**Delivery (Q5):** `deliveryFeeIqd = 5000` added to every order and shown as a separate line «التوصيل: 5,000 د.ع» in the offer step, the summary card, the success screen, the Telegram message and the admin order view. Total = offer price + delivery.

**Editing without a developer:** offers, prices, delivery fee, contacts and flags are edited in the **admin dashboard → الإعدادات** and stored through the storage adapter, with typed defaults and zod validation in `src/config/defaults.ts`. README gets an Arabic guide «شلون أغيّر السعر أو رقم الواتساب». Acceptance: the owner changes a price from a phone.

## 7. Pages and UI

- `/` builder. Steps: **الشكل → التصميم → القياس → الباقة → بياناتك**. Preview is labelled «المعاينة», not «العرض». Desktop: sticky side panel. **Mobile: sticky compact strip under the header** (A4 thumbnail + «48 ستيكر في الورقة» badge + size), tap to expand full-screen.
- Final step shows a read-only **order summary card** (shape, size, per sheet, sheets, total stickers, price) above the form; button «أرسل الطلب».
- Secondary link on step 1: «عندك ملف جاهز أو أكثر من تصميم؟ راسلنا على واتساب». Floating WhatsApp «استفسار» button.
- `/how-it-works` — «شلون نشتغل؟», numbers generated from the same constants/fixtures (e.g. 3 cm circle → 48).
- `/order/success`, `/admin` (login, orders, order detail, settings), 404. Footer everywhere: shop name, area, hours, WhatsApp, phone, files-usage line.
- Copy register: Iraqi colloquial for UI verbs and headlines (شلون، راح، حمّل), neutral for errors/legal. Arabic plurals via `count(n, forms)` using `Intl.PluralRules('ar')` (ستيكر / ستيكرين / ستيكرات، ورقة / ورقتين / أوراق).
- RTL discipline: ESLint rule banning physical utilities (`ml- pl- left-`) in favour of logical ones (`ms- me- ps- pe- start- end-`); `<Ltr>` helper wrapping numbers, units, filenames, phone numbers in `<bdi dir="ltr">`; "next" uses ArrowLeft; shadcn components RTL-fixed once in Phase 0 and frozen.
- Typography: **one family, IBM Plex Sans Arabic** (400/500/700), `tabular-nums` on prices and sizes. Western digits 0-9 **[my call]**.
- Visual: deep ink navy, warm paper off-white, one orange accent, big Arabic headings, dashed cut-line motifs, true-proportion A4 preview with the margin as a faint guide.

## 8. Tech stack (pinned exact versions in Phase 0)

Next.js 16 App Router + TypeScript, Tailwind v4 (`@theme` tokens), shadcn/ui, `pnpm`. `pdf-lib` (server) with `@cantoo/pdf-lib` fork as fallback if needed, `sharp` (server), `pdfjs-dist` legacy build (client preview only), `zod`, `nanoid`, Telegram Bot API via fetch, optional Cloudflare Turnstile, in-memory rate limit (5 orders/hour/IP; swap for a hosted limiter when deployed), `jose` for the admin session cookie, Vitest, Playwright. Storage: `StorageAdapter` interface with `local` (files under `./data/`, gitignored) implemented in v1; `blob` adapter documented as the hosting step. Config split: public defaults vs `import 'server-only'` server config; `.env.example` committed (`ADMIN_PASSWORD`, `SESSION_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `STORAGE`, `ORDER_TRANSPORT`); env validated with zod.

`docs/STACK_NOTES.md` written in Phase 0: Next 16 / Tailwind v4 breaking changes, Turbopack aliases for pdfjs, logical-utility rule, how to move storage to Vercel Blob and deploy later.

## 9. Multi-agent execution

Orchestrator (me, Fable) does Phase 0 and 2; **Sonnet agents** do Phases 1 and 3 in isolated git worktrees. Each agent brief lists the files it owns and the frozen files it must not touch. Hand-off gate per agent: `tsc --noEmit` + Vitest green (not `next build`, reserved for integration).

**Phase 0 — Orchestrator**
- Scaffold in a temp dir, move into `D:\etihadsite`, `git init`, first commit. Install **all** dependencies and shadcn components up front; commit lockfile.
- Shell: `app/layout.tsx` (fonts, `dir="rtl"`, metadata, Toaster), placeholder Header/Footer, `globals.css` tokens. Frozen after this phase.
- **Full contracts** in `src/lib/types.ts` with JSDoc: `StickerSpec`, `LayoutResult` (page, margin, cell, gaps, rotated, cols, rows, placements in µm, clip shape, countPerSheet), `DesignSource`, `Offer`, `OrderPayload`, `OrderRecord`, `NotifyResult`; function signatures as stubs: `computeLayout`, `decodeDesign`, `normaliseDesign`, `buildSheetPdf`, `priceFor`, `parseCm`, `normalisePhone`, `notifyShop`. JSON fixtures in `src/lib/__fixtures__/` (3 cm circle, 5×5 sharp, 5×5 rounded, 10×4 rounded, custom padded PNG) and test files.
- Complete Arabic copy for the builder flow in `src/content/ar/{common,builder,order,pages}.ts`, governorate list, plural helper signature.
- Local `./data/` storage layout and `.env.example`. The owner creates the Telegram bot (instructions in README); until then `ORDER_TRANSPORT=console`.

**Phase 1 — Five Sonnet agents in parallel (worktrees)**

| Agent | Owns | Deliverable |
|---|---|---|
| A. Layout, pricing, parsing | `src/lib/layout/*`, `src/lib/pricing.ts`, `src/lib/parse/{cm,phone}.ts`, `src/lib/plural.ts` | All fixtures pass; rotation case 10×4 → 8 when `allowRotate`; circle gap params parametrised; no neighbour-clip overlap test |
| B. Design pipeline + PDF | `src/lib/design/{decode.client,normalise.server}.ts`, `src/lib/pdf/*`, pdfjs worker setup | `buildSheetPdf` returns `{bytes, report}`; report tested against layout; content stream has N draws; EXIF/CropBox/Rotate fixtures pass; pdfjs smoke test under `next start` |
| C. Builder client | `app/(builder)/*`, `src/components/builder/*`, `useSubmitOrder()`, SVG preview (`<defs>` + `<use>`, object URLs), mobile sticky strip, offer cards, summary card, degraded WhatsApp path | Full flow against stubs/mocks; RTL lint clean; screenshots at 375 px and 1280 px |
| D. Order backend + admin | `app/api/{upload,orders,log}/route.ts`, `src/lib/storage/{local,types}.ts`, settings loader, Telegram adapter with `ORDER_TRANSPORT=console|telegram`, `/admin` (login, orders table, order detail, settings form), purge script | Works with `curl` and fixtures; idempotency test; price-tampering test; admin login test |
| E. Content and pages | Header/Footer (in place), `/how-it-works`, `/order/success`, 404, SEO/OG, README (Arabic + English, price/contact how-to, print at 100%), `copy-review.md` for builder copy suggestions | Static pages, README |

**Phase 2 — Orchestrator:** merge worktrees, swap stubs for real modules, `next build`, run locally end to end.

**Phase 3 — Verification (parallel Sonnet agents + me)**
- Adversarial review, three lenses: print geometry (recompute every number), Arabic/RTL UX with the RTL checklist, security of upload/API/admin.
- Playwright: full flow on 375 px with throttled network and an 8 MB JPG; phone input «٠٧٧٠١٢٣٤٥٦٧» → `+9647701234567`; EXIF-6 JPG gives identical aspect in preview and PDF; custom shape with JPG rejected in Arabic; screenshots reviewed for RTL breakage.
- PDF report checks; one real order end to end into the admin dashboard (and Telegram once the bot exists).

**Phase 4 — Hand-off:** README (how to run locally, create the Telegram bot, change prices, and later deploy with Blob storage), memory notes for future sessions. **No deployment** (Q6).

## 10. Acceptance criteria

| Case | Expected |
|---|---|
| Circle 3 cm, gaps X 2 / Y 0 | 6 × 9 = 54, centred, clipped |
| Circle 3 cm, gaps X 0 / Y 2 (config alt) | 6 × 8 = 48 |
| Sharp rect 5 × 5 | 3 × 5 = 15, no gaps |
| Rounded rect 5 × 5 | 3 × 5 = 15, 2 mm gaps |
| Rounded rect 10 × 4 | upright 6; with `allowRotate` 8 and `rotated: true` |
| Padded transparent PNG, custom 5 cm | size applies to the opaque box |

Plus: PDF is A4 within 0.01 pt with N draws and nothing in the margin; full flow completes on a phone-sized viewport over slow 4G; no English leaks except brand/file names; every order appears in the admin dashboard with downloadable PDF and original; the Telegram message arrives within a minute when configured; the owner can change a price and the delivery fee from the admin settings page; total shown = offer + 5,000.

## 11. Hosting (later) and running costs

- v1 runs locally (`pnpm dev`) with file storage. Deploying later needs: a GitHub repo and Vercel project **under the owner's accounts**, Vercel **Pro** (Hobby forbids commercial use, about $20/month), the `blob` storage adapter (serverless has no persistent disk), and a hosted rate limiter. All documented in STACK_NOTES and README.
- Telegram bot and Turnstile are free.

## 12. Out of scope for v1

Automatic contour cut-lines for custom shapes, multi-design sheets, online payment, customer accounts, Arabic-Indic digit toggle, A3/SRA3, colour management.

## 13. Decisions log

All six questions were answered by the owner on 2026-11-07 (see the table at the top). No open questions remain; remaining **[my call]** items can be changed in the admin settings or config.

## 14. Status (2026-11-07, end of build session)

- Phases 0–3 complete. 201 unit tests, 15 Playwright end-to-end tests (mobile + desktop), typecheck, eslint, RTL check and `next build` all pass.
- Adversarial review: 22 findings raised, 17 confirmed, all 22 addressed (the 3 refuted ones were harmless hardening).
- Not done by design: deployment (owner's Q6), Vercel Blob storage adapter, Turnstile keys, Telegram bot creation (owner creates it; see README), real offer prices and shop WhatsApp/phone (owner enters them in `/admin/settings`).
- Follow-ups worth doing later: placeholders for the hard-coded numbers in copy listed in `docs/copy-review.md` §1; a "remove file" action in the design step; a `blob` storage adapter before any serverless deploy.
