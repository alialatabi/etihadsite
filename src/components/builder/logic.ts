/**
 * Builder helpers with no React, unit-tested in Node. Everything here is pure except the
 * browser-storage section at the bottom (localStorage draft + sessionStorage), which is this module's only I/O.
 */
import { effectiveDpi, ptToUm } from '@/lib/units';
import { widthPixelsFor } from '@/lib/design/pixels';
import { normaliseDigits } from '@/lib/parse/digits';
import { normalisePhone } from '@/lib/parse/phone';
import { activeTier, maxStickers, minStickers, sortedTiers, totalBeforeDiscountIqd } from '@/lib/pricing';
import { deriveLockedSize } from '@/lib/layout';
import { AI_IDEA_MAX_CHARS, AI_MAX_ASPECT } from '@/lib/ai/config';
import { BUILDER_STEPS, MATERIALS } from '@/lib/types';
import type {
  BuilderStep,
  Corners,
  CustomerInfo,
  DiscountTier,
  DesignSource,
  LayoutResult,
  Material,
  OrderResponse,
  OrderSummary,
  PriceBreakdown,
  PricingSettings,
  QualitySettings,
  Shape,
  StickerSpec,
} from '@/lib/types';

export const STEPS = BUILDER_STEPS;
export type StepId = BuilderStep;

/** The success answer of POST /api/orders (stored for, and shown by, the success page). */
export type OrderOk = Extract<OrderResponse, { ok: true }>;

export interface FormFields {
  name: string;
  phone: string;
  governorate: string;
  district: string;
  landmark: string;
  notes: string;
}

export interface PersistedForm extends FormFields {
  shape: Shape;
  corners: Corners;
  widthText: string;
  heightText: string;
  sizeUm: { widthUm: number; heightUm: number } | null;
  material: Material | null;
  /** What the customer typed in the sticker count box; '' when they never typed one. */
  stickersText: string;
  /** Index into STEPS the customer was on. Optional: forms saved before it existed have none. */
  step?: number;
  /** Id of the design file kept in IndexedDB for this form (draft-store). A stored file with another id is not this order's. */
  fileId?: string;
  /** How the design is made: designed on the site ('ai') or the customer's own file ('upload'). Absent in older drafts. */
  mode?: BuilderMode;
  /** The idea the customer typed for the AI design. */
  idea?: string;
  /** Upload id of the accepted AI design on the server (reused at submit while the design is still that file). */
  aiUploadId?: string;
  /** The draft fileId the accepted AI design got; aiUploadId only applies while `fileId === aiFileId`. */
  aiFileId?: string;
  /** Sticker size (µm) right after the AI design was accepted; a smaller size shows a warning. */
  aiSizeUm?: { w: number; h: number };
}

export type BuilderMode = 'ai' | 'upload';
export const BUILDER_MODES: readonly BuilderMode[] = ['ai', 'upload'];

export const EMPTY_FIELDS: FormFields = { name: '', phone: '', governorate: '', district: '', landmark: '', notes: '' };

export const FORM_KEY = 'ub:form:v1';
export const SUCCESS_KEY = 'ub:order-success:v1';
/** localStorage key of the draft envelope `{ v, savedAt, form }` (the plain form stays in sessionStorage under FORM_KEY). */
export const DRAFT_KEY = 'ub:draft:v1';
/** A saved draft (form and design file) is dropped after this long. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DpiStatus = 'ok' | 'warn' | 'block';

/** Unrounded effective DPI over the ordered width (what the server gates on). null for vector PDFs. */
export function dpiExact(design: Pick<DesignSource, 'kind' | 'pxWidth' | 'pxHeight'>, spec: StickerSpec): number | null {
  if (design.kind === 'pdf') return null;
  // A circle is centre-cropped to the shorter side of the artwork.
  const px = widthPixelsFor(spec.shape, design.pxWidth, design.pxHeight);
  if (!(spec.widthUm > 0)) return null;
  return effectiveDpi(px, spec.widthUm);
}

/**
 * DPI for display AND for dpiStatus. Floored (never overstates) so that, for integer
 * thresholds, `dpiStatus(dpiFor())` equals the server's unrounded comparison
 * (floor(x) < T  <=>  x < T). Use dpiExact for the raw value.
 */
export function dpiFor(design: Pick<DesignSource, 'kind' | 'pxWidth' | 'pxHeight'>, spec: StickerSpec): number | null {
  const d = dpiExact(design, spec);
  return d === null ? null : Math.floor(d + 1e-9);
}

export function dpiStatus(dpi: number | null, q: QualitySettings): DpiStatus {
  if (dpi === null) return 'ok';
  if (dpi < q.blockDpi) return 'block';
  if (dpi < q.warnDpi) return 'warn';
  return 'ok';
}

/** PDF page size (pt) → µm box used to prefill the size inputs. */
export function pdfPrefillUm(design: DesignSource, shape: Shape): { widthUm: number; heightUm: number } | null {
  if (!design.pdf) return null;
  const w = ptToUm(design.pdf.pageWidthPt);
  const h = ptToUm(design.pdf.pageHeightPt);
  if (!(w > 0) || !(h > 0)) return null;
  if (shape === 'circle') {
    const d = Math.min(w, h);
    return { widthUm: d, heightUm: d };
  }
  return { widthUm: w, heightUm: h };
}

/** Circle with a visibly non-square artwork (> 2% off square). */
export function needsCropNotice(shape: Shape, design: DesignSource | null): boolean {
  if (!design || shape !== 'circle') return false;
  return Math.abs(design.pxWidth / design.pxHeight - 1) > 0.02;
}

export interface CustomerErrors {
  phone?: boolean;
  governorate?: boolean;
  district?: boolean;
}

export function validateCustomer(f: FormFields): { errors: CustomerErrors; phoneE164: string | null } {
  let phoneE164: string | null = null;
  try {
    phoneE164 = normalisePhone(f.phone);
  } catch {
    phoneE164 = null;
  }
  const errors: CustomerErrors = {};
  if (!phoneE164) errors.phone = true;
  if (!f.governorate) errors.governorate = true;
  if (!f.district.trim()) errors.district = true;
  return { errors, phoneE164 };
}

/** DOM ids of the validated customer inputs, in form order (the first invalid one gets the focus). */
export const CUSTOMER_FIELD_IDS = {
  phone: 'cust-phone',
  governorate: 'cust-gov',
  district: 'cust-district',
} as const satisfies Record<keyof CustomerErrors, string>;

/**
 * The `customer` block of the order request, built from the form and the validated phone.
 * `marketingOptIn` (the WhatsApp-offers box, kept outside FormFields so it is never saved or restored) is sent
 * only when ticked: absent means false on the server.
 */
export function toCustomerInfo(f: FormFields, phoneE164: string, marketingOptIn: boolean = false): CustomerInfo {
  return {
    name: f.name.trim() || undefined,
    phone: phoneE164,
    governorate: f.governorate,
    district: f.district.trim(),
    landmark: f.landmark.trim(),
    notes: f.notes.trim() || undefined,
    ...(marketingOptIn ? { marketingOptIn: true } : {}),
  };
}

/** What the summary card shows. totalBeforeDiscountIqd is display-only (null/absent: no discount or no published price). */
export type SummaryData = Omit<OrderSummary, 'displayNo'> & { totalBeforeDiscountIqd?: number | null };

export function buildSummary(spec: StickerSpec, layout: LayoutResult, price: PriceBreakdown): SummaryData {
  const beforeDiscount = totalBeforeDiscountIqd(price);
  return {
    shape: spec.shape,
    corners: spec.shape === 'rect' ? spec.corners : undefined,
    widthUm: spec.widthUm,
    heightUm: spec.heightUm,
    countPerSheet: layout.countPerSheet,
    sheets: price.sheets,
    material: price.material,
    totalStickers: price.totalStickers,
    unitPriceIqd: price.unitPriceIqd,
    discountPercent: price.discountPercent,
    subtotalIqd: price.subtotalIqd,
    deliveryFeeIqd: price.deliveryFeeIqd,
    totalIqd: price.totalIqd,
    ...(beforeDiscount !== null ? { totalBeforeDiscountIqd: beforeDiscount } : {}),
    ...(price.requestedStickers !== undefined ? { requestedStickers: price.requestedStickers } : {}),
  };
}

/* ───────────────────────── restoring a saved form ───────────────────────── */

/** What a saved form puts back into the builder. A key is present only when its saved value is accepted. */
export interface RestoredState {
  shape?: Shape;
  corners?: Corners;
  widthText?: string;
  heightText?: string;
  sizeUm?: { widthUm: number; heightUm: number };
  material?: Material;
  stickersText?: string;
  /** The saved step index, only when it is a valid index into STEPS. */
  step?: number;
  /** The id of the stored design file this form belongs to. */
  fileId?: string;
  mode?: BuilderMode;
  idea?: string;
  aiUploadId?: string;
  aiFileId?: string;
  aiSizeUm?: { w: number; h: number };
  fields: FormFields;
}

/** An id kept in the draft: a non-empty string of at most 64 characters. */
const isDraftId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Pure half of the post-hydration restore: which saved values are accepted (`saved` comes from loadForm()). */
export function restoredState(saved: Partial<PersistedForm>): RestoredState {
  const r: RestoredState = {
    fields: {
      name: saved.name ?? '',
      phone: saved.phone ?? '',
      governorate: saved.governorate ?? '',
      district: saved.district ?? '',
      landmark: saved.landmark ?? '',
      notes: saved.notes ?? '',
    },
  };
  if (saved.shape) r.shape = saved.shape;
  if (saved.corners) r.corners = saved.corners;
  if (typeof saved.widthText === 'string') r.widthText = saved.widthText;
  if (typeof saved.heightText === 'string') r.heightText = saved.heightText;
  if (saved.sizeUm) r.sizeUm = saved.sizeUm;
  if (saved.material != null && MATERIALS.includes(saved.material)) r.material = saved.material;
  // A form saved by an older page has `sheetsText` (a sheet count): it is ignored on purpose.
  if (typeof saved.stickersText === 'string' && saved.stickersText.trim()) r.stickersText = saved.stickersText;
  if (typeof saved.step === 'number' && Number.isInteger(saved.step) && saved.step >= 0 && saved.step < STEPS.length) r.step = saved.step;
  if (typeof saved.fileId === 'string' && saved.fileId.length > 0 && saved.fileId.length <= 64) r.fileId = saved.fileId;
  // AI designer fields (optional; older drafts have none of them).
  if (typeof saved.mode === 'string' && BUILDER_MODES.includes(saved.mode)) r.mode = saved.mode;
  if (typeof saved.idea === 'string' && saved.idea.length > 0) r.idea = saved.idea.slice(0, AI_IDEA_MAX_CHARS);
  if (isDraftId(saved.aiUploadId)) r.aiUploadId = saved.aiUploadId;
  if (isDraftId(saved.aiFileId)) r.aiFileId = saved.aiFileId;
  const ai = saved.aiSizeUm as unknown;
  if (ai && typeof ai === 'object' && isPositiveInt((ai as { w?: unknown }).w) && isPositiveInt((ai as { h?: unknown }).h)) {
    r.aiSizeUm = { w: (ai as { w: number }).w, h: (ai as { h: number }).h };
  }
  return r;
}

/* ───────────────────────── AI designer (first page, accept, size warning, submit) ───────────────────────── */

/** The first page is done once a shape is chosen and, when the site designs the sticker, the size is valid. */
export function shapeStepOk(p: { shape: Shape | null; mode: BuilderMode; sizeOk: boolean }): boolean {
  return p.shape !== null && (p.mode === 'upload' || p.sizeOk);
}

/** Browser twin of the server's aiAspectOk (prompt-template.ts is server-only): rectangles up to AI_MAX_ASPECT : 1. */
export function aiRatioOk(shape: Shape, widthUm: number, heightUm: number): boolean {
  if (shape !== 'rect') return true;
  const long = Math.max(widthUm, heightUm);
  const short = Math.min(widthUm, heightUm);
  return short > 0 && long / short <= AI_MAX_ASPECT;
}

export type GenerateBlock = 'shape' | 'size' | 'aspect' | 'idea' | 'unavailable' | 'busy';

/** Why «ولّد التصميم» is disabled, or null when it may run. 'aspect' shows builder.ai.aspect. */
export function generateBlock(p: {
  shape: Shape | null;
  size: { widthUm: number; heightUm: number } | null;
  sizeOk: boolean;
  idea: string;
  unavailable: boolean;
  busy: boolean;
}): GenerateBlock | null {
  if (p.unavailable) return 'unavailable';
  if (!p.shape) return 'shape';
  if (!p.size || !p.sizeOk) return 'size';
  if (!aiRatioOk(p.shape, p.size.widthUm, p.size.heightUm)) return 'aspect';
  if (!p.idea.trim()) return 'idea';
  if (p.busy) return 'busy';
  return null;
}

/**
 * Sticker size after an AI design is accepted. `typed` is the size the design was made for, `aspect` the decoded
 * design's width / height. Custom: the typed size is a square box and the LONGER side of the trimmed design keeps it.
 * Circle and rect: the width is kept and the height follows the image (the aspect lock, as for an upload).
 */
export function aiAcceptedSize(shape: Shape, typed: { widthUm: number; heightUm: number }, aspect: number): { widthUm: number; heightUm: number } {
  if (shape === 'custom' && Number.isFinite(aspect) && aspect > 0 && aspect < 1) {
    return deriveLockedSize(shape, aspect, { heightUm: Math.max(typed.widthUm, typed.heightUm) });
  }
  const side = shape === 'custom' ? Math.max(typed.widthUm, typed.heightUm) : typed.widthUm;
  return deriveLockedSize(shape, aspect, { widthUm: side });
}

/** How far a size may stray from the design's width / height (rounding of a derived side) before it counts as another ratio. */
const AI_RATIO_TOLERANCE = 0.02;

/**
 * True when `size` no longer has the design's ratio `aspect` (width / height): on page 1 an AI rectangle's sides are
 * typed freely for a new idea, so leaving that page without a new accept must lock the size to the design again.
 */
export function aiSizeDrifted(size: { widthUm: number; heightUm: number } | null, aspect: number): boolean {
  if (!size || !(size.widthUm > 0) || !(size.heightUm > 0) || !Number.isFinite(aspect) || !(aspect > 0)) return false;
  return Math.abs(size.widthUm / size.heightUm / aspect - 1) > AI_RATIO_TOLERANCE;
}

/** True when the ordered size is smaller (in either direction) than the size the AI design was accepted at. */
export function aiShrinkWarning(ai: { w: number; h: number } | null, size: { widthUm: number; heightUm: number } | null): boolean {
  if (!ai || !size) return false;
  return size.widthUm < ai.w || size.heightUm < ai.h;
}

/** The upload id to reuse at submit: the accepted AI design's, only while the current design is that very file. */
export function seedUploadId(p: { aiUploadId: string | null; aiFileId: string | null; fileId: string | null }): string | undefined {
  return p.aiUploadId && p.aiFileId && p.fileId === p.aiFileId ? p.aiUploadId : undefined;
}

/** How far the customer may go from step 0: the index of the first step that is not done yet (never past the last step). */
export function furthestStep(ok: Record<StepId, boolean>): number {
  let i = 0;
  while (i < STEPS.length - 1 && ok[STEPS[i]]) i++;
  return i;
}

/** The step to open after a restore: the saved one, but never further than `furthest` (see furthestStep). Junk gives 0. */
export function clampStep(saved: unknown, furthest: number): number {
  if (typeof saved !== 'number' || !Number.isInteger(saved)) return 0;
  return Math.max(0, Math.min(saved, furthest, STEPS.length - 1));
}

/** True when a saved timestamp is missing, unreadable, or further than `ttl` from `now` (either direction: a clock that jumped). */
export function isDraftExpired(savedAt: unknown, now: number, ttl: number = DRAFT_TTL_MS): boolean {
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return true;
  return Math.abs(now - savedAt) > ttl;
}

/** Reads the localStorage draft envelope. `form` is null when it is junk or expired; `expired` tells the caller to delete it. */
export function parseDraft(raw: string | null | undefined, now: number): { form: Partial<PersistedForm> | null; expired: boolean } {
  if (!raw) return { form: null, expired: false };
  try {
    const v = JSON.parse(raw) as { savedAt?: unknown; form?: unknown } | null;
    if (!v || typeof v !== 'object') return { form: null, expired: false };
    if (isDraftExpired(v.savedAt, now)) return { form: null, expired: true };
    const f = v.form;
    return { form: f && typeof f === 'object' && !Array.isArray(f) ? (f as Partial<PersistedForm>) : null, expired: false };
  } catch {
    return { form: null, expired: false };
  }
}

/* ───────────────────────── quantity (stickers, priced in sheets) ───────────────────────── */

/** Typed text → number (accepts Arabic-Indic digits). null when empty or not a number. */
export function parseSheets(text: string): number | null {
  const t = normaliseDigits(text).trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null; // rejects '', '1e2', '0x10', 'Infinity'
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Thousands written in groups of three: '1,080', '١٬٠٨٠' (U+066C), '1 080'. '12,5' is not one. */
const GROUPED = /^-?\d{1,3}(?:[,٬  ]\d{3})+(?:\.\d+)?$/;

/**
 * Sticker count the customer typed: parseSheets() that also accepts thousands grouping
 * ('1,080', '١٬٠٨٠', '1 080'), since counts now run to 4-7 digits. Anything else parses as parseSheets.
 */
export function parseStickers(text: string): number | null {
  const t = normaliseDigits(text).trim();
  return parseSheets(GROUPED.test(t) ? t.replace(/[,٬  ]/g, '') : t);
}

/** Nearest orderable whole number of sheets within min..max. */
export function clampSheets(n: number, pricing: Pick<PricingSettings, 'minSheets' | 'maxSheets'>): number {
  const r = Number.isFinite(n) ? Math.round(n) : pricing.minSheets;
  return Math.min(pricing.maxSheets, Math.max(pricing.minSheets, r));
}

/** Quick-pick values in SHEETS that are orderable (min..max), unique, ascending. */
export function quickPicksFor(pricing: Pick<PricingSettings, 'minSheets' | 'maxSheets' | 'quickPicks'>): number[] {
  const ok = pricing.quickPicks.filter((n) => Number.isInteger(n) && n >= pricing.minSheets && n <= pricing.maxSheets);
  return [...new Set(ok)].sort((a, b) => a - b);
}

/** Quick-pick buttons in STICKERS: each stored sheet pick × countPerSheet. Empty without a usable layout. */
export function quickPickStickers(
  pricing: Pick<PricingSettings, 'minSheets' | 'maxSheets' | 'quickPicks'>,
  countPerSheet: number,
): number[] {
  if (!(Number.isInteger(countPerSheet) && countPerSheet > 0)) return [];
  const max = maxStickers(countPerSheet, pricing);
  return quickPicksFor(pricing)
    .map((n) => n * countPerSheet)
    .filter((n) => n <= max);
}

/**
 * The − / + buttons: move to the next (dir 1) or previous (dir -1) whole sheet of stickers.
 * From any value (typed 600 at 54 per sheet) they snap to a multiple of countPerSheet strictly
 * above / below it, clamped to the orderable range. `current` null or unusable starts from the minimum.
 */
export function stepStickers(
  current: number | null,
  dir: 1 | -1,
  countPerSheet: number,
  pricing: Pick<PricingSettings, 'minSheets' | 'maxSheets'>,
): number {
  if (!(Number.isInteger(countPerSheet) && countPerSheet > 0)) return current ?? 0;
  const from = current !== null && Number.isFinite(current) ? current : pricing.minSheets * countPerSheet;
  const sheets = dir === 1 ? Math.floor(from / countPerSheet) + 1 : Math.ceil(from / countPerSheet) - 1;
  // maxStickers() can hold fewer sheets than maxSheets (the request cap): never step past it.
  const topSheets = maxStickers(countPerSheet, pricing) / countPerSheet;
  return Math.min(clampSheets(sheets, pricing), topSheets) * countPerSheet;
}

// The tier helpers live with the rest of the pricing rules; re-exported for existing importers.
export { activeTier, sortedTiers };

/**
 * "Add N sheets and get X% off": only when the next tier gives a better discount and is close
 * (<= 5 sheets, or <= 25% of that tier's threshold). Counts SHEETS; see nextTierNudgeStickers.
 */
export function nextTierNudge(sheets: number | null, tiers: readonly DiscountTier[]): { add: number; percent: number } | null {
  if (sheets === null || !Number.isInteger(sheets)) return null;
  const current = activeTier(sheets, tiers)?.percent ?? 0;
  const next = sortedTiers(tiers).find((t) => t.minSheets > sheets && t.percent > current);
  if (!next) return null;
  const add = next.minSheets - sheets;
  return add <= Math.max(5, Math.ceil(next.minSheets * 0.25)) ? { add, percent: next.percent } : null;
}

/**
 * The nudge in STICKERS: "is it close" is decided on the rounded-up sheets (nextTierNudge), the
 * number shown is how many more stickers reach the tier: nextTier.minSheets × countPerSheet − stickers.
 */
export function nextTierNudgeStickers(
  stickers: number | null,
  sheets: number | null,
  countPerSheet: number,
  tiers: readonly DiscountTier[],
): { add: number; percent: number } | null {
  if (stickers === null || sheets === null || !Number.isInteger(stickers) || !(countPerSheet > 0)) return null;
  const n = nextTierNudge(sheets, tiers);
  return n ? { add: (sheets + n.add) * countPerSheet - stickers, percent: n.percent } : null;
}

/** What the sticker box holds: what the customer typed, else the minimum for this layout ('' without one). */
export function stickersTextFor(typed: string | null, countPerSheet: number | null, pricing: PricingSettings): string {
  if (typed !== null) return typed;
  return countPerSheet === null ? '' : String(minStickers(countPerSheet, pricing));
}

/* ───────────────────────── browser storage (all try/catch) ───────────────────────── */

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveForm(form: PersistedForm): void {
  try {
    store()?.setItem(FORM_KEY, JSON.stringify(form));
  } catch {
    /* storage unavailable */
  }
}

export function loadForm(): Partial<PersistedForm> | null {
  try {
    const raw = store()?.getItem(FORM_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Partial<PersistedForm>) : null;
  } catch {
    return null;
  }
}

export function clearForm(): void {
  try {
    store()?.removeItem(FORM_KEY);
  } catch {
    /* ignore */
  }
}

function localStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The fields that identify the customer. They are never written to localStorage (see saveDraft). */
const PERSONAL_KEYS = ['name', 'phone', 'governorate', 'district', 'landmark', 'notes'] as const;

/** The form without the customer's personal fields: what is allowed to outlive the tab. */
export function withoutPersonal(form: PersistedForm): PersistedForm {
  return { ...form, ...EMPTY_FIELDS };
}

/**
 * Saves the in-progress order. localStorage keeps the order (shape, size, quantity, step, design id) for
 * DRAFT_TTL_MS across tab closes, but NOT the name, phone and address: those stay in sessionStorage (FORM_KEY,
 * the full form) so they survive a reload and vanish with the tab (a shared phone must not show them to the next person).
 */
export function saveDraft(form: PersistedForm, now: number = Date.now()): void {
  saveForm(form);
  try {
    localStore()?.setItem(DRAFT_KEY, JSON.stringify({ v: 1, savedAt: now, form: withoutPersonal(form) }));
  } catch {
    /* storage unavailable or full */
  }
}

/**
 * The saved order: the fresh localStorage draft (an expired one is deleted) with the personal fields of this
 * tab's sessionStorage form merged in, else the sessionStorage form alone.
 */
export function loadDraft(now: number = Date.now()): Partial<PersistedForm> | null {
  const session = loadForm();
  try {
    const raw = localStore()?.getItem(DRAFT_KEY);
    const d = parseDraft(raw, now);
    if (d.expired) {
      clearDraft();
      return null;
    }
    if (d.form) {
      const merged: Partial<PersistedForm> = { ...d.form };
      if (session) for (const k of PERSONAL_KEYS) if (typeof session[k] === 'string') merged[k] = session[k];
      return merged;
    }
  } catch {
    /* fall through to sessionStorage */
  }
  return session;
}

export function clearDraft(): void {
  clearForm();
  try {
    localStore()?.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export function saveSuccess(res: OrderOk): void {
  try {
    store()?.setItem(SUCCESS_KEY, JSON.stringify(res));
  } catch {
    /* ignore */
  }
}

export function loadSuccess(): OrderOk | null {
  try {
    const raw = store()?.getItem(SUCCESS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as OrderResponse;
    return v && v.ok === true && typeof v.displayNo === 'string' ? v : null;
  } catch {
    return null;
  }
}
