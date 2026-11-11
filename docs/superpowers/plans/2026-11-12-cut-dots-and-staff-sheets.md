# Cut dots and staff sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every sheet PDF (customer orders and a new hidden staff page) carries the 4 camera-cutter dots, stickers may go to 3 mm from the edge but never near a dot, and employees get a secret page that turns many designs into one multi-page print-and-cut PDF in the browser.

**Architecture:** The pure layout engine gains an optional `marks` parameter (dot keep-out search); `layoutParamsFor()` always passes it, so the website builder, the order route, /how-it-works and the staff page share one rule. The sheet-page drawing moves out of the `server-only` PDF builder into an isomorphic module that the server (orders) and the browser (staff page) both call. The staff page prepares artwork in the browser and never uploads.

**Tech Stack:** Next.js 16 App Router, TypeScript, pdf-lib 1.17.1, pdfjs-dist, vitest, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-12-cut-dots-and-staff-sheets-design.md` (read it; every section letter below, A1 to B5, refers to it).

## Global Constraints

- Branch `cut-dots-staff-page`. One commit per task, local only. Never push, never deploy, never touch the live Supabase project or Vercel.
- Integer micrometres everywhere (`src/lib/units.ts`); squared-distance comparisons in integers (doubled coordinates where a half appears).
- Dots: centre 7 000 µm from both nearest edges, diameter 5 000 µm, clearance 3 000 µm (keep-out radius 5 500 µm), order TL (7000,7000), TR (203000,7000), BL (7000,290000), BR (203000,290000). PDF colour DeviceCMYK `0 0 0 1`, fill `f*`, inside optional-content layer named exactly `sk_marks`.
- Default margin `DEFAULT_SETTINGS.layout.marginUm = 3_000`.
- `computeLayout(spec, params)` without `params.marks` must return exactly what it returns today (all of `src/lib/__fixtures__/layout-cases.json` passes unchanged; that file is never edited).
- Copy only in `src/content/ar/*`; numbers in `<Ltr>`; logical RTL utilities; `pnpm lint:rtl` passes. Marks hint text, verbatim: `النقاط السودة بالزوايا علامات لمكينة القص، ما تطلع على الستيكر.`
- No new dependency. Files that touch secrets or `node:` APIs start with `import 'server-only'`; the new isomorphic PDF and layout modules must NOT.
- Golden snapshots (`tests/unit/golden/__snapshots__`): a task that changes behaviour updates only the snapshot files its change explains, one file at a time (`pnpm exec vitest run <file> -u`), and reads the diff. A diff line not explained by "dots added / margin 3 mm / counts and prices per sheet changed / rounded clip / print scaling / new strings / new route" is a bug to fix, not to record.
- Gate after every task: `CI=1 pnpm check` green.
- Never copy the repo or create a `node_modules` junction. Do not start a second `next dev` in this repo while one runs (check ports 3000/3199 first).

## Review Focus

1. A design whose aspect makes `maxWidthFor()` walk thousands of µm (aspect ≈ 0.70, rotation on): the size field must stay responsive (Task 1 test: same answer as the 1 µm walk, under 300 layout runs).
2. Rotation ON (live setting) + mixed layout + dots: removal must recount `turnedCount`, and the browser and server must pick the same arrangement (Task 1 test on a mixed case, Task 3 test that the order route and `safeLayout` agree).
3. A wrong, missing or short staff key, or a key typed with different case: always the normal 404, never a hint (Task 4 tests).
4. A JPEG with EXIF orientation 6 or a CMYK JPEG on the staff page: printed upright and in normal colours (Task 5 tests with `tests/fixtures/exif6-600x400.jpg`).
5. A PDF design with /Rotate 90 and a CropBox ≠ MediaBox on the staff page: same box and turn as the server (Task 5 test with `tests/fixtures/cropbox-rot90.pdf`, compared with `normaliseArtwork`).

---

### Task 1: Dot keep-out in the layout engine (model: opus)

**Files:**
- Create: `src/lib/layout/marks.ts`, `src/lib/layout/marks.test.ts`
- Modify: `src/lib/types.ts` (Layout engine section), `src/lib/layout/index.ts`
- Update snapshot: `tests/unit/golden/__snapshots__/layout.golden.test.ts.snap`

**Interfaces:**
- Produces (types.ts):
  - `export interface RegMarks { offsetUm: number; diameterUm: number; clearanceUm: number }`
  - `LayoutParams.marks?: RegMarks`
  - `LayoutResult.marks?: { diameterUm: number; centres: { xUm: number; yUm: number }[] }` (present iff `params.marks`)
  - `LayoutResult.removedNearMarks?: number` (present iff `params.marks`, may be 0)
- Produces (marks.ts): `export const REG_MARKS: RegMarks` (7000/5000/3000); `export function markCentres(m: RegMarks): { xUm: number; yUm: number }[]` (TL, TR, BL, BR on A4); `export function isNearMark(cell: { xUm: number; yUm: number; widthUm: number; heightUm: number }, clip: ClipShape, centre: { xUm: number; yUm: number }, m: RegMarks): boolean`.
- Produces (index.ts): `layoutParamsFor()` returns `{ ...today, marks: REG_MARKS }` for every shape.

- [ ] **Step 1: Write failing tests in `src/lib/layout/marks.test.ts`**
  - `markCentres(REG_MARKS)` equals the 4 centres of Global Constraints, in that order.
  - `isNearMark`: rect cell at distance exactly 5 500 µm from a centre → false; 5 499 → true; circle clip uses the inscribed circle (a 58 mm cell whose box corner is inside the keep-out but whose circle is ≥ 5.5 mm away → false).
  - example.pdf: `computeLayout({shape:'circle', widthUm:58000, heightUm:58000}, {marginUm:3000, gapXUm:2000, gapYUm:0, allowRotate:false, minSideUm:5000, clip:{kind:'circle'}, marks:REG_MARKS})` → 15 placements, column x = 16000/76000/136000, row y = 3500 + 58000·k, `removedNearMarks` 0, `marks.centres` as above, `marks.diameterUm` 5000.
  - sharp 51 000 × 58 000 µm, margin 3000, gaps 0, no rotation → 16 placements, `removedNearMarks` 0, placements 4 × 4 starting at y ≥ 12 500 (area 3 won the tie against area 1's 20 − 4).
  - "choose after removal": with rotation on, sharp 21 000 × 39 000, margin 3000, gaps 0: the result count ≥ the count the test computes itself for the upright grid and for the rotated grid (each from `computeLayout` without marks and `allowRotate: false`, then filtered with `isNearMark`). The builder check found a 1–2 sticker loss here when orientation is chosen before removal.
  - a mixed case (rotation on, w ≠ h) where cells are removed: `turnedCount === placements.filter(p => p.turned).length` and `countPerSheet === placements.length`.
  - property test (deterministic LCG seed, ≥ 400 cases: shapes × sizes 5–150 mm × margins 0/3/4/7 mm × rotation on/off): every placement inside page − margin, none near a dot (`isNearMark` false for all 4), no two placements overlapping, page-axis gaps kept between neighbours.
  - no-marks identity: for every fixture in `layout-cases.json`, `computeLayout` output has no `marks` / `removedNearMarks` keys (the existing fixtures test covers equality).
  - `maxWidthFor`: for aspects [0.3, 0.7, 0.70, 1, 1.43, 3] × rotation on/off × marks on/off, result equals a reference copy of today's 1 µm walk (copy the current function body into the test as `maxWidthWalk`), and a spy/counter shows ≤ 300 `computeLayout` calls per call.
- [ ] **Step 2: Run** `pnpm exec vitest run src/lib/layout` — expect the new tests to FAIL.
- [ ] **Step 3: Implement** in `marks.ts` and `index.ts` per spec A2:
  - `computeLayout`: when `params.marks` is absent run today's code path unchanged. When present, validate `marks` fields are non-negative integers with `diameterUm > 0` (else `invalid`), then for area 1 (page − margin) and, only if area 1's winner removed ≥ 1, areas 2 (x inset = max(margin, offset + diameter/2 + clearance)) and 3 (same inset on y): build every option today's engine considers (upright grid; rotated grid if `allowRotate`; mixed if `allowRotate && w ≠ h`) centred in that area, drop placements near any dot, pick by count after removal, ties fewer removed then upright < rotated < mixed. Across areas: count, then fewer removed, then lower area. Every option count 0 everywhere → `too_big_for_page`.
  - Result: `usable` = page − margin (not the inset area); `block` = chosen option's pre-removal block; `cols/rows` = its main grid; `countPerSheet`, `turnedCount` recounted after removal; add `marks` and `removedNearMarks` as the last keys.
  - Refactor `attempt`/`mixedLayout` to take an explicit area so both paths share them; the no-marks path passes `usableArea(margin)` (identical output).
  - `maxWidthFor`: same definition, exponential + binary search over `fits(w)` instead of the 1 µm walk.
- [ ] **Step 4: Run** `pnpm exec vitest run src/lib/layout` — PASS (including `fixtures.test.ts` and `layout.test.ts` unchanged).
- [ ] **Step 5: Golden** — `CI=1 pnpm exec vitest run tests/unit/golden/layout.golden.test.ts` fails only where `layoutParamsFor` now adds `marks` (params table, settings-variant layouts, maxWidthFor, how-it-works examples). Raw-params sections ("validation and boundaries", `pack.ts`) must NOT change. Update with `-u`, read the diff.
- [ ] **Step 6: Gate** `CI=1 pnpm check`. Other golden files that fail now (builder logic, routes, pages) belong to Task 3; if they fail here, update them here under the same diff rule and list them in the commit message.
- [ ] **Step 7: Commit** `git add -A src/lib tests && git commit -m "Layout: keep stickers clear of the 4 cutter dots"`

### Task 2: Sheet page drawer, dots in the PDF, staff multi-page PDF (model: opus)

**Files:**
- Create: `src/lib/pdf/sheet-page.ts` (isomorphic), `src/lib/pdf/build-staff-pdf.ts` (isomorphic), `tests/unit/pdf/sheet-page.test.ts`, `tests/unit/pdf/build-staff-pdf.test.ts`
- Modify: `src/lib/pdf/build-sheet.ts`
- Update snapshot: the golden file that pins sheet PDF bytes/hashes (`grep -l buildSheetPdf tests/unit/golden/*.ts`)

**Interfaces:**
- Consumes: `LayoutResult.marks` (Task 1), `NormalisedArtwork`, `cellSizeFor`.
- Produces:
  - `export async function drawSheetPage(doc: PDFDocument, layout: LayoutResult, artwork: NormalisedArtwork): Promise<{ drawCount: number; placementsPt: { x: number; y: number; w: number; h: number }[]; clipped: boolean }>` — adds one A4 page to `doc`, embeds the artwork once, draws every placement (today's matrices), clips `circle` as today, clips `roundedRect` to a rounded rectangle of the cell with `umToPt(clip.radiusUm)` (radius ≤ half the shorter side), keeps the extra rect clip for `none`, then draws the dots when `layout.marks` is present.
  - `export function setPrintAtActualSize(doc: PDFDocument): void` — `/ViewerPreferences << /PrintScaling /None >>`.
  - `export async function buildStaffPdf(items: { layout: LayoutResult; artwork: NormalisedArtwork }[], now: Date): Promise<Uint8Array>` — one page per item in order; title `Softy sheets`, producer and creator `Softy Printing`, creation date `now`, print scaling none.
  - `buildSheetPdf(input)` keeps its signature and report; it calls `drawSheetPage` and `setPrintAtActualSize`.
- Dots drawing (one block per page, after the stickers): `q`, `/OC /<prop> BDC`, `0 0 0 1 k`, the 4 circles via the existing `circlePath` (4 Bezier quarters each), `f*`, `EMC`, `Q`. The OCG dict `<< /Type /OCG /Name (sk_marks) >>` is created once per document and listed in the catalog `/OCProperties << /OCGs [ref] /D << /Order [ref] /ON [ref] >> >>`; each page maps it in `/Resources /Properties`. Use `PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence | FillEvenOdd | EndMarkedContent, …)` where pdf-lib has no helper.

- [ ] **Step 1: Write failing tests** (parse the output with pdf-lib, decode the content stream as in `docs/STACK_NOTES.md` or the existing PDF tests):
  - dots: content stream contains exactly one `sk_marks` BDC block with `0 0 0 1 k` and `f*`; the 4 circle centres are at (19.8425, 19.8425), (575.4331, 19.8425), (19.8425, 822.0473), (575.4331, 822.0473) pt ± 0.001 and radius 7.0866 pt ± 0.001; the catalog has `/OCProperties` whose OCG `/Name` is `sk_marks`.
  - `drawCount === layout.countPerSheet` and `placementsPt.length` too (dots are not XObject draws).
  - `roundedRect` layout: each cell's `q … Q` contains a clip path with Bezier curves and `W n`; `circle` and `none` cells unchanged from today's operators.
  - catalog `/ViewerPreferences /PrintScaling /None`.
  - `buildStaffPdf` with 2 items (one raster, one PDF artwork from `tests/fixtures/cropbox-rot90.pdf` normalised by the server function) → 2 pages, each with its own dots block, title `Softy sheets`.
  - a layout without `marks` → no `sk_marks` block, no `/OCProperties`.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/pdf` — FAIL.
- [ ] **Step 3: Implement** `sheet-page.ts` (move the body of `buildSheetPdf` there; keep every operator for circle/none byte-identical), `build-staff-pdf.ts`, and slim `build-sheet.ts`.
- [ ] **Step 4: Run** `pnpm exec vitest run tests/unit/pdf` — PASS.
- [ ] **Step 5: Golden** — update the PDF golden file; its diff may only show changed hashes/sizes plus fields explained by dots, rounded clip and print scaling.
- [ ] **Step 6: Gate** `CI=1 pnpm check`.
- [ ] **Step 7: Commit** `git commit -m "PDF: draw the cutter dots, print rounded corners, ask for actual-size printing"`

### Task 3: 3 mm margin default, dots on screen, live-settings migration (model: sonnet)

**Files:**
- Modify: `src/config/defaults.ts` (`marginUm: 3_000`), `data-e2e/settings.json` (`marginUm` 3000), `src/components/builder/SheetPreview.tsx`, `src/app/how-it-works/SheetIllustration.tsx`, the /how-it-works page (render the hint under the spec section), the builder preview area (render the hint under the sheet), `src/content/ar/common.ts` (`marksHint`)
- Create: `supabase/migrations/20261112000000_margin_3mm_settings.sql`, `tests/unit/components/sheet-marks.test.tsx`
- Update snapshots: copy, settings/schemas, builder logic, routes, pages, metadata — only those that fail, one at a time.

**Interfaces:**
- Consumes: `LayoutResult.marks` (Task 1).
- Produces: `common.marksHint` = the verbatim string in Global Constraints.

- [ ] **Step 1: Failing tests** — `SheetPreview` with a layout that has `marks` renders 4 `circle` elements with `r = 2500`, `fill="#000"` at the 4 centres; without `marks` renders none. `SheetIllustration` likewise (mm units: r 2.5 at 7/203 × 7/290). `DEFAULT_SETTINGS.layout.marginUm === 3000`. The order route and `safeLayout()` return the same `countPerSheet` for circle 5.8 cm with `DEFAULT_SETTINGS` + `allowRotate: true` (15).
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement.** Migration, modelled on `20261111000100_upload_15mb_settings.sql` (header comment: owner decision 2026-11-12, apply AFTER the code deploy, idempotent): `update public.settings set data = jsonb_set(data, '{layout,marginUm}', '3000'::jsonb), updated_at = now() where id = 1 and coalesce((data->'layout'->>'marginUm')::int, -1) <> 3000;`
- [ ] **Step 4: Run** the tests — PASS.
- [ ] **Step 5: Golden + e2e expectations** — update failing golden files one by one under the diff rule. Grep `tests/e2e` for hard-coded counts/prices that the margin change moves and update them to the new computed values.
- [ ] **Step 6: Gate** `CI=1 pnpm check`.
- [ ] **Step 7: Commit** `git commit -m "Margin 3 mm by default; show the cutter dots in the previews"`

### Task 4: Staff page access and privacy (model: sonnet)

**Files:**
- Create: `src/lib/staff-key.ts` (`import 'server-only'`), `src/app/staff/[key]/page.tsx` (temporary body: the page title only; Task 6 fills it), `src/content/ar/staff.ts` (exported from `src/content/ar/index.ts`), `tests/unit/server/staff-key.test.ts`, `tests/unit/pages/staff-page.test.tsx`
- Modify: `src/components/shell/Tracker.tsx`, `src/components/shell/InstallPrompt.tsx`, `src/app/api/track/route.ts` (drop `/staff` and `/staff/*` like `/admin`), `src/app/admin/settings/page.tsx` (show the link), `.env.example`, `.env.local` (add a random 32-char `STAFF_PAGE_KEY`; never commit it), `playwright.config.ts` (`STAFF_PAGE_KEY: 'e2e-staff-key-e2e-staff-key-1234'` in `webServer.env`)

**Interfaces:**
- Produces: `export function isStaffKey(candidate: string | undefined): boolean` (false when `process.env.STAFF_PAGE_KEY` is missing or shorter than 24 chars; constant-time compare of sha256 digests, case-sensitive); `export function staffPagePath(): string | null` (`/staff/<key>` or null).
- Page: `export const dynamic = 'force-dynamic'`; `generateMetadata` → `{ title: staff.title, robots: { index: false, follow: false }, referrer: 'no-referrer' }`; first statement `if (!isStaffKey((await params).key)) notFound()`.
- Admin settings shows `staff.adminLinkLabel` + the absolute link (built from the request host) only when `staffPagePath()` is not null.

- [ ] **Step 1: Failing tests** — `isStaffKey`: missing env, 23-char env, wrong key, different case, right key. Page: wrong key → `notFound` called; right key → renders `staff.title`. `/api/track` with path `/staff/abc` → 204 and nothing stored. Tracker/InstallPrompt skip `/staff/...`. `robots.ts` and `sitemap.ts` output contains no `staff`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Golden** — copy (new `staff` module), admin, analytics, metadata as they fail, under the diff rule.
- [ ] **Step 6: Gate** `CI=1 pnpm check`. **Step 7: Commit** `git commit -m "Hidden staff page behind a secret link"`

### Task 5: Artwork preparation in the browser (model: opus)

**Files:**
- Create: `src/lib/design/pdf-box.ts` (isomorphic), `src/lib/design/prepare.client.ts`, `tests/unit/design/prepare-client.test.ts`, `tests/unit/design/pdf-box.test.ts`
- Modify: `src/lib/design/normalise.server.ts` (use `pdfArtworkBox`; its golden must not change)

**Interfaces:**
- Produces:
  - `export function pdfArtworkBox(doc: PDFDocument): { box: { x: number; y: number; width: number; height: number }; rotate: 0 | 90 | 180 | 270; pageCount: number } | null` — exactly the server's rule (TrimBox else CropBox, /Rotate rounded to 90°), null when the box is empty.
  - `export type PrepareError = 'encrypted' | 'corrupt' | 'no_alpha'`
  - `export async function prepareArtwork(source: DesignSource, spec: StickerSpec, targetDpi: number): Promise<{ ok: true; artwork: NormalisedArtwork; effectiveDpi: number | null } | { ok: false; error: PrepareError }>` — PNG/JPEG: `createImageBitmap(file, { imageOrientation: 'from-image' })`, crop to `source.trim` when present, downscale (never up) so the long side ≤ `pxForUmAtDpi(size, targetDpi)` for the ordered size, encode PNG when `source.hasAlpha` else JPEG 0.92; PDF: original bytes + `pdfArtworkBox`.
- [ ] **Step 1: Failing tests** — `pdfArtworkBox` equals the server result for every PDF in `tests/fixtures` (vitest, node). `prepareArtwork` in a jsdom/happy-dom or mocked-canvas setup as the existing `tests/unit/design` tests do: EXIF-6 JPEG comes out 400 × 600; a 4000 px PNG for a 2 cm sticker at 300 DPI comes out 236 px long side; padded PNG with custom shape is cropped to its trim box; a PDF returns `kind: 'pdf'` with the server's box and rotate; encrypted PDF → `encrypted`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; `tests/unit/golden/design-pdf.golden.test.ts` unchanged.
- [ ] **Step 5: Gate** `CI=1 pnpm check`. **Step 6: Commit** `git commit -m "Prepare designs for print in the browser (staff page)"`

### Task 6: Staff page UI (model: sonnet)

**Files:**
- Create: `src/components/staff/StaffSheets.tsx` (client), `src/components/staff/StaffCard.tsx`, `src/components/staff/useStaffItems.ts`, `tests/unit/components/staff-sheets.test.tsx`
- Modify: `src/app/staff/[key]/page.tsx` (render `<StaffSheets layoutSettings={settings.layout} quality={settings.quality} />`), `src/content/ar/staff.ts`

**Interfaces:**
- Consumes: `decodeDesign` (with `maxBytes` 50 MB), `safeLayout`, `safeDerive`, `safeMaxWidth`, `safeParseCm`, `safeFormatCm`, `SheetPreview`, `prepareArtwork` (Task 5), `buildStaffPdf` (Task 2, dynamic import), `count(n, common.plural.sticker)`, `formatShopDateTime`/`SHOP_TIME_ZONE` for the file name.
- Behaviour (spec B2): multi-file picker and drop area (PNG/JPG/PDF, ≤ 30 files, ≤ 50 MB each); one card per file with thumbnail, file name (`<Ltr>`), shape select (circle default; rounded, sharp, custom), size inputs as the website (one diameter field for circles; aspect lock; PDF prefill), `SheetPreview`, per-sheet count, the website's error messages, low-DPI warning (never blocks), remove button; one button `staff.download` enabled when ≥ 1 card and every card valid; output `softy-sheets-YYYYMMDD-HHmm.pdf` (Baghdad time); a one-line reminder `staff.printActualSize` (print at 100 %). Reuse builder error copy where the meaning is identical.
- [ ] **Step 1: Failing tests** — adding 2 files makes 2 cards; an invalid size disables the button; download calls `buildStaffPdf` with 2 items in card order and a file name matching `/^softy-sheets-\d{8}-\d{4}\.pdf$/`; custom shape + JPEG shows the `no_alpha` message.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Golden** — copy only. **Step 6: Gate** `CI=1 pnpm check` (incl. `lint:rtl`). **Step 7: Commit** `git commit -m "Staff page: many designs in, one print-and-cut PDF out"`

### Task 7: End-to-end test and docs (model: sonnet)

**Files:**
- Create: `tests/e2e/staff.spec.ts`
- Modify: `docs/ARCHITECTURE.md` (route map, staff page, env var table, dots, module homes, hard invariant on dots geometry), `docs/PLAN.md` §2 and §4 (margin 3 mm, dots, rounded corners printed, machine reads the paper; mark the old "Q3 cut lines" text as superseded on 2026-11-12), `README.md` (staff link, `STAFF_PAGE_KEY`, print at 100 %), `docs/STACK_NOTES.md` only if a gotcha was hit.

- [ ] **Step 1: Write** `tests/e2e/staff.spec.ts`: `/staff/wrong-key` → 404 status; `/staff/e2e-staff-key-e2e-staff-key-1234` → add `tests/fixtures/padded-400x400.png` and `tests/fixtures/opaque-300x300.jpg`, type sizes 5 and 4 cm, download, load the PDF with pdf-lib in the test → 2 pages, each page has the `sk_marks` marked-content block (the BDC property name maps to the OCG named `sk_marks`).
- [ ] **Step 2: Run** `pnpm e2e` (ports 3000/3199 free first) — PASS on both projects; the existing specs too.
- [ ] **Step 3: Docs.** **Step 4: Gate** `CI=1 pnpm check` and `pnpm build`. **Step 5: Commit** `git commit -m "Staff page e2e test; docs for the cutter dots and the staff page"`
