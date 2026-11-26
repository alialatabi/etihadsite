# Staff page: original-quality export + receipts (الوصولات) tab — design

Date: 2026-11-26. Owner request (Arabic, paraphrased):
1. The staff sticker export must use the **highest resolution** and the **original colours** of the uploaded file.
2. A second tab on the staff page imposes **receipt books (وصولات)** on standard A4 (210 × 297 mm).

Owner answers (2026-11-26): use the sizes the owner WROTE (not the hand-made samples); designs
**stretch to fill** their place (no proportion keeping); A6 uses ONE rule (sample «A6 نموذج 2»,
mirrored when the white goes to the bottom). Samples: `D:\etihadsite\نماذج وصولات\*.pdf`
(untracked, ~105 MB — never commit, never upload).

All numbers below are integer micrometres (µm), page origin TOP-LEFT, A4 portrait, unless stated.

---

## Part A — original artwork on the staff page (sticker tab and receipt tab)

### A1. Why the current export loses quality
`staff-logic.buildStaffFile` calls `prepareArtwork(design, spec, PRINT_DPI)`
(`src/lib/design/prepare.client.ts`). Every PNG/JPEG goes through a canvas: resampled DOWN to
1200 dpi, re-encoded (JPEG q 0.92, or PNG), and always sRGB (a CMYK JPEG is converted to RGB by
the browser, so printed colours change). PDFs are already embedded as vector (kept as is).

### A2. New staff-only preparation: `prepareOriginalArtwork(source, spec)`
File `src/lib/design/original.client.ts` (`'use client'`), same `PrepareOutcome` type as
`prepareArtwork`. The website (server normaliser, customer PDFs) is NOT touched.

- **PDF** → unchanged: `prepareArtwork(source, spec, PRINT_DPI)` (original bytes, page 1 as vector;
  the raster fallback only for PDFs pdf-lib cannot load).
- **JPEG** (shape `custom` → `no_alpha`, as today). Read the file bytes and parse the header
  (A3). Use the **original bytes unchanged** when ALL hold:
  - SOF marker is 0xC0, 0xC1 or 0xC2 (baseline / extended / progressive Huffman), 8 bits;
  - components 1 (gray) or 3 (YCbCr/RGB), or 4 (CMYK/YCCK) **with** an Adobe APP14 marker
    (pdf-lib inverts CMYK with `/Decode [1 0 …]`, which is right for Adobe files only);
  - EXIF orientation is 1, 3, 6 or 8 (or absent = 1); mirrored 2/4/5/7 fall back;
  - the oriented size (stored size, swapped for 6/8) equals `source.pxWidth × source.pxHeight`.
  Artwork: `{ kind: 'raster', bytes: <original>, mime: 'image/jpeg', pxWidth/pxHeight: STORED
  (unrotated) size, hasAlpha: false, effectiveDpi: <oriented pixels over spec, as today>,
  rotate: 90|180|270 }` (`rotate` omitted when 0; 3 → 180, 6 → 90, 8 → 270, clockwise).
- **PNG**. Original bytes unchanged when: shape is not `custom` (or `source.trim` covers the whole
  image), no `eXIf` chunk, IHDR size equals the source size, and width × height ≤
  `MAX_CANVAS_PIXELS` (pdf-lib decodes PNGs in memory). pdf-lib re-compresses PNG pixels
  losslessly (Flate + SMask), so values are kept.
- **Fallback** (any condition fails, or custom-shape crop): `prepareArtwork(source, spec, dpi)`
  with a dpi high enough that nothing is downscaled:
  `dpi = max(PRINT_DPI, ceil(max(pxW / inches(spec.widthUm), pxH / inches(spec.heightUm))) + 1)`.
  The browser pixel-cap fallback inside prepareArtwork stays (phones).
- `staff-logic.buildStaffFile` uses `prepareOriginalArtwork` instead of `prepareArtwork(…, PRINT_DPI)`.
  Update the `PRINT_DPI` comment: it no longer applies to the staff page (owner 2026-11-26).

### A3. Header parsers (pure, isomorphic): `src/lib/design/image-header.ts`
- `readJpegInfo(bytes) → { width, height, components, bits, sof, adobe, orientation } | null`
  (walk markers from SOI to SOS; APP1 `Exif\0\0` → TIFF II/MM → IFD0 tag 0x0112; APP14 `Adobe`).
  Never throws; truncated/garbage → null.
- `readPngInfo(bytes) → { width, height, bitDepth, colorType, hasExif } | null`.
- `exifTurnCw(orientation) → 0 | 90 | 180 | 270 | null` (null for mirrored).

### A4. Contract + drawer change (the only change to shared drawing code)
- `src/lib/types.ts`: the raster variant of `NormalisedArtwork` gets an OPTIONAL
  `rotate?: 0 | 90 | 180 | 270` — clockwise turn applied when drawing (only the staff page sets it).
- `src/lib/pdf/sheet-page.ts` `embedArtwork`: raster returns `pageRotateCw: artwork.rotate ?? 0`.
  With `rotate` absent the output is byte-identical (golden tests must pass untouched).

### A5. Acceptance
- A CMYK JPEG embedded through the staff path: the PDF image XObject is `/DCTDecode`,
  `/DeviceCMYK`, same Width/Height, and its stream bytes equal the uploaded file.
- A 4000 px JPEG at 2 cm stays 4000 px (no 1200 dpi cap).
- EXIF-6 JPEG prints upright (the drawn box is turned 90° clockwise, stored bytes untouched).
- All existing golden tests pass with no snapshot change.

---

## Part B — receipts tab (الوصولات)

### B1. Slot table (owner's written sizes; A4 page 210000 × 297000)
| Format | Name shown | Per A4 | Slot w × h | Slot x | Slot y (from top) | White / binding |
|---|---|---|---|---|---|---|
| a4 | A4 21 × 28.5 | 1 | 210000 × 285000 | 0 | 12000 | 12 mm at TOP |
| a5 | A5 15 × 19.5 | 2 | 195000 × 144500 | 15000 | 0, 152500 | 15 mm LEFT, 8 mm between |
| dl | DL 19.5 × 10 | 3 | 195000 × 93666 | 15000 | 0, 101667, 203334 | 15 mm LEFT, ~8 mm between |
| a6 | A6 10 × 15 | 4 | 101390 × 141320 | 0, 108610 | white top: 7000, 155680 · white bottom: 0, 148680 | 7 mm per quarter at TOP or BOTTOM, 7.22 mm between columns |

Slot orientation: a4 portrait, a5 landscape, dl landscape, a6 portrait. The table lives in ONE
pure module `src/lib/receipts/formats.ts` (`RECEIPT_FORMATS`, `receiptSlots(format, white)`),
pinned by a unit test with these exact numbers (each slot inside the page, no overlaps).

### B2. Placement rules
- **Stretch to fill**: the (turned) design is scaled independently in x and y to fill its slot
  exactly. Each slot is clipped to its rectangle (`q <rect> W n <cm> /X Do Q`). No cutter dots,
  no 3 mm margin (receipts are cut by guillotine; the samples are edge to edge).
- **Auto turn**: the design's displayed orientation (after EXIF / PDF /Rotate) is compared with
  the slot's. If they differ the design is turned **90° counter-clockwise** (= 270° clockwise):
  its top edge goes to the page's left, as in the owner's A5 and A6-model-1 samples. Square
  counts as portrait. The employee can turn further with a button (+90° clockwise per press).
- **A6 white side**: auto = `top` when the turn is 0/180, `bottom` when 90/270; the employee can
  switch it (two buttons «فوق» / «تحت»). Changing the turn re-applies the auto value.
- **Format guess** on decode (the employee can change it): (1) file name contains a standalone
  `a4|a5|a6|dl` (case-insensitive, not inside a longer Latin word/number: `10 a5 mk …pdf` → a5);
  (2) else a PDF's physical page size (sides sorted) nearest to a nominal size (a4 210×285 and
  210×297, a5 150×195, a6 100×150, dl 100×195) within 15 %; (3) else aspect (long/short) nearest
  to a4 1.357 / a5 1.3 / a6 1.5 / dl 1.95; (4) else a4.
- PDF with more than one page: page 1 only (as stickers); the card shows a short note.
- Total drawing turn = artwork's own clockwise turn (`pageRotateCw` from `embedArtwork`: PDF
  /Rotate or JPEG EXIF) + the card's turn, mod 360. The on-screen preview uses the decoded
  preview image (already upright) turned by the card's turn only, so both agree.

### B3. Code
- `src/lib/receipts/formats.ts` — table, `receiptSlots`, `slotIsLandscape`, `autoTurn`,
  `autoWhite`, `guessReceiptFormat(fileName, design)`. Pure, client-safe, no imports beyond types/units.
- `src/lib/pdf/build-receipt-pdf.ts` — ISOMORPHIC like `build-staff-pdf.ts`:
  `buildReceiptPdf({ format, white, turnCw, artwork }, now)`: one A4 page, artwork embedded ONCE
  via `embedArtwork` (imported from sheet-page, unchanged), drawn once per slot; matrix per slot
  (y-up, slot rect x,y,w,h in pt, phi = total clockwise turn, bw×bh native size):
  `a=sx·cos, b=−sy·sin, c=sx·sin, d=sy·cos` with `sx = w/dispW, sy = h/dispH` (disp = native size
  swapped when phi is 90/270), `e = cx − (a·bw/2 + c·bh/2)`, `f = cy − (b·bw/2 + d·bh/2)`;
  images fold bw/bh into the matrix (`[a·bw, b·bw, c·bh, d·bh, e, f]`) like sheet-page.
  `setPrintAtActualSize`, title `Softy receipts`, producer/creator `PDF_PRODUCER`, dates = now.
- `src/components/staff/receipts/receipt-logic.ts` — React-free reducer
  (add / decoded / format / turn / white / remove), card view (dpi warning vs slot, problems),
  file names `<base>-A5.pdf` (dedupe `-2`), sequential download with `SAVE_GAP_MS`,
  `prepareOriginalArtwork(design, { shape: 'rect', corners: 'sharp', widthUm: slot w, heightUm: slot h })`.
  Shares the file-name sanitiser with staff-logic (extract `fileBaseName()` there; do not duplicate).
- `src/components/staff/receipts/useReceiptItems.ts`, `ReceiptCard.tsx`, `StaffReceipts.tsx` —
  same patterns as the sticker tab (one-at-a-time decode with `decodeDesign(file, { shape: 'rect',
  maxBytes: MAX_STAFF_FILE_BYTES })`, object-URL hygiene, max 30 files, drop zone). The card shows
  an SVG preview of the A4 sheet (`viewBox="0 0 210 297"`, white page, each slot with the preview
  image `preserveAspectRatio="none"` turned by the card's turn), the format picker, the turn
  button, the A6 white switch, remove and download-one buttons.
- Tabs: `src/components/staff/StaffTabs.tsx` (client) with `@base-ui/react/tabs`; tabs «الستيكرات»
  and «الوصولات»; both panels stay mounted (`keepMounted`) so switching never loses cards.
  `src/app/staff-sheets/page.tsx` renders the tabs; the gate (`isStaffKey`) is unchanged.
- Copy: new keys in `src/content/ar/staff.ts` (`tabs`, `receipts.*`), plural `receipt` in
  `common.plural` if a count needs it. Numbers/sizes through `fillLtr` / `<Ltr>`. Update only
  `tests/unit/golden/__snapshots__/copy.golden.test.ts.snap` for the new strings.

### B4. Acceptance
- Operator dump of a generated receipt PDF: one clip rect per slot equal to the table (±0.01 mm);
  the image/form drawn inside covers exactly that rect; image XObject identical to the source
  (Part A); a turned design maps its top edge to the page's left.
- `pnpm check` green with `CI=1`; `pnpm lint:rtl` passes; no hard-coded strings.
