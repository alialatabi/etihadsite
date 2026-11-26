# Receipts tab: editable spacing per file — design

Date: 2026-11-26. Owner request (Arabic): «في تبويبة تسفيط تصاميم الوصولات خلي للمستخدم امكانية تعديل
المسافات بين التصاميم والمسافات من الاربع جهات، وهذا الشي يكون مخصص لكل ملف ينرفع للتسفيط».

Owner answers (2026-11-26, all the recommended options):
- A6 gets TWO gaps: between the columns and between the rows.
- Changing a card's format resets its spacing to the new format's defaults.
- The A6 «فوق / تحت» white buttons stay; switching the white swaps the top and bottom margins.

Builds on the receipts tab (spec `2026-11-26-staff-original-art-and-receipts.md`, Part B). Branch
`feat/receipt-spacing` from `layout-packing-and-hosting` @ 49e5900 (= what is live). Integer µm,
page origin TOP-LEFT, A4 portrait 210000 × 297000 (`A4_UM`).

## 1. Model (`src/lib/receipts/formats.ts`, pure)

```ts
export interface ReceiptSpacing {
  topUm: number; rightUm: number; bottomUm: number; leftUm: number; // physical page sides
  gapXUm: number; // between columns (only used when cols > 1: A6)
  gapYUm: number; // between rows    (only used when rows > 1: A5, DL, A6)
}
export const RECEIPT_GRID: Record<ReceiptFormat, { cols: number; rows: number }> =
  { a4: {cols:1,rows:1}, a5: {cols:1,rows:2}, dl: {cols:1,rows:3}, a6: {cols:2,rows:2} };
export const MAX_SPACING_UM = 100_000;  // each value 0..100 mm
export const MIN_SLOT_UM = 20_000;      // a slot narrower or shorter than 20 mm = "no room"
export function defaultSpacing(format, white: ReceiptWhite = 'top'): ReceiptSpacing
export function receiptSlots(format, spacing: ReceiptSpacing): ReceiptSlot[]   // reading order
export function spacingFits(format, spacing): boolean  // every value an integer in 0..MAX and slot ≥ MIN both ways
export function swapWhiteSpacing(s): ReceiptSpacing     // top ↔ bottom
```

Defaults (MUST reproduce today's live table exactly — the existing pinned numbers in
`tests/unit/receipts/formats.test.ts` stay and become the regression check):

| format | top | right | bottom | left | gapX | gapY |
|---|---|---|---|---|---|---|
| a4 | 12000 | 0 | 0 | 0 | 0 | 0 |
| a5 | 0 | 0 | 0 | 15000 | 0 | 8000 |
| dl | 0 | 0 | 0 | 15000 | 0 | 8000 |
| a6 white top | 7000 | 0 | 0 | 0 | 7220 | 7360 |
| a6 white bottom | 0 | 0 | 7000 | 0 | 7220 | 7360 |

Slot rule, per axis (n cells, start margin m0, end margin m1, gap g, page length P):
`avail = P − m0 − m1 − (n−1)·g`; `cell = floor(avail / n)`; `left = avail − n·cell` (0 ≤ left < n);
the first `left` gaps get +1 µm each; cell i starts at `m0 + i·cell + i·g + min(i, left)`.
With n = 1 the leftover stays at the end. Check: DL → y 0 / 101667 / 203334, h 93666 (today's
numbers); A6 → x 0 / 108610, w 101390; y 7000 / 155680 (or 0 / 148680), h 141320; A5 → y 0 / 152500,
h 144500; A4 → y 12000, h 285000, w 210000. Gaps that do not apply to a format (gapX for 1 column,
gapY for 1 row) are ignored by `receiptSlots` but kept in the object.

`RECEIPT_FORMATS[f].widthUm/heightUm` stay = the DEFAULT slot size (derive them from
`receiptSlots(f, defaultSpacing(f))[0]` or keep the literals; a test asserts they agree).
`slotIsLandscape` / `autoTurn` keep using the default slot (spacing is always the default when
they run: on decode and on a format change).

## 2. Card state and reducer (`src/components/staff/receipts/receipt-logic.ts`)

- `ReceiptCardState.spacing: ReceiptSpacing` (committed, valid values only) and
  `spacingDraft: Partial<Record<keyof ReceiptSpacing, string>>` is NOT needed in the reducer if the
  inputs keep their own text — choose one approach, but: **text that does not parse must block the
  download** (the card is not valid while any field's text is invalid), never silently print the
  previous number. Simplest: keep per-field text in the card state (`spacingText`), parse on every
  change; `cardView` reports a `spacing` problem when any field is invalid or `!spacingFits`.
- New actions: `{ type: 'spacing'; id; key: keyof ReceiptSpacing; text: string }` and
  `{ type: 'spacingReset'; id }` (→ `defaultSpacing(format, white)`).
- Where spacing changes, and ONLY there:
  1. `add` → `defaultSpacing('a4')`.
  2. `decoded` → `defaultSpacing(format, white)` after the auto rules — BUT the spacing inputs are
     disabled until the card is `ready`, so nothing can be lost.
  3. `format` with a DIFFERENT format → `defaultSpacing(newFormat, newWhite)`. Re-picking the
     same format changes nothing (keeps spacing and turn).
  4. A6 white change (the `white` action, or the `turn` action changing `white`) → swap top/bottom
     (`swapWhiteSpacing`), ONLY when `format === 'a6'` and the white really changed. The `turn` action
     on a4/a5/dl must not move any margin (today `turn` sets `white` for every format: keep that
     harmless field update but never swap for non-A6).
  5. `spacing` / `spacingReset` actions.
  Spacing changes never re-run `autoTurn`.
- `designSpec(...)` must use the card's real slot (`receiptSlots(format, spacing)[0]`), turned —
  DPI and `prepareOriginalArtwork`'s spec follow the edited slot.
- `buildReceiptFile` passes the spacing to the PDF builder.
- Invalid/no-room spacing: `cardView` → `problem: { kind: 'spacing', reason: 'invalid' | 'noRoom' }`,
  `valid: false` (download blocked). Existing `{ kind: 'decode' }` stays.

## 3. Parsing millimetres (`src/lib/parse/mm.ts`, new, pure, next to `cm.ts`)

`parseMm(input): number | null` → integer µm, accepts what `parseCm` accepts (Arabic-Indic and
Persian digits via `normaliseDigits`, decimal `.` `,` `٫`, surrounding spaces, an optional trailing
`ملم`/`مم`/`mm`) but ZERO IS ALLOWED (`"0"` → 0); negative / empty / garbage → null; rounds to the
µm. `formatMm(um)` → up to 2 decimals, Western digits ("7.22", "15", "0"). Reuse `normaliseDigits`
and `mmToUm`/`UM_PER_MM` from `src/lib/units.ts`; do not duplicate cm.ts logic beyond what differs
(a shared private helper is fine). Unit tests next to the existing parse tests.

## 4. PDF (`src/lib/pdf/build-receipt-pdf.ts`)

Input becomes `{ format, spacing, turnCw, artwork }` (drop `white`; spacing already encodes it).
`receiptSlots(format, spacing)`. Everything else unchanged (embed once, stretch matrix, clip rect).
Throw if `!spacingFits` (the UI never sends that).

## 5. UI (`ReceiptCard.tsx`)

A section «المسافات (ملم)» under the turn/white row, shown once the card has a design:
- Four number fields: «فوق», «تحت», «يمين», «يسار» (PHYSICAL sides of the paper — say so in the
  labels' order/layout; arrange as a small 2×2 grid). Inputs `inputMode="decimal"`, `dir="ltr"`
  value, `className` h-11, Western-digit display via `formatMm`.
- Gap fields: a5/dl → one «بين التصاميم» (gapY); a6 → «بين الأعمدة» (gapX) and «بين الصفوف» (gapY);
  a4 → none.
- «رجّع المسافات الافتراضية» button (outline, h-11).
- Messages: invalid text → «اكتب رقم من 0 إلى 100 ملم.» on that field (aria-invalid,
  aria-describedby); no room → «المسافات كبيرة وما يبقى مكان كافي للتصميم. صغّر المسافات.» in the
  card's message area (role alert).
- A6 hint (small muted text): «بالـ A6 المسافة بين الصفوف هي بياض الصف الثاني.»
- Disabled while `!card.design` / decoding and while a download is running (`busy`).
- `SheetSketch` draws `receiptSlots(format, spacing)` — the preview follows every edit.
- All strings in `src/content/ar/staff.ts` under `receipts.spacing.*`; numbers via `<Ltr>` / `fillLtr`;
  logical Tailwind utilities only (`pnpm lint:rtl`). Update
  `tests/unit/golden/__snapshots__/copy.golden.test.ts.snap` with ADDITIONS ONLY.
- `StaffReceipts.tsx` / `useReceiptItems.ts`: wire the two new actions (memoised callbacks, same
  pattern as `onWhite`).

## 6. Tests (vitest, node)

- formats: today's pinned numbers unchanged with `defaultSpacing`; custom spacing cases (A5 with
  left 10 / gap 5; A6 with gapX 0, gapY 0; DL with top/bottom 5); every slot inside the page, no
  overlaps, equal sizes; leftover distribution; `spacingFits` false below 20 mm and for values
  > 100 mm / negative / non-integer; `RECEIPT_FORMATS` agrees with the default slots.
- parse mm: "0", "7,5", "٧٫٢٢", "15 ملم", "", "-1", "abc", "1e2".
- reducer: format change resets; same format keeps edits; A6 white swaps top/bottom; turn on A6
  swaps when white flips; turn on a4 keeps top 12 mm; spacing edit never changes turn; invalid text →
  card not valid; reset restores defaults.
- PDF operator dump with custom spacing (pattern of `tests/unit/receipts/build-receipt-pdf.test.ts`):
  clip rects equal `receiptSlots(format, spacing)` within 0.01 mm.
- `CI=1 pnpm check` green; `pnpm build` OK.

## 7. Out of scope
Applying one card's spacing to all cards; saving spacing between visits; per-receipt spacing
inside one sheet.
