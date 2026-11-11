/**
 * Builder helpers with no React, unit-tested in Node. Everything here is pure except the
 * sessionStorage section at the bottom, which is this module's only I/O.
 */
import { effectiveDpi, ptToUm } from '@/lib/units';
import { widthPixelsFor } from '@/lib/design/pixels';
import { normaliseDigits } from '@/lib/parse/digits';
import { normalisePhone } from '@/lib/parse/phone';
import { activeTier, sortedTiers } from '@/lib/pricing';
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
  sheetsText: string;
}

export const EMPTY_FIELDS: FormFields = { name: '', phone: '', governorate: '', district: '', landmark: '', notes: '' };

export const FORM_KEY = 'ub:form:v1';
export const SUCCESS_KEY = 'ub:order-success:v1';

export type DpiStatus = 'ok' | 'warn' | 'block';

/** Unrounded effective DPI over the ordered width (what the server gates on). null for vector PDFs. */
export function dpiExact(design: DesignSource, spec: StickerSpec): number | null {
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
export function dpiFor(design: DesignSource, spec: StickerSpec): number | null {
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
  landmark?: boolean;
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
  if (!f.landmark.trim()) errors.landmark = true;
  return { errors, phoneE164 };
}

/** DOM ids of the validated customer inputs, in form order (the first invalid one gets the focus). */
export const CUSTOMER_FIELD_IDS = {
  phone: 'cust-phone',
  governorate: 'cust-gov',
  district: 'cust-district',
  landmark: 'cust-landmark',
} as const satisfies Record<keyof CustomerErrors, string>;

/** The `customer` block of the order request, built from the form and the validated phone. */
export function toCustomerInfo(f: FormFields, phoneE164: string): CustomerInfo {
  return {
    name: f.name.trim() || undefined,
    phone: phoneE164,
    governorate: f.governorate,
    district: f.district.trim(),
    landmark: f.landmark.trim(),
    notes: f.notes.trim() || undefined,
  };
}

export type SummaryData = Omit<OrderSummary, 'displayNo'>;

export function buildSummary(spec: StickerSpec, layout: LayoutResult, price: PriceBreakdown): SummaryData {
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
  sheetsText?: string;
  fields: FormFields;
}

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
  if (typeof saved.sheetsText === 'string' && saved.sheetsText.trim()) r.sheetsText = saved.sheetsText;
  return r;
}

/* ───────────────────────── quantity (sheets) ───────────────────────── */

/** Typed text → number (accepts Arabic-Indic digits). null when empty or not a number. */
export function parseSheets(text: string): number | null {
  const t = normaliseDigits(text).trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null; // rejects '', '1e2', '0x10', 'Infinity'
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Nearest orderable whole number within min..max (used by the − / + buttons). */
export function clampSheets(n: number, pricing: Pick<PricingSettings, 'minSheets' | 'maxSheets'>): number {
  const r = Number.isFinite(n) ? Math.round(n) : pricing.minSheets;
  return Math.min(pricing.maxSheets, Math.max(pricing.minSheets, r));
}

/** Quick-pick values that are orderable (min..max), unique, ascending. */
export function quickPicksFor(pricing: Pick<PricingSettings, 'minSheets' | 'maxSheets' | 'quickPicks'>): number[] {
  const ok = pricing.quickPicks.filter((n) => Number.isInteger(n) && n >= pricing.minSheets && n <= pricing.maxSheets);
  return [...new Set(ok)].sort((a, b) => a - b);
}

// The tier helpers live with the rest of the pricing rules; re-exported for existing importers.
export { activeTier, sortedTiers };

/**
 * "Add N sheets and get X% off": only when the next tier gives a better discount and is close
 * (<= 5 sheets, or <= 25% of that tier's threshold).
 */
export function nextTierNudge(sheets: number | null, tiers: readonly DiscountTier[]): { add: number; percent: number } | null {
  if (sheets === null || !Number.isInteger(sheets)) return null;
  const current = activeTier(sheets, tiers)?.percent ?? 0;
  const next = sortedTiers(tiers).find((t) => t.minSheets > sheets && t.percent > current);
  if (!next) return null;
  const add = next.minSheets - sheets;
  return add <= Math.max(5, Math.ceil(next.minSheets * 0.25)) ? { add, percent: next.percent } : null;
}

/* ───────────────────────── sessionStorage (all try/catch) ───────────────────────── */

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
