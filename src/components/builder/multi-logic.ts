/**
 * Multi-design orders, no React: the extra design slots (designs 2..MAX_DESIGNS) and their reducer, the per-design
 * rows the size step shows, the specs handed to computeMultiLayout and the extras of the submit input.
 *
 * Design 1 never lives here: it stays in the builder's scalar state (design, widthText, sizeUm, fileId …), so a
 * single-design order is untouched. Multi mode is active only when the box is ticked AND at least one extra exists.
 */
import { MAX_DESIGNS } from '@/config/defaults';
import { dpiFor, dpiStatus, type DpiStatus } from './logic';
import { maxWidthAtAspect, safeDerive, safeFormatCm, safeParseCm } from './safe';
import type {
  Corners,
  DesignDecodeError,
  DesignSource,
  LayoutSettings,
  MultiLayoutResult,
  QualitySettings,
  Shape,
  StickerSpec,
} from '@/lib/types';

export type SizeUm = { widthUm: number; heightUm: number };

/** One extra design (2..N) of a multi-design order. */
export interface DesignSlot {
  /** Stable key of the slot (React key, DOM ids, decode token). */
  id: string;
  /** The picked file; kept after a failed decode so a shape change can try again. */
  file: File | null;
  design: DesignSource | null;
  decoding: boolean;
  error: DesignDecodeError | null;
  widthText: string;
  heightText: string;
  sizeUm: SizeUm | null;
  /** Id of the copy kept in IndexedDB ('design:<fileId>'); null while the file is not saved. */
  fileId: string | null;
}

/** Multi mode is active only in the upload mode, with the box ticked and at least one extra design. */
export function isMultiActive(mode: 'ai' | 'upload', multi: boolean, extraCount: number): boolean {
  return mode === 'upload' && multi && extraCount >= 1;
}

/** Aspect (width / height) of a decoded design. */
export const aspectOf = (d: Pick<DesignSource, 'pxWidth' | 'pxHeight'>): number => d.pxWidth / d.pxHeight;

/** The spec of one design: the shared shape (and corners) with the design's own size. A circle has one side. */
export function specFor(shape: Shape, corners: Corners, size: SizeUm | null): StickerSpec | null {
  if (!size) return null;
  return {
    shape,
    ...(shape === 'rect' ? { corners } : {}),
    widthUm: size.widthUm,
    heightUm: shape === 'circle' ? size.widthUm : size.heightUm,
  };
}

/** The specs of every design (design 1 first), or null while any design has no size yet. */
export function buildMultiSpecs(first: StickerSpec | null, shape: Shape, corners: Corners, extraSizes: (SizeUm | null)[]): StickerSpec[] | null {
  if (!first) return null;
  const out: StickerSpec[] = [first];
  for (const size of extraSizes) {
    const s = specFor(shape, corners, size);
    if (!s) return null;
    out.push(s);
  }
  return out;
}

/* ───────────────────────── size of one extra design ───────────────────────── */

export interface SizeEdit {
  widthText: string;
  heightText: string;
  sizeUm: SizeUm | null;
}

/** An extra design's width box changed: its own aspect decides the height (the design-1 rules, always locked). */
export function editWidth(shape: Shape, aspect: number, text: string, heightText: string): SizeEdit {
  const um = safeParseCm(text);
  if (!um) return { widthText: text, heightText: shape !== 'circle' && !text.trim() ? '' : heightText, sizeUm: null };
  const d = safeDerive(shape, aspect, { widthUm: um });
  return { widthText: text, heightText: shape !== 'circle' ? safeFormatCm(d.heightUm) : heightText, sizeUm: d };
}

/** An extra design's height box changed. */
export function editHeight(shape: Shape, aspect: number, text: string, widthText: string): SizeEdit {
  const um = safeParseCm(text);
  if (!um) return { widthText: !text.trim() ? '' : widthText, heightText: text, sizeUm: null };
  const d = safeDerive(shape, aspect, { heightUm: um });
  return { widthText: safeFormatCm(d.widthUm), heightText: text, sizeUm: d };
}

/** Show a width (µm) for a design: the other side follows its aspect (a circle has no height box). */
export function sizeFromWidthUm(shape: Shape, aspect: number, widthUm: number): SizeEdit {
  const d = safeDerive(shape, shape === 'circle' ? 1 : aspect, { widthUm });
  return { widthText: safeFormatCm(d.widthUm), heightText: shape === 'circle' ? '' : safeFormatCm(d.heightUm), sizeUm: d };
}

/**
 * The size a saved extra comes back with: its typed texts are kept as they were, the size is derived from the typed
 * width (else the typed height) and the decoded artwork. null when neither text is a number.
 */
export function sizeFromTexts(shape: Shape, aspect: number, widthText: string, heightText: string): SizeUm | null {
  const w = safeParseCm(widthText);
  if (w) return safeDerive(shape, shape === 'circle' ? 1 : aspect, { widthUm: w });
  const h = shape === 'circle' ? null : safeParseCm(heightText);
  return h ? safeDerive(shape, aspect, { heightUm: h }) : null;
}

/** A size shown as it is (a circle has no height box). */
export function showSizeEdit(shape: Shape, size: SizeUm): SizeEdit {
  return { widthText: safeFormatCm(size.widthUm), heightText: shape === 'circle' ? '' : safeFormatCm(size.heightUm), sizeUm: size };
}

/** Largest width per design at its own aspect (null where the design is missing: aspect 0). */
export function maxWidthsFor(shape: Shape, corners: Corners, aspects: number[], layout: LayoutSettings): (number | null)[] {
  return aspects.map((a) => (a > 0 ? maxWidthAtAspect(shape, corners, a, layout) : null));
}

/* ───────────────────────── the slots (reducer) ───────────────────────── */

export type SlotAction =
  /** A file is being read: a new slot, or a slot read again (its old design stays until the new one is ready). */
  | { type: 'start'; id: string; file: File }
  | { type: 'decoded'; id: string; design: DesignSource; fileId: string | null; size: SizeEdit }
  | { type: 'failed'; id: string; error: DesignDecodeError }
  | { type: 'remove'; id: string }
  | { type: 'size'; id: string; size: SizeEdit }
  /** The shape changed: every decoded slot derives its size again from its typed width. */
  | { type: 'reshape'; shape: Shape }
  /** A restore stopped: slots still being read have nothing to show. */
  | { type: 'dropUndecoded' }
  | { type: 'reset' };

const EMPTY_SLOT = (id: string, file: File): DesignSlot => ({
  id,
  file,
  design: null,
  decoding: true,
  error: null,
  widthText: '',
  heightText: '',
  sizeUm: null,
  fileId: null,
});

export function slotsReducer(slots: DesignSlot[], a: SlotAction): DesignSlot[] {
  const patch = (id: string, f: (s: DesignSlot) => DesignSlot) => slots.map((s) => (s.id === id ? f(s) : s));
  switch (a.type) {
    case 'start': {
      if (slots.some((s) => s.id === a.id)) return patch(a.id, (s) => ({ ...s, file: a.file, decoding: true, error: null }));
      if (slots.length >= MAX_DESIGNS - 1) return slots;
      return [...slots, EMPTY_SLOT(a.id, a.file)];
    }
    case 'decoded':
      return patch(a.id, (s) => ({ ...s, design: a.design, decoding: false, error: null, fileId: a.fileId, ...a.size }));
    case 'failed':
      return patch(a.id, (s) => ({ ...s, design: null, decoding: false, error: a.error, fileId: null }));
    case 'remove':
      return slots.filter((s) => s.id !== a.id);
    case 'size':
      return patch(a.id, (s) => ({ ...s, ...a.size }));
    case 'reshape':
      return slots.map((s) => {
        if (!s.design) return s;
        const w = safeParseCm(s.widthText);
        return w ? { ...s, ...sizeFromWidthUm(a.shape, aspectOf(s.design), w) } : s;
      });
    case 'dropUndecoded':
      return slots.filter((s) => s.design !== null || s.error !== null);
    case 'reset':
      return slots.length === 0 ? slots : [];
  }
}

/* ───────────────────────── rows shown by the design and size steps ───────────────────────── */

/** One design of the order as the design and size steps show it (design 1 first). */
export interface DesignRow {
  /** 0 = design 1 (the builder's own state), 1.. = the extras. */
  index: number;
  /** 'main' for design 1, else the slot id. */
  id: string;
  design: DesignSource | null;
  decoding: boolean;
  error: DesignDecodeError | null;
  widthText: string;
  heightText: string;
  spec: StickerSpec | null;
  dpi: number | null;
  dpiState: DpiStatus;
  /** Largest width this design accepts at its own aspect. */
  maxWidthUm: number | null;
}

export interface RowInput {
  shape: Shape;
  corners: Corners;
  design: DesignSource | null;
  decoding: boolean;
  designError: DesignDecodeError | null;
  widthText: string;
  heightText: string;
  /** Design 1's spec (the builder's `spec`). */
  spec: StickerSpec | null;
  extras: DesignSlot[];
  /** Largest width of each design (design 1 first), from maxWidthsFor. */
  maxWidths: (number | null)[];
  quality: QualitySettings;
}

export function designRows(p: RowInput): DesignRow[] {
  const row = (
    index: number,
    id: string,
    design: DesignSource | null,
    decoding: boolean,
    error: DesignDecodeError | null,
    widthText: string,
    heightText: string,
    spec: StickerSpec | null,
  ): DesignRow => {
    const dpi = design && spec ? dpiFor(design, spec) : null;
    return {
      index,
      id,
      design,
      decoding,
      error,
      widthText,
      heightText,
      spec,
      dpi,
      dpiState: dpiStatus(dpi, p.quality),
      maxWidthUm: p.maxWidths[index] ?? null,
    };
  };
  return [
    row(0, 'main', p.design, p.decoding, p.designError, p.widthText, p.heightText, p.spec),
    ...p.extras.map((e, i) => row(i + 1, e.id, e.design, e.decoding, e.error, e.widthText, e.heightText, specFor(p.shape, p.corners, e.sizeUm))),
  ];
}

/** Every design of a multi-design order is read, has no error and is not being read. */
export function allDesignsReady(rows: DesignRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.design !== null && !r.decoding && r.error === null);
}

/** True when any design's print quality is too low to order. */
export const anyDpiBlocked = (rows: DesignRow[]): boolean => rows.some((r) => r.dpiState === 'block');

/** How many design files the order holds: design 1 (read or being read) plus the extras. */
export function designCount(hasFirst: boolean, extraCount: number): number {
  return (hasFirst ? 1 : 0) + extraCount;
}

/** How many more files may be added (never below 0). */
export function roomLeft(hasFirst: boolean, extraCount: number): number {
  return Math.max(0, MAX_DESIGNS - designCount(hasFirst, extraCount));
}

/**
 * Split a pick of several files: the first one is design 1 while it is still empty, the rest are extras up to the cap.
 * `ignored` counts the files over the cap (the page tells the customer).
 */
export function splitPick(files: File[], firstTaken: boolean, extraCount: number): { first: File | null; extras: File[]; ignored: number } {
  let rest = files;
  let first: File | null = null;
  if (!firstTaken && rest.length > 0) {
    first = rest[0];
    rest = rest.slice(1);
  }
  // Design 1 is taken now (before or by this pick), so the extras may fill the other MAX_DESIGNS - 1 places.
  const room = roomLeft(true, extraCount);
  const extras = rest.slice(0, room);
  return { first, extras, ignored: rest.length - extras.length };
}

/**
 * Book-keeping for picks whose extra files wait until design 1 has been read. `begin` reserves room for a pick's
 * extras (so a second pick sees them against the cap), `settle` says whether they may start now, and `reset` (the
 * box unticked, AI mode started) cancels every pick still waiting.
 */
export class PickGate {
  private epoch = 0;
  private held = 0;
  /** Extras of picks that are still waiting for design 1. */
  get pending(): number {
    return this.held;
  }
  begin(extraCount: number): number {
    this.held += extraCount;
    return this.epoch;
  }
  /** True when the pick that began in `epoch` may start its `extraCount` extras; false when it was cancelled. */
  settle(epoch: number, extraCount: number): boolean {
    if (epoch !== this.epoch) return false;
    this.held = Math.max(0, this.held - extraCount);
    return true;
  }
  reset(): void {
    this.epoch++;
    this.held = 0;
  }
}

/* ───────────────────────── quantity and submit ───────────────────────── */

/** Stickers received of EACH design: whole sheets × copies of that design on a sheet. null while unknown. */
export function perDesignTotal(sheets: number | null, layout: Pick<MultiLayoutResult, 'perDesign'> | null): number | null {
  return sheets !== null && layout ? sheets * layout.perDesign : null;
}

/** The size of every design for the summary (design 1 = the spec). A circle's height is its width. */
export function designSizes(specs: StickerSpec[]): SizeUm[] {
  return specs.map((s) => ({ widthUm: s.widthUm, heightUm: s.heightUm }));
}

/** The extra designs of the submit input, or null while any extra lacks its decoded design or its size. */
export function submitExtras(extras: DesignSlot[], shape: Shape): { design: DesignSource; widthUm: number; heightUm: number }[] | null {
  const out: { design: DesignSource; widthUm: number; heightUm: number }[] = [];
  for (const e of extras) {
    if (!e.design || !e.sizeUm) return null;
    out.push({ design: e.design, widthUm: e.sizeUm.widthUm, heightUm: shape === 'circle' ? e.sizeUm.widthUm : e.sizeUm.heightUm });
  }
  return out;
}

/** The extras kept in the draft: only the designs that are read and saved. */
export function savedExtras(extras: DesignSlot[]): { fileId: string; widthText: string; heightText: string }[] {
  const out: { fileId: string; widthText: string; heightText: string }[] = [];
  for (const e of extras) if (e.fileId && e.design) out.push({ fileId: e.fileId, widthText: e.widthText, heightText: e.heightText });
  return out;
}

/** True when some placement of a multi-design layout is turned 90° (the preview shows a hint). */
export const hasTurnedCells = (layout: MultiLayoutResult): boolean => layout.placements.some((p) => p.turned);
