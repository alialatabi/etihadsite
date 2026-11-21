# In-site AI Sticker Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers design their sticker inside the site (shape → size → one idea field → text review → GPT Image 2.6 Flare), the generated PNG becomes the order design, with daily limits, an admin designs page, WhatsApp cleanup and the new keep-forever retention.

**Architecture:** Two new server routes (`/api/design/brief`, `/api/design/generate`) call OpenAI with plain `fetch` from `src/lib/ai/*`; limits and the gallery live in new Supabase tables behind optional `StorageAdapter` methods (local adapter mirrors them in JSON). The generated PNG is stored with `saveUpload` as `uploads/<id>.bin` and enters the existing builder through `b.onFile(file)`, so layout, PDF and staff output are untouched.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4, shadcn/base-ui, zod, sharp, Supabase REST/RPC, Vitest, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-21-ai-sticker-designer-design.md` (decisions D1–D13). Read it before any task.

## Global Constraints

- Run every command from `D:\etihadsite` on branch `feat/ai-sticker-designer`. Search with `graphify query "<q>"` / `graphify explain "<symbol>"` first; run `graphify update .` after each task's code change.
- Gate per task: the task's tests, then `CI=1 pnpm check` (typecheck + test + lint + lint:rtl) before its commit. A missing snapshot must fail, not be written.
- Pinned to the byte, do not touch: `src/lib/layout/*`, `src/lib/__fixtures__/*`, `src/lib/pdf/build-sheet.ts`, `src/lib/pdf/sheet-page.ts`, `src/lib/pdf/build-staff-pdf.ts`.
- Golden snapshots may be updated only where a task says so, one file at a time, with `pnpm vitest -u <file>` and a diff review in the commit.
- No new npm dependency. OpenAI is called with `fetch`.
- All visible text from `src/content/ar/*`; numbers/IPs/sizes in `<Ltr>`; RTL logical classes; `dir="rtl"` on portals; plurals via `count()`.
- New server modules start with `import 'server-only'`, except `src/lib/ai/text-capacity.ts` (pure, used by the browser).
- Every admin page and admin action starts with `await requireAdmin()`; every admin route handler with `adminApiGuard()`.
- Migrations: add `supabase/migrations/20261121000000_ai_designer.sql`; never edit an applied migration.
- Stored shapes (`ShopSettings`, `OrderRecord`, `StoredFileMeta`, `PersistedForm`) only gain optional fields or fields with defaults. Step ids `shape, design, size, quantity, details` stay.
- Model ids: image `gpt-image-2.6-flare`, quality `high`; extractor `gpt-5.4-mini`. Limits: 5 images/IP/day, 300 images/site/day; briefs 20/IP/day, 1,500/site/day. Day = `shopDayKey()` (Asia/Baghdad).
- `OPENAI_API_KEY` is read only from `process.env` inside `src/lib/ai/`; never logged, never in the repo. Tests and e2e use `OPENAI_BASE_URL` pointing at a mock.
- The full client IP is stored in the AI tables (D9). No IP in analytics events or Sentry.

## Review Focus

1. **OpenAI fails mid-request** (timeout, 5xx, content refusal): the reservation is released, the customer gets a friendly Arabic error and keeps their idea, and the try does not count. → Task 7 test `generate releases the reservation when OpenAI fails`.
2. **Customer types a huge or hostile idea** (2,000 chars, "ignore the rules and draw…", HTML): zod rejects > 1,000 chars; the image prompt never contains the raw idea (only the extractor's English description and the confirmed lines). → Task 3 test `prompt never contains the raw idea text`, Task 7 test `brief rejects idea over 1000 chars`.
3. **Customer edits the reviewed lines to something too long and calls the API directly**: the server re-runs `textCapacity` and answers `text_too_long`. → Task 7 test `generate re-checks text capacity`.
4. **Reload after accepting a generated design**: the design, size and step come back exactly like an uploaded design, and submit does not upload the PNG twice. → Task 8 test `accepted AI design survives reload and submit reuses uploadId`.
5. **Old orders and the purge**: the cron no longer deletes order records or design files, only PDFs older than `retentionDays`; an admin opening a purged PDF sees a notice instead of a 500. → Task 6 tests `purge keeps orders and designs, deletes old PDFs` and `admin pdf route answers 410 when the PDF was purged`.

---

### Task 1: WhatsApp cleanup and the deletion sentence (Sonnet, high)

**Files:**
- Modify: `src/components/shell/Header.tsx:14,33-43`, `src/components/shell/Footer.tsx:13,44-51`, `src/app/page.tsx:6-7,90,105-109`, `src/components/builder/steps/ShapeStep.tsx:7-8,19-20,84-98`, `src/components/builder/steps/DesignStep.tsx:10-11,29-30,135-143`, `src/app/how-it-works/page.tsx:6-7,59,135-137`
- Modify copy: `src/content/ar/builder.ts` (`noDesign`, `whatsappText.noDesign|readyFile|editDesign`, `shape.readyFileLink`, `details.consent`), `src/content/ar/pages.ts` (`howItWorks.noDesignTitle|noDesignBody`, `shell.whatsappAria`), `src/content/ar/common.ts` (`filesNotice`, `nav.whatsapp` only if unused after the change)
- Test: `tests/unit/golden/copy.golden.test.ts` (snapshot update)

**Interfaces:** Produces nothing new. Keeps: floating «استفسار» in `Builder.tsx:157-172`, success-page, degraded and no-materials WhatsApp.

- [ ] **Step 1:** Remove the six touchpoints listed in spec §5.1 (header icon, footer link, home hero button, ShapeStep card + readyFile link, DesignStep card + editDesign button, how-it-works card) and their now-unused imports/variables.
- [ ] **Step 2:** Delete the copy keys that are no longer referenced (grep each key before deleting). Set exact copy:
  - `builder.details.consent` = `'اسمك ورقمك وعنوانك نحتفظ بيهم حتى نخدمك بالطلبات الجاية، وما نشاركهم ويا أحد. نطبع حسب الملف المرفوع.'`
  - `common.filesNotice` = `'رقمك وعنوانك نحتفظ بيهم حتى نخدمك بالطلبات الجاية، وما نشاركهم ويا أحد.'`
  - If `consent` used a `{days}` placeholder, remove the argument at its call site.
- [ ] **Step 3:** Run `CI=1 pnpm vitest run tests/unit/golden/copy.golden.test.ts` → FAIL (copy changed). Review the diff shows only the removed keys and the two edited sentences, then `pnpm vitest -u tests/unit/golden/copy.golden.test.ts`.
- [ ] **Step 4:** `CI=1 pnpm check` → PASS. Manually `pnpm dev -p 3123`, open `/` and `/how-it-works`: no WhatsApp except the floating «استفسار».
- [ ] **Step 5:** Commit `feat: one WhatsApp contact button; drop the file-deletion promise`.

### Task 2: `ai` settings (Sonnet, high)

**Files:**
- Modify: `src/lib/types.ts:298-318` (`ShopSettings`), `src/config/defaults.ts:10-55`, `src/lib/storage/settings-schema.ts:29-66`, `src/lib/storage/settings-limits.ts`, `src/app/admin/settings/SettingsForm.tsx`, `src/app/admin/settings/parse-form.ts`, `src/content/ar/admin.ts` (settings labels)
- Test: `tests/unit/admin/settings-form.test.ts`, goldens `schemas-settings.golden.test.ts`, `admin.golden.test.ts` (helper `settingsForm()` L241-281 gains the fields), `supabase-storage.golden.test.ts`, `copy.golden.test.ts`

**Interfaces:**
- Produces: `ShopSettings.ai: AiSettings` with `export interface AiSettings { enabled: boolean; perIpDailyLimit: number; siteDailyLimit: number }`, defaults `{ enabled: true, perIpDailyLimit: 5, siteDailyLimit: 300 }`, placed **after `retentionDays`** in the type, defaults and schema (key order is pinned). Limits in `settings-limits.ts`: `AI_PER_IP_MAX = 100`, `AI_SITE_MAX = 10000`.

- [ ] **Step 1: Failing tests** in `settings-form.test.ts`: `parses ai settings` (form `aiEnabled=on, aiPerIp=7, aiSite=250` → `{enabled:true, perIpDailyLimit:7, siteDailyLimit:250}`), `rejects ai per-IP 0` (→ invalid), `missing aiEnabled means disabled`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement type, defaults, schema (`int(1, AI_PER_IP_MAX)`, `int(1, AI_SITE_MAX)`, `z.boolean()`), form fields (a checkbox «توليد التصاميم بالموقع شغّال», two number fields «حد كل زبون باليوم», «حد الموقع باليوم»), parse. Also relabel `admin.settings.retentionDays` to `'الاحتفاظ بملف الطباعة PDF (يوم)'` (spec §5.6).
- [ ] **Step 4:** Run the unit tests → PASS. Run the four goldens → they FAIL on the new key; review that each diff is only the added `ai` block / label, then update them one file at a time.
- [ ] **Step 5:** `CI=1 pnpm check` → PASS. Commit `feat(settings): ai generation limits`.

### Task 3: Pure AI modules: text capacity, prompt template, request size, IP key (Sonnet, high)

**Files:**
- Create: `src/lib/ai/text-capacity.ts` (no `server-only`), `src/lib/ai/prompt-template.ts`, `src/lib/ai/ip.ts`, `src/lib/ai/config.ts`
- Test: `tests/unit/ai/text-capacity.test.ts`, `tests/unit/ai/prompt-template.test.ts`, `tests/unit/ai/ip.test.ts`

**Interfaces (Produces):**
```ts
// config.ts
export const AI_IMAGE_MODEL = 'gpt-image-2.6-flare';
export const AI_BRIEF_MODEL = 'gpt-5.4-mini';
export const AI_IMAGE_LONG_SIDE = 1024;
export const AI_IDEA_MAX_CHARS = 1000;
export const AI_MAX_LINES = 8;
export const AI_LINE_MAX_CHARS = 60;
export const AI_MAX_REFS = 5;
export const AI_BRIEF_PER_IP = 20;
export const AI_BRIEF_SITE = 1500;
export const AI_OPENAI_TIMEOUT_MS = 50_000;

// text-capacity.ts
export const PT12_EM_UM = 4233;          // 12 pt
export const LINE_PITCH_EM = 1.5;
export const GLYPH_ADVANCE_EM = 0.55;
export const TEXT_HEIGHT_SHARE = 0.5;
export interface TextCapacity { ok: boolean; rowsNeeded: number; rowsAllowed: number; minSizeUm: number | null }
export function usableBoxUm(shape: Shape, widthUm: number, heightUm: number): { w: number; h: number };
export function textCapacity(lines: string[], shape: Shape, widthUm: number, heightUm: number): TextCapacity;

// prompt-template.ts
export interface TemplateInput { shape: Shape; corners: Corners; widthUm: number; heightUm: number; visualDescription: string; lines: string[]; hasRefs: boolean }
export function buildImagePrompt(input: TemplateInput): string;
export function imageRequestSize(shape: Shape, widthUm: number, heightUm: number): { size: string; background: 'transparent' | 'opaque' };

// ip.ts
export function aiIpKey(ip: string): string;   // HMAC-SHA256 hex (64 chars), key = process.env.SESSION_SECRET || 'softy-dev-ai-salt', message 'ai-ip|' + ip
```

Rules (spec §5.3, §5.4):
- `usableBoxUm`: circle → side `0.70 × d × 0.92` (d = min(w,h)); rect → `0.9w × 0.9h`; custom → `0.8w × 0.8h`.
- Character count of a line = code points excluding combining marks (`/\p{M}/u`), after trim. Rows for a line = `ceil(chars × GLYPH_ADVANCE_EM × PT12_EM_UM / usable.w)`; blank lines ignored.
- `rowsAllowed = floor(TEXT_HEIGHT_SHARE × usable.h / (LINE_PITCH_EM × PT12_EM_UM))`; `ok = rowsNeeded ≤ rowsAllowed`.
- `minSizeUm`: when not ok, the smallest width (1,000 µm steps, aspect kept, ≤ 204,000) that is ok; `null` if none; `null` too when already ok.
- `imageRequestSize`: circle and custom → `'1024x1024'` with `transparent`; rect → long side 1024, short side `round(1024 × short/long / 16) × 16`, `opaque`.
- `buildImagePrompt` contains, in order: the designer role line; the shape rule from spec §5.4 table (circle: "circle inscribed in the canvas … transparent outside"; rect: "fill the whole canvas edge to edge … no border, no bleed" plus "rounded corners" note when `corners==='rounded'`; custom: "die-cut … transparent background … one continuous smooth thick white border (about 3% of the canvas width)"); `Final printed size: W cm × H cm` (one decimal); `Artwork: <visualDescription>`; the refs line when `hasRefs`; the numbered lines each wrapped in `«»` with the letter-for-letter rule, or "Do not add any text, letters or numbers." when no lines; the min text rule `at least N% of the canvas's shorter side` with `N = ceil(3000 / min(w,h) × 100)`; the colour rule (bright, no very dark colours, no large black areas, no black or near-black gradients); the style rule (clean vector-like, bold shapes, no tiny details, no watermark, signature or frame, not a mockup).

- [ ] **Step 1: Failing tests**
  - `text-capacity.test.ts`: `3 cm circle cannot hold «حلويات الريم»` → `{ok:false, rowsNeeded:2, rowsAllowed:1}`; `5 cm circle holds it` → `ok:true`; `no lines is always ok` → `{ok:true, rowsNeeded:0}`; `tanween does not count` (`'أهلاً'` counts 4); `minSizeUm is the smallest ok width` (for the 6 birthday lines from spike case c on a 30,000 µm circle: `textCapacity(lines,'circle',min,min).ok === true` and at `min-1000` false); `rect uses 90 % box` (`usableBoxUm('rect',90000,60000)` → `{w:81000,h:54000}`).
  - `prompt-template.test.ts`: `custom asks for transparent background and white border`; `circle asks for inscribed circle and transparent outside`; `every line appears wrapped in «»`; `no lines → no text rule`; `prompt never contains the raw idea text` (build with a `visualDescription` and assert a sentinel Arabic idea string passed nowhere is absent — the function has no idea parameter; assert `Object.keys` of `TemplateInput` usage by building with only the interface); `min text percent for 5 cm is 6`; `imageRequestSize rect 90000×60000 → 1024x688 opaque`, `60000×90000 → 688x1024`, `circle → 1024x1024 transparent`.
  - `ip.test.ts`: `same ip same key`, `different ip different key`, `64 hex chars`, `key depends on SESSION_SECRET` (stub env).
- [ ] **Step 2:** `pnpm vitest run tests/unit/ai` → FAIL (modules missing).
- [ ] **Step 3:** Implement the four files to the rules above.
- [ ] **Step 4:** `pnpm vitest run tests/unit/ai` → PASS; `CI=1 pnpm check` → PASS.
- [ ] **Step 5:** Commit `feat(ai): text capacity, prompt template, ip key`.

### Task 4: OpenAI client, brief extractor, PNG normalisation (Opus)

**Files:**
- Create: `src/lib/ai/openai.ts`, `src/lib/ai/brief.ts`, `src/lib/ai/normalise.ts`
- Test: `tests/unit/ai/openai.test.ts`, `tests/unit/ai/brief.test.ts`, `tests/unit/ai/normalise.test.ts`

**Interfaces:**
- Consumes: Task 3 `config.ts`.
- Produces:
```ts
// openai.ts
export interface OpenAiConfig { apiKey: string; baseUrl: string }
export function openAiConfig(): OpenAiConfig | null;      // null when OPENAI_API_KEY is blank; baseUrl = OPENAI_BASE_URL || 'https://api.openai.com/v1'
export type AiFailure = 'refused' | 'timeout' | 'error';
export interface ImageRef { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' }
export function generateImage(cfg: OpenAiConfig, req: { prompt: string; size: string; background: 'transparent' | 'opaque'; refs: ImageRef[] }): Promise<{ ok: true; png: Uint8Array } | { ok: false; reason: AiFailure }>;
// brief.ts
export interface Brief { lines: string[]; visualDescription: string; fixes: { from: string; to: string }[] }
export function extractBrief(cfg: OpenAiConfig, idea: string): Promise<{ ok: true; brief: Brief } | { ok: false; reason: AiFailure }>;
// normalise.ts
export function normaliseGenerated(png: Uint8Array, shape: Shape): Promise<{ png: Uint8Array; pxWidth: number; pxHeight: number }>;
```
- `generateImage`: no refs → `POST {baseUrl}/images/generations` JSON `{model: AI_IMAGE_MODEL, prompt, size, quality:'high', n:1, background, output_format:'png'}`; refs → `POST {baseUrl}/images/edits` multipart with `image[]` per ref plus the same fields. Timeout `AI_OPENAI_TIMEOUT_MS` via `AbortSignal.timeout`. `refused` when the error code is `moderation_blocked` or the message/type mentions safety/content policy; `timeout` on abort; everything else `error`. Never include the key or the response body in thrown errors or `reportError` calls (codes only).
- `extractBrief`: `POST {baseUrl}/responses` with `model: AI_BRIEF_MODEL`, the spike's instructions (copy from spec §3 notes and add: "Only words the customer explicitly wants WRITTEN on the sticker are printed text — e.g. after «مكتوب», «اكتب», «عليه», a shop or person name, a phone number. Descriptions of the picture (after «بيه», «بي», «جوه», «صورة», «رسمة», colours, objects) are NEVER printed text.") and 4 worked examples, including: «ستيكر مستطيل لكافيه گلبهار، مكتوب عليه كافيه گلبهار وجوة منها چاي وقهوة وپيتزا، وبي كوب چاي عراقي استكان وورد» → `printed_text: ["كافيه گلبهار"]`. Strict JSON schema `{printed_text: string[], visual_description: string, spelling_fixes: {from,to}[]}` mapped to `Brief`. Truncate to `AI_MAX_LINES` lines.
- `normaliseGenerated` (sharp): circle/rect → `flatten({background:'#ffffff'})`, `removeAlpha()`, PNG; custom → raw RGBA pass: alpha ≥ 250 → 255; alpha ≤ 8 → alpha 0 and RGB 255,255,255; PNG with alpha. Returns pixel size.

- [ ] **Step 1: Failing tests** (stub `fetch` with `vi.stubGlobal`):
  - openai: `returns png bytes from b64_json`; `uses /images/edits with image[] when refs are given`; `moderation_blocked → refused`; `abort → timeout`; `500 → error`; `openAiConfig is null without key`; `thrown/returned errors never contain the key` (key string `sk-test-SECRET` absent from any reported value).
  - brief: `maps printed_text/visual_description/spelling_fixes`; `caps lines at 8`; `bad JSON → error`; `request carries the café example in the instructions`.
  - normalise: `alpha 253 becomes 255 for custom` (synthetic 4×4 RGBA with alpha 253 and a transparent dark pixel → output alpha 255 / transparent pixel RGB 255,255,255); `circle is flattened to opaque white` (output channels 3, former transparent corner = 255,255,255); `rect is opaque`.
- [ ] **Step 2:** `pnpm vitest run tests/unit/ai` → new tests FAIL.
- [ ] **Step 3:** Implement the three modules.
- [ ] **Step 4:** Tests PASS; `CI=1 pnpm check` PASS.
- [ ] **Step 5:** Commit `feat(ai): openai client, brief extractor, png normalisation`.

### Task 5: Storage — migration and AI adapter methods (Opus)

**Files:**
- Create: `supabase/migrations/20261121000000_ai_designer.sql`
- Modify: `src/lib/types.ts` (AI types + optional adapter methods), `src/lib/storage/supabase.ts`, `src/lib/storage/local.ts` (relative imports only, no `server-only`)
- Test: `tests/unit/storage/ai-local.test.ts`, `tests/unit/storage/ai-supabase.test.ts` (request-shape tests with stubbed fetch, like `supabase-storage.test.ts`)

**Interfaces (Produces, in `types.ts`):**
```ts
export type AiKind = 'image' | 'brief';
export type AiReserveResult = 'ok' | 'ip_limit' | 'site_limit' | 'blocked';
export interface AiGenerationRecord { id: string; createdAt: string; day: string; ip: string; ipKey: string; shape: Shape; corners: Corners; widthUm: number; heightUm: number; idea: string; lines: string[]; hasRefs: boolean; model: string; uploadId: string; orderId: string | null }
export interface AiUsageRow { day: string; ipKey: string; ip: string; kind: AiKind; count: number; lastAt: string }
export interface AiBlock { ipKey: string; ip: string; createdAt: string }
// StorageAdapter, all optional:
aiReserve?(a: { day: string; ipKey: string; ip: string; kind: AiKind; perIpLimit: number; siteLimit: number }): Promise<AiReserveResult>; // ipKey '' = no per-IP check (TRUST_PROXY=0)
aiRelease?(a: { day: string; ipKey: string; kind: AiKind }): Promise<void>;
aiRecordGeneration?(rec: AiGenerationRecord): Promise<void>;
aiMarkOrdered?(uploadId: string, orderId: string): Promise<void>;
aiListGenerations?(q: { limit: number; offset: number; ipKey?: string }): Promise<{ rows: AiGenerationRecord[]; total: number }>;
aiUsage?(sinceDay: string): Promise<AiUsageRow[]>;
aiBlock?(ipKey: string, ip: string): Promise<void>;
aiUnblock?(ipKey: string): Promise<void>;
aiListBlocks?(): Promise<AiBlock[]>;
```
Migration (pattern of `20261107000100_patch_order.sql`: RLS on, no policies, `revoke all` from anon/authenticated, execute only for `service_role`):
- `ai_usage(day date, ip_key text, ip text, kind text check (kind in ('image','brief')), count int not null default 0, last_at timestamptz, primary key (day, ip_key, kind))`
- `ai_generations(id text primary key, created_at timestamptz default now(), day date, ip text, ip_key text, shape text, corners text, width_um int, height_um int, idea text, lines jsonb, has_refs boolean, model text, upload_id text unique, order_id text)` + index on `(created_at desc)` and `(ip_key)`.
- `ai_blocks(ip_key text primary key, ip text, created_at timestamptz default now())`.
- `reserve_ai(p_day date, p_ip_key text, p_ip text, p_kind text, p_per_ip int, p_site int) returns text`: `pg_advisory_xact_lock(hashtext('ai|' || p_day || '|' || p_kind))`; `'blocked'` if `p_ip_key` in `ai_blocks`; site total = `sum(count)` for (day, kind) → `'site_limit'` when ≥ `p_site`; when `p_ip_key <> ''` and that row's count ≥ `p_per_ip` → `'ip_limit'`; else upsert +1 (`last_at = now()`, `ip = p_ip`) and `'ok'`. Site-only rows use `ip_key = ''`.
- `release_ai(p_day date, p_ip_key text, p_kind text) returns void`: `count = greatest(count - 1, 0)`.
- Local adapter: `ai/usage.json`, `ai/generations.json`, `ai/blocks.json` under `DATA_DIR`, same semantics, guarded by one in-process promise lock (pattern `customersLock`, local.ts:40).

- [ ] **Step 1: Failing tests** (local): `reserve allows 5 then ip_limit`; `site cap 300 → site_limit for a new ip`; `blocked ip → blocked`; `release frees one slot`; `empty ipKey skips per-ip check`; `kinds count separately`; `list generations newest first with total and ipKey filter`; `markOrdered sets orderId by uploadId`; `block/unblock/listBlocks`. Supabase: `aiReserve calls rpc/reserve_ai with the args` and returns its text; `aiListGenerations uses Range and count=exact`; `aiMarkOrdered PATCHes ai_generations?upload_id=eq.<id>`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Write the migration, the types, both adapters.
- [ ] **Step 4:** Tests PASS; `CI=1 pnpm check` PASS (the existing `supabase-storage.golden` must stay green — new methods only).
- [ ] **Step 5:** Commit `feat(storage): ai usage, generations and blocks`.

### Task 6: Keep-forever retention (Opus)

**Files:**
- Modify: `src/lib/storage/supabase.ts:408-458` (`purgeOlderThan`), `src/lib/storage/local.ts:331-387`, `src/lib/types.ts:557-564` (doc comment), `src/app/api/admin/files/[orderId]/[which]/route.ts`, `src/app/admin/orders/[orderId]/page.tsx:169-174`, `src/content/ar/admin.ts`
- Test: `tests/unit/golden/supabase-storage.golden.test.ts` (update), `tests/unit/storage/storage.test.ts` or a new `tests/unit/storage/purge-keep.test.ts`, `tests/unit/golden/routes.golden.test.ts` (purge route snapshot if its output changes)

**Interfaces:** `purgeOlderThan(cutoff, dryRun)` keeps its signature; new behaviour (spec §5.6): delete only `orders/<id>.pdf` of orders older than `cutoff`; never delete order rows/records or design files referenced by any order or by `ai_generations.upload_id` (local: `ai/generations.json`); unreferenced uploads older than `cutoff` and orphan `.bin` > 3 h are still deleted. Admin PDF route: when the PDF file is missing it answers `410` JSON `{ error: 'purged', message: admin.orders.pdfPurged }` with `admin.orders.pdfPurged` = `'ملف الطباعة انحذف بعد مدة الاحتفاظ. التصميم محفوظ.'`. The order page renders that notice instead of the PDF link when the order is older than `retentionDays` (computed from `createdAt` and settings; no storage call on page load). The design download link stays.

- [ ] **Step 1: Failing tests** (local adapter + stubbed Supabase): `purge keeps orders and designs, deletes old PDFs`; `purge keeps an unordered AI upload`; `purge still deletes an unreferenced old upload`; `admin pdf route answers 410 when the PDF was purged`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Update the doc comment in `types.ts`.
- [ ] **Step 4:** Tests PASS. `supabase-storage.golden` (and `routes.golden` if affected) FAIL on the purge request sequence — review that the diff only removes order/design deletes and adds the ai reference lookup, then update one file at a time.
- [ ] **Step 5:** `CI=1 pnpm check` PASS. Commit `feat(retention): keep orders and designs forever, purge only print PDFs`.

### Task 7: Routes — brief, generate, mark ordered; env, Sentry, docs (Opus)

**Files:**
- Create: `src/app/api/design/brief/route.ts`, `src/app/api/design/generate/route.ts`, `src/lib/ai/service.ts` (shared server logic used by both routes)
- Modify: `src/app/api/orders/route.ts` (after `saveOrder`, best-effort `storage.aiMarkOrdered?.(req.uploadId, orderId)` wrapped in try/catch + `reportError` code only), `src/sentry.server.config.ts:17-23` (add `OPENAI_API_KEY`), `.env.example` (add `OPENAI_API_KEY=` and `OPENAI_BASE_URL=` with Arabic/English comment), `src/lib/rate-limit.ts` (add an in-memory `brief` limiter, 30/h per IP; update `misc.golden` capacities snapshot)
- Test: `tests/unit/server/design-brief-route.test.ts`, `tests/unit/server/design-generate-route.test.ts`, `tests/unit/server/orders-route.test.ts` (mark-ordered case)

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces (API contract used by Task 8):
```ts
// POST /api/design/brief  body: { idea: string(1..1000), shape: Shape, widthUm: int, heightUm: int }
type BriefResponse =
  | { ok: true; lines: string[]; fixes: { from: string; to: string }[]; visualDescription: string }
  | { ok: false; error: 'unavailable' | 'rate_limited' | 'invalid_request' | 'failed' };
// POST /api/design/generate  body: { shape, corners, widthUm, heightUm, idea: string(1..1000), visualDescription: string(1..600), lines: string[](≤8, each ≤60), refUploadIds: string[](≤5, ID_RE) }
type GenerateResponse =
  | { ok: true; uploadId: string; png: string /* base64 */; pxWidth: number; pxHeight: number; remainingToday: number | null }
  | { ok: false; error: 'unavailable' | 'blocked' | 'ip_limit' | 'site_limit' | 'text_too_long' | 'refused' | 'failed' | 'invalid_request' };
```
- `generate` order: zod → `settings.ai.enabled && openAiConfig()` else `unavailable` → `textCapacity(lines, shape, w, h).ok` else `text_too_long` → refs: each `readUpload`, magic-byte kind PNG/JPEG (`src/lib/design/kind.ts`) else `invalid_request` → `ip = clientIp(request)`; `ipKey = ip === 'global' ? '' : aiIpKey(ip)` → `aiReserve({day: shopDayKey(new Date()), kind:'image', perIpLimit: settings.ai.perIpDailyLimit, siteLimit: settings.ai.siteDailyLimit})` → non-ok maps to the same error name → `generateImage` (prompt from `buildImagePrompt`, size from `imageRequestSize`) → failure: `aiRelease` then `refused`/`failed` → `normaliseGenerated` → `saveUpload(nanoid(), png, {mime:'image/png', originalName:'ai-design.png', bytes, createdAt})` → `aiRecordGeneration` → `remainingToday = perIp − used` (null when ipKey '') → respond. `export const maxDuration = 60; export const dynamic = 'force-dynamic'`.
- `brief`: zod → enabled + key → in-memory `brief` limiter → `aiReserve({kind:'brief', perIpLimit: AI_BRIEF_PER_IP, siteLimit: AI_BRIEF_SITE})` → `extractBrief` (release on failure) → respond. When the adapter lacks `aiReserve` (should not happen), answer `unavailable`.
- Logs and `reportError` carry codes only (no idea text, no IP, no key).

- [ ] **Step 1: Failing tests** (stub `fetch` for OpenAI via `OPENAI_BASE_URL=http://openai.test`, local storage in a temp `DATA_DIR`): `brief returns lines, fixes and visualDescription`; `brief rejects idea over 1000 chars`; `brief unavailable without key`; `generate stores the png and returns uploadId`; `generate re-checks text capacity`; `generate answers ip_limit on the 6th call from one ip`; `generate answers blocked for a blocked ip`; `generate releases the reservation when OpenAI fails` (count unchanged after a 500); `generate with refs calls /images/edits`; `generate unavailable when settings.ai.enabled is false`; `order with an AI upload marks the generation ordered`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement routes, `service.ts`, orders hook, env/Sentry/rate-limit changes.
- [ ] **Step 4:** Tests PASS; update `misc.golden` (limiter capacities) after reviewing the diff; `CI=1 pnpm check` PASS.
- [ ] **Step 5:** Commit `feat(ai): brief and generate routes`.

### Task 8: Builder UI — first page, AI result, size warning, persistence (Opus)

**Files:**
- Create: `src/components/builder/steps/StartStep.tsx` (renders for step id `shape`), `src/components/builder/ai/TextReview.tsx`, `src/components/builder/ai/AiResult.tsx`, `src/components/builder/ai/useAiDesign.ts`, `src/components/builder/ai/api.ts`
- Modify: `src/components/builder/Builder.tsx:21-27,123-127` (render map), `src/components/builder/useBuilder.ts` (mode, idea, aiSizeUm, `stepOk.shape`), `src/components/builder/logic.ts:43-56,215` (`PersistedForm` optional `mode?: 'ai' | 'upload'`, `idea?: string`, `aiUploadId?: string`, `aiSizeUm?: {w:number;h:number}`), `src/components/builder/steps/DesignStep.tsx` (upload mode unchanged; AI mode renders `AiResult`), `src/components/builder/steps/SizeStep.tsx` (warning), `src/components/builder/useSubmitOrder.ts:35` (seed `uploadId` from `aiUploadId` when the design file is the accepted AI file), `src/content/ar/builder.ts` (new `ai` section, new step labels, new `hero.flow`), `src/content/ar/pages.ts` (how-it-works steps for the new flow)
- Test: `tests/unit/builder/ai-flow.test.ts`, `tests/unit/builder/builder-state.test.ts` (restored keys gain the optional fields), `tests/unit/builder/draft.test.ts` (unchanged: still 5 steps), `copy.golden` update, e2e `tests/e2e/helpers.ts` + `order-flow.spec.ts` + `draft-restore.spec.ts` + `validation.spec.ts` + new `tests/e2e/ai-design.spec.ts`

**Interfaces:**
- Consumes: Task 7 API contract; Task 3 `textCapacity`, `AI_MAX_REFS`, `AI_IDEA_MAX_CHARS`.
- `useAiDesign(b)` returns `{ phase: 'idle'|'reviewing'|'generating'|'result'|'error'; lines: string[]; fixes; capacity: TextCapacity; error?: string; result?: { file: File; uploadId: string; previewUrl: string }; remainingToday: number|null; review(): Promise<void>; setLines(l: string[]): void; generate(): Promise<void>; accept(): Promise<void>; retry(): Promise<void> }`. `accept()` builds `new File([png], 'ai-design.png', {type:'image/png'})`, calls `b.onFile(file)`, stores `aiUploadId` and `aiSizeUm` in the form, and moves to step `size`.
- References: uploaded via the existing `uploadWithProgress` (`src/components/builder/orderApi.ts:24-39`) → `uploadId`s, then sent as `refUploadIds`.

Behaviour (spec §5.2, §5.3; D3, D7):
- Step `shape` (StartStep): shape cards (+corners) → size inputs (reuse SizeStep's input block as a shared component; no DPI there) → textarea (max 1000, counter) → refs picker (≤ 5, PNG/JPEG, thumbnails, remove) → «ولّد التصميم» → TextReview (editable lines, delete/add, fixes list, capacity warning `builder.ai.tooMuchText` with `{size}` = `formatCm(minSizeUm)`; confirm disabled while `!capacity.ok`) → confirm starts generation and goes to step `design`. Below everything: «عندي تصميم جاهز» → `mode='upload'` → step `design` (existing upload UI). When AI is unavailable (`unavailable`, `site_limit`, `blocked`) show `builder.ai.unavailable` and keep «عندي تصميم جاهز».
- `stepOk.shape` = shape set **and** (`mode==='upload'` **or** valid size). `stepOk.design` = design decoded (both modes).
- Step `design`, AI mode: progress (`builder.ai.generating`, ~15 s), then image on a checkerboard for custom, `«الكتابة: …»`, remaining tries, «أكمل بهذا» / «جرّب مرة لخ» (disabled at 0 remaining) / «عدّل الفكرة» (back to `shape`). Errors map to `builder.ai.errors.<code>`.
- Custom shape size: after accept, keep the **longer** side of the decoded design at the typed size (spec §5.2): set width so that `max(w,h) === typed` before `deriveLockedSize`.
- Step `size`: when `aiSizeUm` exists and the current size is smaller in either dimension, show `builder.ai.shrinkWarning`.
- Draft: persist `mode`, `idea`, `aiUploadId`, `aiSizeUm` (optional). The accepted PNG persists through the existing IndexedDB design slot. Refs and un-accepted results are not persisted.
- Submit: if `form.aiUploadId` and the design file is the AI file (`file.name === 'ai-design.png'` and same size), seed the submit context `uploadId` so the file is not uploaded again.

Copy (`builder.ai`, exact):
```
title: 'صمّم ستيكرك', ideaLabel: 'اكتب فكرتك وكل التفاصيل', ideaHint: 'شنو تريد بالرسمة، والكتابة اللي تريدها على الستيكر بالضبط',
refs: 'صور مرجعية (اختياري، لحد 5)', generate: 'ولّد التصميم', readyDesign: 'عندي تصميم جاهز',
reviewTitle: 'الكتابة اللي راح تنطبع على الستيكر', addLine: 'أضف سطر', fixesTitle: 'صححنا الإملاء:', confirm: 'تمام، ولّد',
tooMuchText: 'كتابتك كثيرة على هذا القياس — قلّلها أو كبّر القياس لـ {size}', generating: 'جاري تصميم ستيكرك… (حوالي 15 ثانية)',
printedText: 'الكتابة:', remaining: 'باقيلك {n} محاولات اليوم', accept: 'أكمل بهذا', retry: 'جرّب مرة لخ', editIdea: 'عدّل الفكرة',
shrinkWarning: 'صغّرت الستيكر عن قياس التصميم — الكتابة ممكن تصغر وما تبين بالطبع',
unavailable: 'التصميم بالموقع مو متوفر هسه. تكدر ترفع تصميمك الجاهز.',
errors: { ip_limit: 'خلصت محاولاتك لليوم. ارجع باچر أو ارفع تصميم جاهز.', site_limit: 'التصميم بالموقع وصل حده اليوم. ارجع باچر أو ارفع تصميم جاهز.', blocked: 'التصميم بالموقع مو متوفر إلك. تكدر ترفع تصميم جاهز.', text_too_long: 'الكتابة كثيرة على هذا القياس.', refused: 'ما نكدر نصمم هذي الفكرة. جرّب فكرة ثانية.', failed: 'صار خلل بالتصميم، ما انحسبت المحاولة. جرّب مرة لخ.', invalid_request: 'تأكد من الفكرة والصور وجرّب مرة لخ.', unavailable: 'التصميم بالموقع مو متوفر هسه.' }
```
Step labels: `builder.steps.shape` = `'صمّم'`, `design` = `'التصميم'`, `size` = `'الترتيب'` (others unchanged). `builder.hero.flow` first item becomes `'صمّم ستيكرك'` (rest unchanged). How-it-works step 1 text: `'اختار الشكل والقياس واكتب فكرتك — نصمم لك الستيكر بثواني، أو ارفع تصميمك الجاهز.'`. Plurals for `{n}` via `count()`.

- [ ] **Step 1: Failing tests** (`ai-flow.test.ts`, pure logic extracted into `logic.ts`/`useAiDesign` helpers): `stepOk.shape requires size in ai mode only`; `custom accept keeps the longer side at the typed size`; `shrink warning only below the generated size`; `restoredState keeps mode, idea, aiUploadId, aiSizeUm`; `accepted AI design survives reload and submit reuses uploadId` (submitFlow with seeded uploadId does not call upload).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement components, hook, copy.
- [ ] **Step 4:** Unit tests PASS; `copy.golden` and `builder-state` updated after diff review. e2e: `tests/e2e/ai-design.spec.ts` with a mock OpenAI server (`OPENAI_BASE_URL` → a tiny Node HTTP server started in Playwright `globalSetup`, returning a fixed PNG and a fixed brief) covering idea → review → generate → accept → arrangement → quantity → details → submit; update helpers/specs for the new first page (upload path: shape → «عندي تصميم جاهز» → upload). Run `pnpm e2e` → PASS.
- [ ] **Step 5:** `CI=1 pnpm check` PASS. Commit `feat(builder): in-site AI design flow`.

### Task 9: Admin «التصاميم» page (Sonnet, high)

**Files:**
- Create: `src/app/admin/designs/page.tsx`, `src/app/admin/designs/actions.ts`, `src/app/admin/designs/DesignGrid.tsx`, `src/app/api/admin/designs/[id]/image/route.ts`, `src/app/admin/designs/summary.ts` (pure)
- Modify: `src/app/admin/layout.tsx:18-32` (nav link + badge), `src/content/ar/admin.ts` (`nav.designs`, `designs.*`)
- Test: `tests/unit/admin/designs-summary.test.ts`, `tests/unit/admin/designs-actions.test.ts`, `copy.golden` update

**Interfaces:**
- Consumes: Task 5 adapter methods; Task 2 settings.
- `summary.ts`: `export function designsSummary(usage: AiUsageRow[], today: string, perIpLimit: number): { today: number; month: number; allTime: number; alerts: { ipKey: string; ip: string; count: number; lastAt: string; day: string }[] }` — counts `kind==='image'` only; month = same `YYYY-MM` as today; alerts = rows of today and yesterday with `count ≥ perIpLimit` and `ipKey !== ''`, newest `lastAt` first. `allTime` sums all rows (400 days kept; label says «آخر 400 يوم» is not needed — show «الكل»).
- `actions.ts`: `blockIpAction(formData)`, `unblockIpAction(formData)` — `await requireAdmin()` first, zod `ipKey` 64 hex, `ip` string ≤ 64, then adapter call, `revalidatePath('/admin/designs')`.
- Image route `GET /api/admin/designs/[id]/image`: `adminApiGuard()` first; `id` is the generation's `uploadId`, validated with `ID_RE` (else 404); `storage.readUpload(id)` (null → 404); stream the bytes inline as `image/png` with `Cache-Control: private, max-age=3600`.
- Page (`requireAdmin()` first, `dynamic='force-dynamic'`): counters (today `x / siteDailyLimit`, month, all), alerts list with full IP in `<Ltr>`, count, time, «عرض» (`?ip=<ipKey>`) and «احظر» form; blocked list with «إلغاء الحظر»; grid 48 per page (`?page=`), each card: `<img src="/api/admin/designs/<uploadId>/image" loading="lazy">`, time (Baghdad), shape + size cm, idea (clamped 3 lines), printed lines, ordered badge linking `/admin/orders/<orderId>`.
- Nav badge: `designsSummary(...).alerts.length` when > 0 (layout reads usage for today+yesterday only).

Copy (`admin.designs`, exact): `title: 'التصاميم'`, `today: 'اليوم'`, `month: 'هذا الشهر'`, `all: 'الكل'`, `alerts: 'زبائن وصلوا الحد'`, `alertRow: '{count} تصاميم'`, `view: 'شوف'`, `block: 'احظر'`, `unblock: 'إلغاء الحظر'`, `blocked: 'المحظورين'`, `empty: 'ماكو تصاميم بعد'`, `ordered: 'صار طلب'`, `printed: 'الكتابة'`, `idea: 'الفكرة'`, `prev: 'السابق'`, `next: 'التالي'`; `admin.nav.designs: 'التصاميم'`.

- [ ] **Step 1: Failing tests:** summary — `counts only image kind`, `month uses Baghdad YYYY-MM`, `alerts include today and yesterday at the limit`, `site-only rows never alert`; actions — `block requires admin` (mock `requireAdmin` to throw), `block rejects a bad ipKey`, `block calls aiBlock and revalidates`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests PASS; `copy.golden` updated after review; `CI=1 pnpm check` PASS; manual check with `pnpm dev -p 3123` and local data.
- [ ] **Step 5:** Commit `feat(admin): designs page with counters, alerts and blocking`.

### Task 10: Docs, final gate, live smoke (Opus, main session)

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§4 env table: `OPENAI_API_KEY`, `OPENAI_BASE_URL`; §5 privacy: AI tables store full IP (D9), retention table (D10); §9 invariant notes for the new tables and the AI step behaviour; a short "AI designer" section with the flow and module map), `README.md` (env list), `docs/STACK_NOTES.md` (OpenAI image API notes: Flare/Sunburst, sizes ÷16, `background`, alpha 253 quirk)

- [ ] **Step 1:** Update the docs.
- [ ] **Step 2:** `CI=1 pnpm check` → PASS; `pnpm build` → PASS; `pnpm e2e` → PASS.
- [ ] **Step 3:** Live smoke with the real key in `.env.local` (`STORAGE=local`): one generation per shape through the UI; open the order PDF and the admin designs page; copy screenshots to `Claude outputs/ai-sticker-test/smoke/` for the owner.
- [ ] **Step 4:** `graphify update .`; commit `docs: AI designer, retention and privacy changes`.
- [ ] **Step 5:** Hand-over to the owner (not done by the agent): rotate the key, set `OPENAI_API_KEY` in Vercel, apply the migration on production Supabase, then deploy — only when the owner says so.
