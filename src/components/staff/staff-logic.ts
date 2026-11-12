/**
 * The staff page's state and rules, free of React so they can be tested in node: the card
 * list reducer (one card per picked file), what each card shows (`cardView`), and the download
 * (`buildStaffDownload`: prepare every design in card order, then one multi-page PDF).
 * The size rules are the builder's (same `safe*` wrappers, same layout engine, same settings).
 */
import { SHOP_TIME_ZONE } from '@/config/defaults';
import { dpiFor, dpiStatus, pdfPrefillUm } from '@/components/builder/logic';
import { safeDerive, safeFormatCm, safeLayout, safeMaxWidth, safeParseCm } from '@/components/builder/safe';
import { prepareArtwork, type PrepareError } from '@/lib/design/prepare.client';
import type {
  Corners,
  DesignDecodeError,
  DesignDecodeOutcome,
  DesignSource,
  LayoutFailure,
  LayoutResult,
  LayoutSettings,
  NormalisedArtwork,
  QualitySettings,
  Shape,
  StickerSpec,
} from '@/lib/types';

/** Spec B2: at most 30 files, 50 MB each. */
export const MAX_STAFF_FILES = 30;
export const MAX_STAFF_FILE_BYTES = 50 * 1024 * 1024;

/** The four shapes the employee picks from (the website's circle, rect with either corners, custom). */
export type StaffShape = 'circle' | 'rounded' | 'sharp' | 'custom';
export const STAFF_SHAPES: readonly StaffShape[] = ['circle', 'rounded', 'sharp', 'custom'];

type SizeUm = { widthUm: number; heightUm: number };

export interface StaffCardState {
  id: string;
  file: File;
  shape: StaffShape;
  /** 'decoding' until decodeDesign answers; 'error' when it refused the file. */
  status: 'decoding' | 'ready' | 'error';
  /** Bumped on every re-decode; an answer for an older seq is dropped. */
  seq: number;
  design: DesignSource | null;
  error: DesignDecodeError | null;
  widthText: string;
  heightText: string;
  /** The field the employee typed last; when the design finishes decoding, that one is kept. */
  lastEdited: 'width' | 'height';
  sizeUm: SizeUm | null;
}

export type StaffAction =
  | { type: 'add'; items: { id: string; file: File }[] }
  | { type: 'decoded'; id: string; seq: number; outcome: DesignDecodeOutcome }
  | { type: 'shape'; id: string; shape: StaffShape }
  | { type: 'width'; id: string; text: string }
  | { type: 'height'; id: string; text: string }
  | { type: 'remove'; id: string };

/** Shape and corners in the website's vocabulary. */
export function baseShape(s: StaffShape): { shape: Shape; corners?: Corners } {
  if (s === 'circle') return { shape: 'circle' };
  if (s === 'custom') return { shape: 'custom' };
  return { shape: 'rect', corners: s === 'rounded' ? 'rounded' : 'sharp' };
}

/** The aspect the size lock uses: a circle is always 1, otherwise the design's. */
function aspectOf(shape: StaffShape, design: DesignSource | null): number {
  return shape === 'circle' || !design ? 1 : design.pxWidth / design.pxHeight;
}

/** Both inputs show a size (a circle has no height field). */
function withSize(card: StaffCardState, d: SizeUm): StaffCardState {
  return {
    ...card,
    sizeUm: d,
    widthText: safeFormatCm(d.widthUm),
    heightText: card.shape === 'circle' ? '' : safeFormatCm(d.heightUm),
  };
}

function update(state: StaffCardState[], id: string, fn: (c: StaffCardState) => StaffCardState): StaffCardState[] {
  const i = state.findIndex((c) => c.id === id);
  if (i < 0) return state;
  const next = fn(state[i]);
  if (next === state[i]) return state;
  const copy = state.slice();
  copy[i] = next; // every other card keeps its identity, so cached views stay valid
  return copy;
}

export function staffReducer(state: StaffCardState[], action: StaffAction): StaffCardState[] {
  switch (action.type) {
    case 'add': {
      const room = Math.max(0, MAX_STAFF_FILES - state.length);
      const added = action.items.slice(0, room).map(
        (it): StaffCardState => ({
          id: it.id,
          file: it.file,
          shape: 'circle',
          status: 'decoding',
          seq: 1,
          design: null,
          error: null,
          widthText: '',
          heightText: '',
          lastEdited: 'width',
          sizeUm: null,
        }),
      );
      return added.length ? [...state, ...added] : state;
    }
    case 'remove':
      return state.some((c) => c.id === action.id) ? state.filter((c) => c.id !== action.id) : state;
    case 'decoded':
      return update(state, action.id, (card) => {
        if (card.seq !== action.seq) return card; // a newer decode superseded this one
        if (!action.outcome.ok) return { ...card, status: 'error', design: null, error: action.outcome.error };
        const design = action.outcome.source;
        const ready: StaffCardState = { ...card, status: 'ready', design, error: null };
        const shape = baseShape(card.shape).shape;
        const h = card.shape !== 'circle' && card.lastEdited === 'height' ? safeParseCm(card.heightText) : null;
        if (h) return withSize(ready, safeDerive(shape, aspectOf(card.shape, design), { heightUm: h }));
        const w = safeParseCm(card.widthText);
        if (w) return withSize(ready, safeDerive(shape, aspectOf(card.shape, design), { widthUm: w }));
        const prefill = pdfPrefillUm(design, baseShape(card.shape).shape);
        return prefill ? withSize(ready, prefill) : ready;
      });
    case 'shape':
      return update(state, action.id, (card) => {
        if (card.shape === action.shape) return card;
        let next: StaffCardState = { ...card, shape: action.shape };
        const w = safeParseCm(card.widthText);
        if (w) next = withSize(next, safeDerive(baseShape(next.shape).shape, aspectOf(next.shape, card.design), { widthUm: w }));
        else next = { ...next, heightText: next.shape === 'circle' ? '' : next.heightText };
        // Only 'custom' changes how a file is decoded (alpha trim, alpha required).
        if ((action.shape === 'custom') !== (card.shape === 'custom')) {
          next = { ...next, status: 'decoding', seq: card.seq + 1, error: null };
        }
        return next;
      });
    case 'width':
      return update(state, action.id, (card) => {
        const um = safeParseCm(action.text);
        const base: StaffCardState = { ...card, widthText: action.text, lastEdited: 'width' };
        if (!um) return { ...base, sizeUm: null, heightText: card.shape !== 'circle' && !action.text.trim() ? '' : card.heightText };
        const d = safeDerive(baseShape(card.shape).shape, aspectOf(card.shape, card.design), { widthUm: um });
        return { ...base, sizeUm: d, heightText: card.shape === 'circle' ? '' : safeFormatCm(d.heightUm) };
      });
    case 'height':
      return update(state, action.id, (card) => {
        const um = safeParseCm(action.text);
        const base: StaffCardState = { ...card, heightText: action.text, lastEdited: 'height' };
        if (!um) return { ...base, sizeUm: null, widthText: !action.text.trim() ? '' : card.widthText };
        const d = safeDerive(baseShape(card.shape).shape, aspectOf(card.shape, card.design), { heightUm: um });
        return { ...base, sizeUm: d, widthText: safeFormatCm(d.widthUm) };
      });
  }
}

/** The spec of a card (a circle is square); null while there is no valid size. */
export function cardSpec(card: StaffCardState): StickerSpec | null {
  if (!card.sizeUm) return null;
  const { shape, corners } = baseShape(card.shape);
  return {
    shape,
    ...(corners ? { corners } : {}),
    widthUm: card.sizeUm.widthUm,
    heightUm: shape === 'circle' ? card.sizeUm.widthUm : card.sizeUm.heightUm,
  };
}

/* ───────────────────────────────── what a card shows ───────────────────────────────── */

export type StaffProblem =
  | { kind: 'decode'; error: DesignDecodeError }
  | { kind: 'size'; reason: 'invalid' | LayoutFailure };

export interface StaffCardView {
  spec: StickerSpec | null;
  layout: LayoutResult | null;
  /** Why the card cannot be printed yet; null while it is fine or still empty. */
  problem: StaffProblem | null;
  /** Largest width that fits (µm), only worked out for `too_big_for_page`. */
  maxWidthUm: number | null;
  dpi: number | null;
  /** Below the website's warning DPI. A warning only here: it never blocks. */
  lowDpi: boolean;
  /** Ready to print: decoded, a size, a layout. */
  valid: boolean;
}

export function cardView(card: StaffCardState, layoutSettings: LayoutSettings, quality: QualitySettings): StaffCardView {
  const empty: StaffCardView = { spec: null, layout: null, problem: null, maxWidthUm: null, dpi: null, lowDpi: false, valid: false };
  if (card.status === 'error' && card.error) return { ...empty, problem: { kind: 'decode', error: card.error } };

  const isCircle = card.shape === 'circle';
  const widthBad = card.widthText.trim() !== '' && safeParseCm(card.widthText) === null;
  const heightBad = !isCircle && card.heightText.trim() !== '' && safeParseCm(card.heightText) === null;
  if (widthBad || heightBad) return { ...empty, problem: { kind: 'size', reason: 'invalid' } };

  const spec = cardSpec(card);
  if (!spec) return empty;

  const outcome = safeLayout(spec, layoutSettings);
  const dpi = card.design ? dpiFor(card.design, spec) : null;
  const lowDpi = dpiStatus(dpi, quality) !== 'ok';
  if (!outcome.ok) {
    let maxWidthUm: number | null = null;
    if (outcome.reason === 'too_big_for_page') {
      const probe: StickerSpec = { ...spec, widthUm: 50_000, heightUm: 50_000 };
      const m = safeMaxWidth(aspectOf(card.shape, card.design), probe, layoutSettings);
      maxWidthUm = m && m > 0 ? m : null;
    }
    return { ...empty, spec, dpi, lowDpi, maxWidthUm, problem: { kind: 'size', reason: outcome.reason } };
  }
  return { ...empty, spec, layout: outcome.layout, dpi, lowDpi, valid: card.status === 'ready' && card.design !== null };
}

/** `cardView` memoised per card object: the reducer keeps every untouched card's identity. */
export function createViewCache(layoutSettings: LayoutSettings, quality: QualitySettings): (card: StaffCardState) => StaffCardView {
  const cache = new WeakMap<StaffCardState, StaffCardView>();
  return (card) => {
    let v = cache.get(card);
    if (!v) {
      v = cardView(card, layoutSettings, quality);
      cache.set(card, v);
    }
    return v;
  };
}

/** The download button is enabled with at least one card and every card ready to print. */
export function canDownload(views: readonly StaffCardView[]): boolean {
  return views.length >= 1 && views.every((v) => v.valid);
}

/* ───────────────────────────────── the download ───────────────────────────────── */

const pad2 = (n: string) => n.padStart(2, '0');

/** `softy-sheets-YYYYMMDD-HHmm.pdf` in shop (Baghdad) time. */
export function staffFileName(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `softy-sheets-${get('year')}${pad2(get('month'))}${pad2(get('day'))}-${pad2(get('hour'))}${pad2(get('minute'))}.pdf`;
}

export type StaffDownloadResult =
  | { ok: true; bytes: Uint8Array; fileName: string }
  | { ok: false; reason: 'prepare'; cardId: string; fileName: string; error: PrepareError }
  | { ok: false; reason: 'build' };

/**
 * Prepare every design in card order (one at a time, to keep phone memory low), then build one
 * PDF with one page per card. pdf-lib is loaded only here (dynamic import).
 */
export async function buildStaffDownload(
  cards: readonly StaffCardState[],
  layoutSettings: LayoutSettings,
  quality: QualitySettings,
  now: Date = new Date(),
): Promise<StaffDownloadResult> {
  try {
    const items: { layout: LayoutResult; artwork: NormalisedArtwork }[] = [];
    for (const card of cards) {
      const spec = cardSpec(card);
      if (!spec || !card.design) return { ok: false, reason: 'build' };
      const outcome = safeLayout(spec, layoutSettings);
      if (!outcome.ok) return { ok: false, reason: 'build' };
      const prepared = await prepareArtwork(card.design, spec, quality.targetDpi);
      if (!prepared.ok) return { ok: false, reason: 'prepare', cardId: card.id, fileName: card.file.name, error: prepared.error };
      items.push({ layout: outcome.layout, artwork: prepared.artwork });
    }
    const { buildStaffPdf } = await import('@/lib/pdf/build-staff-pdf');
    const bytes = await buildStaffPdf(items, now);
    return { ok: true, bytes, fileName: staffFileName(now) };
  } catch {
    return { ok: false, reason: 'build' };
  }
}
