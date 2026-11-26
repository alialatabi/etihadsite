/**
 * The receipts tab's state and rules, free of React so they can be tested in node: the card list
 * reducer (one card per picked file), what each card shows (`cardView`), the file names and the
 * download (`downloadReceiptFiles`: one PDF per design, in card order, one after another).
 * The slot table and the turn/white/format rules live in src/lib/receipts/formats.ts.
 */
import { dpiFor, dpiStatus } from '@/components/builder/logic';
import { MAX_STAFF_FILES, MAX_STAFF_FILE_BYTES, SAVE_GAP_MS, fileBaseName, type StaffDownloadOptions } from '@/components/staff/staff-logic';
import { prepareOriginalArtwork } from '@/lib/design/original.client';
import type { PrepareError } from '@/lib/design/prepare.client';
import { reportClientError } from '@/lib/monitoring/report.client';
import { formatMm, parseMm } from '@/lib/parse/mm';
import {
  MAX_SPACING_UM,
  RECEIPT_SPACING_KEYS,
  autoTurn,
  autoWhite,
  defaultSpacing,
  guessReceiptFormat,
  nextTurn,
  receiptSlots,
  spacingFits,
  swapWhiteSpacing,
  type ReceiptFormat,
  type ReceiptSpacing,
  type ReceiptSpacingKey,
  type ReceiptTurn,
  type ReceiptWhite,
} from '@/lib/receipts/formats';
import type { DesignDecodeError, DesignDecodeOutcome, DesignSource, QualitySettings, StickerSpec } from '@/lib/types';

export { MAX_STAFF_FILES as MAX_RECEIPT_FILES, MAX_STAFF_FILE_BYTES as MAX_RECEIPT_FILE_BYTES, SAVE_GAP_MS };

export interface ReceiptCardState {
  id: string;
  file: File;
  /** 'decoding' until decodeDesign answers; 'error' when it refused the file. */
  status: 'decoding' | 'ready' | 'error';
  design: DesignSource | null;
  error: DesignDecodeError | null;
  format: ReceiptFormat;
  /** The employee chose the format: the guess made when the file finishes decoding must not replace it. */
  formatPicked: boolean;
  /** Clockwise turn of the design inside its slot (the artwork's own EXIF / PDF turn comes on top at build time). */
  turn: ReceiptTurn;
  /** A6 only: where the white strip of each quarter is. */
  white: ReceiptWhite;
  /** The white around and between the receipts on the page: the last VALID numbers (what the preview and the PDF use). */
  spacing: ReceiptSpacing;
  /** What each spacing field shows. May hold text that is not a valid number: then the card cannot be printed. */
  spacingText: Record<ReceiptSpacingKey, string>;
}

export type ReceiptAction =
  | { type: 'add'; items: { id: string; file: File }[] }
  | { type: 'decoded'; id: string; outcome: DesignDecodeOutcome }
  | { type: 'format'; id: string; format: ReceiptFormat }
  | { type: 'turn'; id: string }
  | { type: 'white'; id: string; white: ReceiptWhite }
  | { type: 'spacing'; id: string; key: ReceiptSpacingKey; text: string }
  | { type: 'spacingReset'; id: string }
  | { type: 'remove'; id: string };

function update(state: ReceiptCardState[], id: string, fn: (c: ReceiptCardState) => ReceiptCardState): ReceiptCardState[] {
  const i = state.findIndex((c) => c.id === id);
  if (i < 0) return state;
  const next = fn(state[i]);
  if (next === state[i]) return state;
  const copy = state.slice();
  copy[i] = next; // every other card keeps its identity, so cached views stay valid
  return copy;
}

function textsOf(s: ReceiptSpacing): Record<ReceiptSpacingKey, string> {
  const t = {} as Record<ReceiptSpacingKey, string>;
  for (const k of RECEIPT_SPACING_KEYS) t[k] = formatMm(s[k]);
  return t;
}

/** The card with exactly these numbers committed and shown. */
function withSpacing(card: ReceiptCardState, spacing: ReceiptSpacing): ReceiptCardState {
  return { ...card, spacing, spacingText: textsOf(spacing) };
}

/** The A6 white strip moved to the other side: top and bottom swap, numbers and the text of both fields. */
function swapWhite(card: ReceiptCardState): ReceiptCardState {
  const { topUm, bottomUm } = card.spacingText;
  return { ...card, spacing: swapWhiteSpacing(card.spacing), spacingText: { ...card.spacingText, topUm: bottomUm, bottomUm: topUm } };
}

/** Sets the white side; only an A6 card moves its margins (the other formats keep the field and nothing else). */
function setWhite(card: ReceiptCardState, white: ReceiptWhite): ReceiptCardState {
  if (card.white === white) return card;
  const next = { ...card, white };
  return card.format === 'a6' ? swapWhite(next) : next;
}

/** The format's own rules for a design: the turn that matches the slot, the white that goes with that turn, and the format's default spacing. */
function applyAuto(card: ReceiptCardState, format: ReceiptFormat, design: DesignSource): ReceiptCardState {
  const turn = autoTurn(format, design);
  const white = autoWhite(turn);
  return withSpacing({ ...card, format, turn, white }, defaultSpacing(format, white));
}

export function receiptReducer(state: ReceiptCardState[], action: ReceiptAction): ReceiptCardState[] {
  switch (action.type) {
    case 'add': {
      const room = Math.max(0, MAX_STAFF_FILES - state.length);
      const added = action.items.slice(0, room).map(
        (it): ReceiptCardState => ({
          id: it.id,
          file: it.file,
          status: 'decoding',
          design: null,
          error: null,
          format: 'a4',
          formatPicked: false,
          turn: 0,
          white: 'top',
          spacing: defaultSpacing('a4'),
          spacingText: textsOf(defaultSpacing('a4')),
        }),
      );
      return added.length ? [...state, ...added] : state;
    }
    case 'remove':
      return state.some((c) => c.id === action.id) ? state.filter((c) => c.id !== action.id) : state;
    case 'decoded':
      return update(state, action.id, (card) => {
        if (card.status !== 'decoding') return card;
        if (!action.outcome.ok) return { ...card, status: 'error', design: null, error: action.outcome.error };
        const design = action.outcome.source;
        const format = card.formatPicked ? card.format : guessReceiptFormat(card.file.name, design);
        return applyAuto({ ...card, status: 'ready', design, error: null }, format, design);
      });
    case 'format':
      return update(state, action.id, (card) => {
        if (card.format === action.format) return card.formatPicked ? card : { ...card, formatPicked: true };
        const picked: ReceiptCardState = { ...card, formatPicked: true };
        return card.design ? applyAuto(picked, action.format, card.design) : withSpacing({ ...picked, format: action.format }, defaultSpacing(action.format, card.white));
      });
    case 'turn':
      return update(state, action.id, (card) => {
        if (!card.design) return card;
        const turn = nextTurn(card.turn);
        return setWhite({ ...card, turn }, autoWhite(turn));
      });
    case 'white':
      return update(state, action.id, (card) => setWhite(card, action.white));
    case 'spacing':
      return update(state, action.id, (card) => {
        // The inputs are disabled until the card is ready; a stray action before that changes nothing.
        if (card.status !== 'ready' || card.spacingText[action.key] === action.text) return card;
        const um = parseMm(action.text);
        // Only a valid number is committed; any other text stays in the field and blocks the card (cardView).
        const spacing = um !== null && um <= MAX_SPACING_UM ? { ...card.spacing, [action.key]: um } : card.spacing;
        return { ...card, spacing, spacingText: { ...card.spacingText, [action.key]: action.text } };
      });
    case 'spacingReset':
      return update(state, action.id, (card) => (card.status === 'ready' ? withSpacing(card, defaultSpacing(card.format, card.white)) : card));
  }
}

/* ───────────────────────────────── what a card shows ───────────────────────────────── */

export type ReceiptProblem = { kind: 'decode'; error: DesignDecodeError } | { kind: 'spacing'; reason: 'invalid' | 'noRoom' };

/** The spacing fields whose text is not a number from 0 to 100 mm that matches what is committed. */
function invalidSpacingKeys(card: ReceiptCardState): ReceiptSpacingKey[] {
  return RECEIPT_SPACING_KEYS.filter((k) => {
    const um = parseMm(card.spacingText[k]);
    return um === null || um > MAX_SPACING_UM || um !== card.spacing[k];
  });
}

export interface ReceiptCardView {
  /** Why the card cannot be printed yet; null while it is fine or still decoding. */
  problem: ReceiptProblem | null;
  /** With a spacing problem 'invalid': the fields whose text is not a valid number. */
  invalidSpacing: readonly ReceiptSpacingKey[];
  /** The poorer of the two axes' resolution over the slot (after the card's turn); null for vector PDFs. */
  dpi: number | null;
  /** Below the website's warning DPI. A warning only: it never blocks. */
  lowDpi: boolean;
  /** The PDF has more than one page; only page 1 is used. */
  multiPage: boolean;
  /** Ready to print. */
  valid: boolean;
}

/**
 * The spec the design is printed at, in the DESIGN's own orientation: the card's real slot (the
 * format's grid with the card's spacing), with its sides swapped when the card turns the design a
 * quarter. (The design is stretched, so width and height are measured separately.)
 */
export function designSpec(format: ReceiptFormat, spacing: ReceiptSpacing, turn: ReceiptTurn): StickerSpec {
  const { widthUm, heightUm } = receiptSlots(format, spacing)[0];
  const swap = turn === 90 || turn === 270;
  return { shape: 'rect', corners: 'sharp', widthUm: swap ? heightUm : widthUm, heightUm: swap ? widthUm : heightUm };
}

export function cardView(card: ReceiptCardState, quality: QualitySettings): ReceiptCardView {
  const empty: ReceiptCardView = { problem: null, invalidSpacing: [], dpi: null, lowDpi: false, multiPage: false, valid: false };
  if (card.status === 'error' && card.error) return { ...empty, problem: { kind: 'decode', error: card.error } };
  const design = card.design;
  if (!design) return empty;
  const multiPage = (design.pdf?.pageCount ?? 1) > 1;
  const invalid = invalidSpacingKeys(card);
  // A spacing that leaves no room never reaches the slot maths below (its sizes could be zero or negative).
  if (!spacingFits(card.format, card.spacing)) {
    return { ...empty, multiPage, invalidSpacing: invalid, problem: { kind: 'spacing', reason: invalid.length ? 'invalid' : 'noRoom' } };
  }
  const spec = designSpec(card.format, card.spacing, card.turn);
  const across = dpiFor(design, spec);
  const down = dpiFor({ kind: design.kind, pxWidth: design.pxHeight, pxHeight: design.pxWidth }, { ...spec, widthUm: spec.heightUm });
  const dpi = across === null || down === null ? null : Math.min(across, down);
  return {
    ...empty,
    dpi,
    lowDpi: dpiStatus(dpi, quality) !== 'ok',
    multiPage,
    invalidSpacing: invalid,
    problem: invalid.length ? { kind: 'spacing', reason: 'invalid' } : null,
    valid: card.status === 'ready' && invalid.length === 0,
  };
}

/** `cardView` memoised per card object: the reducer keeps every untouched card's identity. */
export function createViewCache(quality: QualitySettings): (card: ReceiptCardState) => ReceiptCardView {
  const cache = new WeakMap<ReceiptCardState, ReceiptCardView>();
  return (card) => {
    let v = cache.get(card);
    if (!v) {
      v = cardView(card, quality);
      cache.set(card, v);
    }
    return v;
  };
}

/** The download button is enabled with at least one card and every card ready to print. */
export function canDownload(views: readonly ReceiptCardView[]): boolean {
  return views.length >= 1 && views.every((v) => v.valid);
}

/* ───────────────────────────────── the download ───────────────────────────────── */

/** `<design file name without extension>-A5.pdf` (the format in capitals). */
export function receiptPdfName(fileName: string, format: ReceiptFormat): string {
  return `${fileBaseName(fileName)}-${format.toUpperCase()}.pdf`;
}

/** Names for the cards of one download; a repeated name gets `-2`, `-3` before `.pdf`. */
export function receiptPdfNames(cards: readonly ReceiptCardState[]): string[] {
  const seen = new Map<string, number>();
  return cards.map((card) => {
    const name = receiptPdfName(card.file.name, card.format);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : name.replace(/\.pdf$/, `-${n}.pdf`);
  });
}

export type ReceiptFileResult =
  | { ok: true; bytes: Uint8Array; fileName: string }
  | { ok: false; reason: 'prepare'; cardId: string; fileName: string; error: PrepareError }
  | { ok: false; reason: 'build'; cardId: string; fileName: string };

/** One design's PDF: prepare its artwork at its own resolution, then build the A4 sheet. `fileName` is what the PDF is saved as. */
export async function buildReceiptFile(card: ReceiptCardState, fileName: string, now: Date = new Date()): Promise<ReceiptFileResult> {
  const failed = { cardId: card.id, fileName: card.file.name } as const;
  try {
    if (!card.design || card.status !== 'ready') return { ok: false, reason: 'build', ...failed };
    // Text that is not a valid number, or no room: the UI blocks the download, and so does this.
    if (invalidSpacingKeys(card).length || !spacingFits(card.format, card.spacing)) return { ok: false, reason: 'build', ...failed };
    const prepared = await prepareOriginalArtwork(card.design, designSpec(card.format, card.spacing, card.turn));
    if (!prepared.ok) {
      if (prepared.error === 'corrupt') {
        reportClientError(new Error('receipt prepare failed: corrupt'), {
          where: 'staff.receipts.prepare',
          extra: { fileSize: card.file.size, kind: card.design.kind },
        });
      }
      return { ok: false, reason: 'prepare', ...failed, error: prepared.error };
    }
    const { buildReceiptPdf } = await import('@/lib/pdf/build-receipt-pdf');
    const bytes = await buildReceiptPdf({ format: card.format, spacing: card.spacing, turnCw: card.turn, artwork: prepared.artwork }, now);
    return { ok: true, bytes, fileName };
  } catch (e) {
    // No file name or design data goes along.
    reportClientError(e, { where: 'staff.receipts.buildPdf', extra: { fileSize: card.file.size } });
    return { ok: false, reason: 'build', ...failed };
  }
}

export type ReceiptDownloadOptions = StaffDownloadOptions;

export interface ReceiptDownloadSummary {
  saved: string[];
  failed: Exclude<ReceiptFileResult, { ok: true }>[];
}

/**
 * One PDF per design, in card order, one after another: each file is prepared, built and saved
 * before the next starts (phone memory), with a pause between saves. A design that fails is
 * reported and the others carry on; files already saved stay saved.
 */
export async function downloadReceiptFiles(cards: readonly ReceiptCardState[], opts: ReceiptDownloadOptions): Promise<ReceiptDownloadSummary> {
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? new Date();
  const names = receiptPdfNames(cards);
  const summary: ReceiptDownloadSummary = { saved: [], failed: [] };
  let savedAny = false;
  for (let i = 0; i < cards.length; i++) {
    opts.onProgress?.(i + 1, cards.length);
    const out = await buildReceiptFile(cards[i], names[i], now);
    if (!out.ok) {
      summary.failed.push(out);
      continue;
    }
    if (savedAny) await wait(SAVE_GAP_MS);
    try {
      opts.save(out.bytes, out.fileName);
      summary.saved.push(out.fileName);
      savedAny = true;
    } catch (e) {
      reportClientError(e, { where: 'staff.receipts.savePdf' });
      summary.failed.push({ ok: false, reason: 'build', cardId: cards[i].id, fileName: cards[i].file.name });
    }
  }
  return summary;
}
