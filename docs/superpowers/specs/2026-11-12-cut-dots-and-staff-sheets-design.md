# Cut dots on every sheet, and a hidden staff page that builds print sheets

Date: 2026-11-12. Status: draft for the owner's approval (owner answers D1 to D7 included; builder check done).

## 1. Why

The shop cuts stickers on a cutting plotter with a camera. **The machine reads only the printed paper** (owner, D6): its camera finds the sheet by **4 black dots**, one in each corner, and finds the cut shapes from what is printed. No cut file is sent. So what matters is what lands on paper: the dots, white space around them, and every sticker printed in its real shape with white between stickers. Today the dots are added by hand in CorelDRAW (`example.pdf` in the repo root is such a hand-made sheet: print-ready and cut-ready). The owner wants:

1. A **separate, hidden page for employees**. They upload sticker designs (from WhatsApp customers, or the shop's own designs), type a size for each file, and the app arranges each design on an A4 sheet with the same rules as the website, **plus the 4 dots**, and gives a PDF ready to print and cut.
2. **The same dots on customer orders from the website**, so a customer order PDF also goes straight to the printer and the cutter.
3. Stickers may now go **up to 3 mm from the paper edge** (today the margin is a setting: 7 mm by default, 4 mm on the live site), but **never near the dots**. Correction (final review, 2026-11-12): against the live site (4 mm, no dots) the dots cost stickers on many sizes, so **fewer stickers fit on about 30 % of sizes and a customer may pay for more sheets**. See section 8a; the owner approves that table before the deploy.

Success: an employee drops in 5 files, types 5 sizes, presses one button and gets 5 PDF files (one per design) that print and cut without opening CorelDRAW. A customer order PDF arriving on Telegram or in the admin is the same: print, cut, done.

## 2. Owner decisions (2026-11-12, in their words or chosen options)

| # | Question | Answer |
|---|---|---|
| D1 | One design per sheet, or mix designs on one sheet? | **One design per sheet** (like `example.pdf`). ~~One PDF, one page per design.~~ **Changed by the owner, 2026-11-12: every design is its own PDF file** (one A4 page each); see B2 and B4. |
| D2 | How close may stickers go to the edge? | "The 7 mm is constant for the black dots, but the designs can go up to **3 mm** from the edges." |
| D3 | Who can open the staff page? | **Secret link, no password.** |
| D4 | Dots on customer orders too? | **Yes, all shapes** (circle, rectangle, custom): dots + up to 3 mm from the edge, never near the dots. |
| D5 | White space around each dot | **3 mm** from the edge of the dot. |
| D6 | How does the cutter get the cut lines? | **"The machine reads the paper only."** |
| D7 | Test PDF on the plotter before building? | **No, build directly**, copying `example.pdf` as closely as possible (same dots layer, same way of drawing); test on the plotter at the end. |

## 3. Goals, non-goals, anti-goals

Goals
- Every sheet PDF (customer orders and staff page) carries the 4 dots.
- One layout rule for both: margin 3 mm, gaps per shape as today, dots kept clear.
- Staff page: many files in, one PDF file per design out, nothing uploaded to the server.

Non-goals
- Mixing different designs on one sheet (D1 said no; can come later).
- Quantities or number of sheets on the staff page (the employee prints each page as many times as needed).
- Cut-contour paths in the PDF. The machine reads the printed paper (D6). No cut lines, as today. (`docs/PLAN.md` Q3 still says the shop draws cut lines in the plotter software; that is out of date and gets corrected.)
- Re-generating PDFs of orders saved before this change.
- A password or accounts for employees (D3).

Anti-goals (would be a failure even if it "works")
- A sticker printed on or within 3 mm of a dot: the camera may misread the sheet and every cut is off.
- Dots in the wrong place or size: the plotter's dot template is 5 mm at 7 mm; a dot at 6.8 mm or 4.8 mm wide may be rejected. This includes a sheet shrunk by "fit to page" when printing (about 3 to 5 % smaller).
- A sticker printed in a different shape from the one ordered: the camera cuts what it sees.
- The website preview, the price and the printed PDF disagreeing about how many stickers fit.
- The secret link showing up anywhere: in analytics, in the admin stats, in robots.txt, in the sitemap, or in a Referer header.
- The staff page sending design files to the server, or changing customer data.

## 4. Measured from `example.pdf`

- Page: A4, 595.2756 × 841.8898 pt, one page (made in CorelDRAW 2024).
- **Dots**: 4 filled circles, **diameter 5.000 mm**, **centre 7.0 mm from both edges** in each corner (measured 6.97 / 7.00 / 7.03 mm, Corel rounding). Colour: CMYK **0 0 0 100** (pure K black; the file uses an ICC-based CMYK space, overprint off). All 4 are one path (4 Bezier quarters each), filled with `f*`, inside an optional-content layer named **`sk_marks`** (the stickers are in a layer "Layer 1"). The layer name probably comes from a plotter plug-in.
- Stickers: 15 circles of 5.8 cm, 3 columns × 5 rows, 2 mm between columns, rows touching, block centred: columns start at x = 15.97 mm, the top row at 3.5 mm from the top edge. Artwork is a square PNG with transparent corners, one image per cell.

The new rule (section 5) must reproduce this sheet from "circle, 5.8 cm, margin 3 mm": columns at x = 16, 76, 136 mm, rows at y = 3.5 + 58·k mm, 15 stickers. This is the acceptance example.

## 5. Part A: the dots and the 3 mm edge (shared by the website and the staff page)

### A1. Dot constants

One home (my call: `src/lib/layout/marks.ts`, pure, isomorphic), not an admin setting, because the owner called the 7 mm "constant" and the plotter template is fixed:

- `offsetUm = 7_000`: dot centre from each of the two nearest page edges.
- `diameterUm = 5_000`.
- `clearanceUm = 3_000`: no printed part of a sticker within 3 mm of the dot's edge, so the keep-out is a disc of radius 2.5 + 3 = **5.5 mm** around each dot centre (it reaches 12.5 mm from the edges).
- Colour in the PDF: DeviceCMYK 0 0 0 1. In the on-screen preview: solid black.
- Centres, in this order: top-left (7, 7), top-right (203, 7), bottom-left (7, 290), bottom-right (203, 290) mm.

### A2. Layout rule

`LayoutParams` gets an **optional** `marks` field (`{ offsetUm, diameterUm, clearanceUm }`). When it is absent the engine behaves exactly as today, byte for byte. That keeps every case in `src/lib/__fixtures__/layout-cases.json` unchanged. `layoutParamsFor()` always adds the constants, so the website and the staff page always get dots.

**When is a sticker "near a dot"?** When its printed shape comes closer than `diameter/2 + clearance` (5.5 mm) to a dot centre:
- clip `circle` → the printed shape is the circle inscribed in the cell (the PDF clips the art to it): near when `distance(cell centre, dot centre) < cellRadius + 5.5 mm`;
- anything else (rounded rect, sharp rect, custom) → the whole cell rectangle (rounded corners and custom transparency are not clipped in the PDF; the art can reach the cell corner): near when `distance(rectangle, dot centre) < 5.5 mm`.
- Integer µm arithmetic only (compare squared distances); exactly 5.5 mm is allowed (not near).

**Search** (pure, deterministic; the browser and the server run the same code, so the preview, the price and the PDF agree):
1. Candidate area 1: the usable area = page minus margin (with 3 mm: 204 × 291 mm).
2. In an area, each arrangement today's engine would consider (upright grid; rotated grid and mixed layout when rotation is allowed, with today's rules for each) is built, then every placement near a dot is removed, and **the area's winner is chosen on the count after removal**. Ties: fewer removed placements, then today's order of preference (upright, rotated, mixed). (The builder check found sizes, such as a sharp 21 × 39 mm rectangle with rotation on, where choosing before removal loses 1 or 2 stickers.)
3. **Only when at least one of area 1's arrangements (upright, rotated or mixed, not only the winner) had a placement near a dot**, also run step 2 on:
   - candidate area 2: the left and right edges moved in to clear the dots (x from max(margin, 12.5 mm) to 210 mm − that; y as the usable area);
   - candidate area 3: the top and bottom moved in instead.
4. Keep the area with the most placements. Ties: fewer removed placements, then the lower area number.

Step 3 was widened on 2026-11-12 after the Task 3 review: with "only when the winner removed one", area 1 could pick a plain grid that never touches a dot and hide a better inset arrangement, so going from 7 mm to 3 mm lowered the count for common sizes (sharp 7 × 10 cm with rotation on: 6 → 4). When no arrangement in area 1 touches a dot, areas 2 and 3 (which lie inside area 1) cannot do better, so the common case is still as fast as before. A unit test pins that, for every golden size, the rule as implemented fits at least as many stickers at 3 mm as at 7 mm, with rotation on and off. It is a regression check of the rule as built, not a general theorem.

Step 3's rule is a fixed rule, not a theorem: the mixed packer's search limits depend on the area, so nothing may assert in general that a smaller area never fits more; the 3-vs-7 test above checks only the golden sizes. It keeps the common case as fast as today: rotation is ON on the live site, so the mixed-orientation packer runs, and the browser recomputes while the customer types.

**Speed of `maxWidthFor()`**: it keeps its meaning (the largest width that fits at least once, now respecting the dots), but stepping down 1 µm at a time from an estimate that ignores the dots can mean about 13 000 layout runs (builder check: aspect 0.70 walks from 204 to about 190.7 mm). It must give the same answer as that definition with a bounded number of runs (fitting once is monotone in the width, so a binary search works).

**Result fields** (`LayoutResult`, all additions optional so stored orders keep their shape):
- `marks?: { diameterUm: number; centres: { xUm: number; yUm: number }[] }`: present whenever the params had `marks`; the PDF and the preview draw from it.
- `removedNearMarks?: number`: how many grid cells were dropped (0 or absent = none). Diagnostic only.
- `usable` keeps meaning "page minus margin" for every candidate. `block` is the bounding box of the chosen arrangement before removal. `cols`, `rows` are its main grid's (as today for mixed layouts, the admin order page may then show "4 columns × 5 rows" next to "16 per sheet"; accepted, no copy change). `countPerSheet === placements.length` and `turnedCount` = turned placements, **both counted after removal**.
- Placements keep their order (row-major; mixed layouts sorted by y then x, as today).

**Failures**: unchanged reasons. A spec whose every candidate ends with 0 placements is `too_big_for_page`. `maxWidthFor()` keeps calling `computeLayout()`, so the largest allowed size automatically respects the dots (a single sticker can be the full width 204 mm if it stays between the dot zones in height, 272 mm, or the full height 291 mm if it is at most 185 mm wide).

**Acceptance**: section 4's example (15 circles at the measured positions); a sharp 5.1 × 5.8 cm rectangle at 3 mm margin without rotation, where area 1 is 4 × 5 = 20 minus the 4 corner cells = 16, area 2 is 3 × 5 = 15, area 3 is 4 × 4 = 16 with nothing removed, so area 3 wins (16, no holes); and a property test over many random sizes, shapes and margins: no placement inside the margin, none near a dot, none overlapping another, gaps kept.

### A3. PDF

- `src/lib/pdf/build-sheet.ts` keeps its API and its "artwork embedded once, drawn N times" structure. Still no text, no cut lines.
- **Dots, copied from `example.pdf` (D7):** after the stickers, when `layout.marks` is present, the 4 dots are drawn as one path (4 closed circles of 4 Bezier quarters each), filled with `f*` in DeviceCMYK 0 0 0 1, inside an optional-content layer named `sk_marks` (`/OC … BDC … EMC`, the layer listed in the document's `/OCProperties`, visible and printable). Plain DeviceCMYK instead of the example's ICC-based CMYK: the same ink (K only) without embedding a 380 KB profile in every file. The stickers do not need a layer.
- **Rounded rectangles are now printed rounded** (my call, follows from D6: the camera cuts what is printed). The PDF clips each rounded-rectangle cell to the rounded rectangle with the radius from the layout (today rounding is "preview only" and the PDF prints square corners, which the camera would cut square). Circle and custom are unchanged (circle is already clipped; custom follows the design's transparency). Sharp rectangles are unchanged.
- **Print at actual size:** the document asks viewers not to scale when printing (`/ViewerPreferences << /PrintScaling /None >>`). "Fit to page" would shrink the dots off the plotter's template. The staff page also shows a one-line reminder to print at 100 % (the shop README already says so).
- `report.drawCount` keeps counting artwork draws only (dots are paths, not XObjects): `drawCount === countPerSheet` still holds.
- The drawing code that the staff page also needs (one sheet page: stickers + dots) moves to an isomorphic module without `server-only` (my call: `src/lib/pdf/sheet-page.ts`). `build-sheet.ts` stays `server-only` and calls it.
- **Intended changes in a customer PDF, and nothing else:** the dots (with their layer), the rounded-corner clip for rounded rectangles, the print-scaling entry, and the new positions/counts from the 3 mm margin. The golden PDF diff is read with that list.

### A4. Website preview and copy

- `SheetPreview` draws the 4 dots in black when `layout.marks` is present, and the margin line at the new margin. The /how-it-works page draws its own picture (`src/app/how-it-works/SheetIllustration.tsx`); it gets the dots too.
- One new short line under the preview and on /how-it-works (owner may reword; my wording): «النقاط السودة بالزوايا علامات لمكينة القص، ما تطلع على الستيكر.» ("The black dots in the corners are marks for the cutting machine; they don't end up on your sticker.")
- Existing texts already read the margin from the settings («الهامش {margin} ملم من كل جهة»), so they show 3 mm with no change.

### A5. Settings

- `DEFAULT_SETTINGS.layout.marginUm`: 7 000 → **3 000** (local `data/settings.json` already has 3 000).
- The live settings row has `marginUm: 4000`. A new migration sets it to 3 000, applied **after** the code deploy. Before it, live orders use 4 mm plus dots, which is also safe.
- The margin stays editable in /admin/settings as today. No new settings.
- **Sharp rectangles touch** (gap 0 mm, setting `rectSharpGapUm`). If the camera must see each one separately it needs a white gap; the owner changes it in /admin/settings if the plotter test shows a problem. No code change planned.

## 6. Part B: the staff page

### B1. Access: the secret link (D3)

- URL: `/staff/<key>`. The key comes from a new environment variable `STAFF_PAGE_KEY` (at least 24 characters). Missing, too short or wrong key: the normal 404 page. The comparison is constant-time.
- Not in the sitemap, not in robots.txt (that would advertise it), `noindex, nofollow`, `Referrer-Policy: no-referrer`.
- The visit tracker and `/api/track` ignore `/staff` like `/admin`, so the key never reaches analytics or the admin stats. The install prompt is hidden there too.
- The admin settings page shows the full staff link (only when the key is set) so the owner can copy it and send it to employees. To change the link: change the variable on Vercel and redeploy.
- The owner sets `STAFF_PAGE_KEY` on Vercel once (production), before the deploy. Locally it goes in `.env.local`; `.env.example` lists it.

### B2. What the employee sees (Arabic, RTL, phone and desktop)

1. A title and a file picker / drop area: several PNG, JPG or PDF files at once. Limits (my calls): up to 30 files, 50 MB each, nothing leaves the browser.
2. One card per file: a thumbnail, the file name, the **shape** (the 4 shapes of the website: circle, rectangle with rounded corners, rectangle with sharp corners, custom; default circle), and the **size in cm** with the same input rules as the website (aspect locked: type width or height and the other follows; a circle has one field, the diameter; a PDF prefills its size from its page box). Custom shape needs a transparent PNG, as on the website.
3. Under each card: a small sheet preview (the website's `SheetPreview`, with the dots), "N stickers per sheet", and the website's messages for too small, too big, ratio too extreme, and low resolution. Low resolution is a **warning only** on this page (my call: employees decide), not a block.
4. A remove button per card, and one main button «نزّل ملفات PDF» that is enabled when every card is valid. **Owner change, 2026-11-12 (replaces D1's "one PDF, one page per design"): every design is its own PDF file.** The button downloads the files in card order, one after another (each is prepared, built and saved before the next starts, about 400 ms apart because Chrome can drop quick downloads). Each file has one A4 page, the same drawing and dots. A design that fails is reported (with the website's messages) and the others still download. With 2 or more cards a hint says to choose «Allow» if the browser asks about several downloads. Each ready card also has a small download button for just that design (a fallback when the browser blocked a file or one design changed). File name: `<design file name without extension>-<size>.pdf`, e.g. `logo-5.8cm.pdf` for a circle (diameter) and `logo-5x3cm.pdf` for other shapes (width x height, the size fields' number format, dot as decimal point); characters Windows forbids are removed, spaces and dots at the ends trimmed, the base name capped at 80 characters, `design` if nothing is left; two cards with the same name get `-2`, `-3` before `.pdf`.

The layout rules are the website's, read from the live settings when the page loads: margin, gaps per shape, rotation on/off, minimum side, rounded radius, plus the dots.

### B3. Preparing the artwork in the browser

Same result as the server's `normaliseArtwork`, done in the browser (no sharp):
- PNG/JPEG: decode with EXIF rotation applied; for custom shape, crop to the transparent-trim box (same alpha threshold as the server); scale down to 300 DPI at the chosen size when the file has more pixels than that (never scale up); re-encode as PNG when it has transparency, otherwise JPEG at quality 0.92.
- PDF: page 1 embedded as vector, box = TrimBox, else CropBox (else MediaBox), the page's /Rotate applied, exactly as the server does. Share the box/rotate logic between the server and the browser rather than copying it. Encrypted PDFs get the website's message.
- Reuse `decodeDesign()` for the preview, the aspect ratio and the PDF size; reuse `pixels.ts` for the alpha trim.

### B4. The PDF

Built in the browser with pdf-lib (dynamic import, only on this page), using the shared page drawer from A3: one PDF per design (`buildStaffPdf([item], now)` called once per file), each with one A4 page, artwork embedded once, drawn N times, then the dots. Metadata: title `Softy sheets`, producer and creator `Softy Printing`, no customer data.

### B5. Code layout (builder may adjust)

- `src/app/staff/[key]/page.tsx` (server: key check, settings, metadata) and a client component under `src/components/staff/`.
- Copy in a new `src/content/ar/staff.ts`, exported from `@/content/ar`. Every rule of CLAUDE.md applies (copy from content files, `<Ltr>`, plurals, logical RTL utilities).
- No new dependency: pdf-lib, pdfjs and the decoders are already there.

## 7. Tests and the golden snapshots

- New unit tests: the near-dot test, the candidate areas and tie-breaks (including "choose after removal"), the fast path, `turnedCount` after removal, the `example.pdf` reproduction, the property test (A2), and `maxWidthFor()` returning the same width as the 1 µm walk with a bounded number of runs; dots in the PDF (position, size, colour, `f*`, the `sk_marks` layer, `drawCount` unchanged), the rounded-corner clip, and the print-scaling entry (A3); staff page key check (404 cases), analytics and tracker ignoring `/staff`, the browser artwork preparation, and the PDF (one page per design, dots on each; the page flow builds one file per design).
- One Playwright test: open `/staff/<test key>`, add two files, set sizes, download, check that two files arrive, each with 1 page and the dots, with the expected names; a wrong key gives 404.
- Golden snapshots that are **expected** to change because the owner asked (update one file at a time and read every line of the diff; any change not explained by "dots added, margin 3 mm, counts per sheet changed, new strings" is a bug): layout, builder logic, design/PDF hashes, settings/schemas, copy, page metadata if the staff page adds an entry, routes (counts and prices in order answers), order text if it prints counts. `src/lib/__fixtures__/layout-cases.json` must **not** change; new mark cases go in a new fixture file.
- `CI=1 pnpm check` and `pnpm build` green before the deploy.

## 8a. Price impact: owner approval needed before the deploy

The price is per sheet, and sheets = stickers ÷ stickers per sheet, rounded up. So when fewer stickers fit on a sheet, the same order needs more sheets and costs more. The 3 mm margin wins space, but the 4 dots and the white space around them (each dot keeps stickers 12.5 mm away from both edges in its corner) take more than that on most sizes. This is the cost of putting the dots on every customer sheet (D4), not a coding mistake.

Stickers per A4 sheet, live settings (rotation on, gaps as today):

| Size | Live today (4 mm, no dots) | After the deploy (4 mm + dots) | After the migration (3 mm + dots) |
|---|---|---|---|
| Circle 2 cm | 126 | 122 | 122 |
| Circle 5.8 cm | 12 | 12 | **15** |
| Rounded or custom 3 × 3 cm | 54 | 50 | 50 |
| Sharp 4 × 4 cm | 35 | 31 | 31 |
| Rounded or custom 5 × 3 cm | 34 | 32 | 32 |
| Sharp 5 × 3 cm | 37 | 36 | 36 |
| Rounded or custom 6 × 4 cm | 20 | 19 | 20 |
| Sharp 6 × 4 cm | 23 | 21 | 21 |
| Any rectangle or custom 8.5 × 5.5 cm | 11 | 10 | 10 |
| Rounded or custom 9 × 5 cm | 11 | 10 | 10 |
| Sharp 10 × 4 cm | 14 | 13 | 13 |
| Any rectangle or custom 7 × 10 cm | **8** | **6** | **6** |

Example: 48 stickers of 7 × 10 cm are 6 sheets today and 8 sheets after the change (33 % more sheets, so about 33 % more money before discounts and rounding).

Over every shape and every size from 1 to 20 cm in 0.5 cm steps (4 602 cases): **1 385 fit fewer** (30 %), 106 fit more, 3 111 stay the same. Only some circles gain (5.8 cm: 12 → 15, the `example.pdf` sheet).

The unit test "pins the per-sheet counts against the live site" in `src/lib/layout/marks.test.ts` keeps these numbers fixed, so any later change to the layout engine that moves them shows up.

**Owner decision needed before the deploy (rollout step 0):** accept this price impact, or choose another way (for example: dots only on the staff page, or a lower price per sheet). If the owner does not accept, do not deploy; the engine is not changed until the owner decides.

## 8. Rollout

0. **Owner reads section 8a and accepts the price impact** (or decides otherwise). No deploy before that.
1. Owner adds `STAFF_PAGE_KEY` on Vercel (I give the exact command).
2. Owner deploys (`! vercel deploy --prod --yes`), as usual.
3. Apply the margin migration (3 mm) to live; smoke check: a 5.8 cm circle on the live site shows 15 per sheet with dots; one test order PDF has the dots; `/staff/<key>` works, `/staff/wrong` is 404, the stats show no `/staff` path.
4. Print one staff sheet and one customer sheet at 100 % and run them through the plotter before telling employees: one circle sheet, one rounded-rectangle sheet (corners cut round?), one custom-shape sheet, and one sharp-rectangle sheet (can the camera separate touching rectangles?).

Customers in the middle of an order at the moment of the deploy may see the count per sheet change when they press send (the server recomputes, as with any settings change). Accepted.

## 9. Left to the builder

File names and splitting inside the modules named above; the exact card UI with the existing shadcn components; how candidates are computed internally (as long as A2's result and tie-break rules hold); how `maxWidthFor()` is made fast; test file placement per `docs/ARCHITECTURE.md` section 7; updating `docs/ARCHITECTURE.md` (route map, staff page, env var, dots) and `docs/PLAN.md` §2 and §4 (margin 3 mm, dots instead of "no marks", rounded corners printed, the machine reads the paper instead of "the shop draws cut lines in the plotter software").

## 10. My calls (owner, please check)

- Rounded rectangles are printed with rounded corners (until now only the screen showed them rounded). Needed because the machine cuts what it sees on paper.
- Every PDF asks the printer not to shrink it ("actual size").
- Dot size, place and clearance are fixed in code, not admin settings.
- For circle stickers, "near a dot" uses the circle itself, not its square box, so circles can go closer to the corners.
- Default shape on the staff page: circle. Low resolution there is a warning, not a block. Limits 30 files, 50 MB each.
- The staff link is shown in /admin/settings; it changes only through the Vercel variable.
- The new customer line about the dots (A4) and its wording.
- The default margin becomes 3 mm everywhere, and the live 4 mm becomes 3 mm by migration after the deploy.
