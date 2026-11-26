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
import {
  RECEIPT_FORMATS,
  autoTurn,
  autoWhite,
  guessReceiptFormat,
  nextTurn,
  type ReceiptFormat,
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
}

export type ReceiptAction =
  | { type: 'add'; items: { id: string; file: File }[] }
  | { type: 'decoded'; id: string; outcome: DesignDecodeOutcome }
  | { type: 'format'; id: string; format: ReceiptFormat }
  | { type: 'turn'; id: string }
  | { type: 'white'; id: string; white: ReceiptWhite }
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

/** The format's own rules for a design: the turn that matches the slot, and the white that goes with that turn. */
function applyAuto(card: ReceiptCardState, format: ReceiptFormat, design: DesignSource): ReceiptCardState {
  const turn = autoTurn(format, design);
  return { ...card, format, turn, white: autoWhite(turn) };
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
        return card.design ? applyAuto(picked, action.format, card.design) : { ...picked, format: action.format };
      });
    case 'turn':
      return update(state, action.id, (card) => {
        if (!card.design) return card;
        const turn = nextTurn(card.turn);
        return { ...card, turn, white: autoWhite(turn) };
      });
    case 'white':
      return update(state, action.id, (card) => (card.white === action.white ? card : { ...card, white: action.white }));
  }
}

/* ───────────────────────────────── what a card shows ───────────────────────────────── */

export type ReceiptProblem = { kind: 'decode'; error: DesignDecodeError };

export interface ReceiptCardView {
  /** Why the card cannot be printed yet; null while it is fine or still decoding. */
  problem: ReceiptProblem | null;
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
 * The spec the design is printed at, in the DESIGN's own orientation: the slot, with its sides
 * swapped when the card turns the design a quarter. (The design is stretched, so width and
 * height are measured separately.)
 */
export function designSpec(format: ReceiptFormat, turn: ReceiptTurn): StickerSpec {
  const { widthUm, heightUm } = RECEIPT_FORMATS[format];
  const swap = turn === 90 || turn === 270;
  return { shape: 'rect', corners: 'sharp', widthUm: swap ? heightUm : widthUm, heightUm: swap ? widthUm : heightUm };
}

export function cardView(card: ReceiptCardState, quality: QualitySettings): ReceiptCardView {
  const empty: ReceiptCardView = { problem: null, dpi: null, lowDpi: false, multiPage: false, valid: false };
  if (card.status === 'error' && card.error) return { ...empty, problem: { kind: 'decode', error: card.error } };
  const design = card.design;
  if (!design) return empty;
  const spec = designSpec(card.format, card.turn);
  const across = dpiFor(design, spec);
  const down = dpiFor({ kind: design.kind, pxWidth: design.pxHeight, pxHeight: design.pxWidth }, { ...spec, widthUm: spec.heightUm });
  const dpi = across === null || down === null ? null : Math.min(across, down);
  return {
    ...empty,
    dpi,
    lowDpi: dpiStatus(dpi, quality) !== 'ok',
    multiPage: (design.pdf?.pageCount ?? 1) > 1,
    valid: card.status === 'ready',
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
    const prepared = await prepareOriginalArtwork(card.design, designSpec(card.format, card.turn));
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
    const bytes = await buildReceiptPdf({ format: card.format, white: card.white, turnCw: card.turn, artwork: prepared.artwork }, now);
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
