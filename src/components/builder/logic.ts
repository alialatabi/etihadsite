/** Pure helpers for the builder (no React). Unit-tested in Node. */
import { effectiveDpi, ptToUm } from '@/lib/units';
import { normalisePhone } from '@/lib/parse/phone';
import type {
  Corners,
  DesignSource,
  LayoutResult,
  Offer,
  OrderResponse,
  OrderSummary,
  PriceBreakdown,
  QualitySettings,
  Shape,
  StickerSpec,
} from '@/lib/types';

export const STEPS = ['shape', 'design', 'size', 'offer', 'details'] as const;
export type StepId = (typeof STEPS)[number];

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
  offerId: string | null;
}

export const EMPTY_FIELDS: FormFields = { name: '', phone: '', governorate: '', district: '', landmark: '', notes: '' };

export const FORM_KEY = 'ub:form:v1';
export const SUCCESS_KEY = 'ub:order-success:v1';

export type DpiStatus = 'ok' | 'warn' | 'block';

/** Effective DPI of the artwork over the ordered width. null for vector PDFs. */
export function dpiFor(design: DesignSource, spec: StickerSpec): number | null {
  if (design.kind === 'pdf') return null;
  // A circle is centre-cropped to the shorter side of the artwork.
  const px = spec.shape === 'circle' ? Math.min(design.pxWidth, design.pxHeight) : design.pxWidth;
  if (!(spec.widthUm > 0)) return null;
  return Math.round(effectiveDpi(px, spec.widthUm));
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

export type SummaryData = Omit<OrderSummary, 'displayNo'>;

export function buildSummary(spec: StickerSpec, layout: LayoutResult, offer: Offer, price: PriceBreakdown): SummaryData {
  return {
    shape: spec.shape,
    corners: spec.shape === 'rect' ? spec.corners : undefined,
    widthUm: spec.widthUm,
    heightUm: spec.heightUm,
    countPerSheet: layout.countPerSheet,
    sheets: offer.sheets,
    totalStickers: price.totalStickers,
    offerPriceIqd: price.offerPriceIqd,
    deliveryFeeIqd: price.deliveryFeeIqd,
    totalIqd: price.totalIqd,
  };
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

export function saveSuccess(res: Extract<OrderResponse, { ok: true }>): void {
  try {
    store()?.setItem(SUCCESS_KEY, JSON.stringify(res));
  } catch {
    /* ignore */
  }
}

export function loadSuccess(): Extract<OrderResponse, { ok: true }> | null {
  try {
    const raw = store()?.getItem(SUCCESS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as OrderResponse;
    return v && v.ok === true && typeof v.displayNo === 'string' ? v : null;
  } catch {
    return null;
  }
}
