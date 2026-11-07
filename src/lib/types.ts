/**
 * SHARED CONTRACTS — FROZEN during Phase 1.
 *
 * Every agent codes against these types. Do not add, rename or remove fields
 * here; if you truly need a change, describe it in your final report and the
 * orchestrator will apply it at integration. See docs/PLAN.md §2–§6 for the
 * rules behind each type.
 *
 * Units: all `…Um` fields are INTEGER micrometres (see src/lib/units.ts).
 * Page coordinates: origin at the TOP-LEFT of the A4 page, y grows DOWN.
 * (PDF coordinates are bottom-left/up; the PDF builder converts.)
 */

/* ────────────────────────────── Sticker spec ───────────────────────────── */

export type Shape = 'circle' | 'rect' | 'custom';
export type Corners = 'rounded' | 'sharp';

/** What the customer ordered, after size entry. */
export interface StickerSpec {
  shape: Shape;
  /** Required when shape === 'rect'; ignored otherwise. */
  corners?: Corners;
  /** Sticker width in µm. For a circle this is the diameter. */
  widthUm: number;
  /** Sticker height in µm. For a circle this equals widthUm. */
  heightUm: number;
}

/* ────────────────────────────── Layout engine ──────────────────────────── */

export type ClipShape =
  | { kind: 'none' }
  | { kind: 'circle' }
  | { kind: 'roundedRect'; radiusUm: number };

/** Inputs to the layout engine that come from settings, not from the customer. */
export interface LayoutParams {
  marginUm: number;
  /** Gap between COLUMNS (horizontal, page axis). Never rotates with the sticker. */
  gapXUm: number;
  /** Gap between ROWS (vertical, page axis). Never rotates with the sticker. */
  gapYUm: number;
  /** When true the engine also tries the 90°-rotated cell and keeps the better count (ties → upright). */
  allowRotate: boolean;
  /** Smallest allowed side, in µm (default 5 000 = 5 mm). */
  minSideUm: number;
  /** Clip applied to the artwork in each cell (preview + PDF). */
  clip: ClipShape;
}

export interface Placement {
  /** Top-left corner of the cell, from the page's top-left, in µm. */
  xUm: number;
  yUm: number;
  /**
   * Mixed layouts only: this cell is `layout.cell` turned 90° (width/height swapped).
   * Its artwork is turned 90° clockwise iff `layout.rotated !== turned` (art follows the
   * cell's orientation). Absent = same orientation as `layout.cell`.
   */
  turned?: true;
}

export interface LayoutResult {
  page: { widthUm: number; heightUm: number };
  marginUm: number;
  /** Printable area = page minus margins. */
  usable: { xUm: number; yUm: number; widthUm: number; heightUm: number };
  /** Cell size actually used (swapped w/h when rotated). Placements with `turned` use it swapped. */
  cell: { widthUm: number; heightUm: number };
  /** Orientation of the main block. Mixed layouts also carry `turned` placements. */
  rotated: boolean;
  /** Number of placements with `turned: true` (0 for a uniform grid). */
  turnedCount: number;
  gapXUm: number;
  gapYUm: number;
  /** Grid of the main block (the largest uniform block in a mixed layout). */
  cols: number;
  rows: number;
  countPerSheet: number;
  /** Bounding box of the whole centred block of cells. */
  block: { xUm: number; yUm: number; widthUm: number; heightUm: number };
  /** Row-major: row 0 left→right, then row 1, … Length === countPerSheet. */
  placements: Placement[];
  clip: ClipShape;
}

export type LayoutFailure = 'too_small' | 'too_big_for_page' | 'ratio_extreme' | 'invalid';

export type LayoutOutcome =
  | { ok: true; layout: LayoutResult }
  | { ok: false; reason: LayoutFailure };

/* ────────────────────────────── Design / artwork ───────────────────────── */

export type DesignKind = 'png' | 'jpeg' | 'pdf';

/** Pixel box inside the ORIGINAL decoded raster (after EXIF orientation). */
export interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Client-side normalised view of an uploaded design. Produced by
 * `decodeDesign()` (src/lib/design/decode.client.ts). The aspect ratio used
 * for the size lock is ALWAYS `pxWidth / pxHeight` of this object.
 */
export interface DesignSource {
  kind: DesignKind;
  /** The untouched file the user picked; this is what gets uploaded. */
  file: File;
  /** Dimensions of the normalised artwork box (EXIF applied, alpha-trimmed for custom, PDF crop box). */
  pxWidth: number;
  pxHeight: number;
  hasAlpha: boolean;
  /** Object URL of a normalised raster (PNG/JPEG) for on-screen preview only. Caller revokes it. */
  previewUrl: string;
  /** Present for PDFs: page count and physical page-1 box in PDF points (after /Rotate). */
  pdf?: { pageCount: number; pageWidthPt: number; pageHeightPt: number };
  /** Present when the artwork box is a sub-rectangle of the original raster (custom-shape alpha trim). */
  trim?: PixelBox;
}

export type DesignDecodeError =
  | 'unsupported_type'
  | 'too_large'
  | 'corrupt'
  | 'encrypted'
  | 'no_alpha'
  | 'empty';

export type DesignDecodeOutcome =
  | { ok: true; source: DesignSource }
  | { ok: false; error: DesignDecodeError };

/**
 * Server-side print-ready artwork. Produced by `normaliseArtwork()`
 * (src/lib/design/normalise.server.ts) and consumed by `buildSheetPdf()`.
 */
export type NormalisedArtwork =
  | {
      kind: 'raster';
      /** PNG (when alpha) or JPEG bytes, already resampled to the target DPI for the ordered size. */
      bytes: Uint8Array;
      mime: 'image/png' | 'image/jpeg';
      pxWidth: number;
      pxHeight: number;
      hasAlpha: boolean;
      /** Resolution of the ORIGINAL upload over the ordered size (quality signal). */
      effectiveDpi: number;
    }
  | {
      kind: 'pdf';
      /** The original PDF bytes (page 1 is embedded as vector). */
      bytes: Uint8Array;
      /** Box to embed, in PDF points of page 1 (CropBox/TrimBox, after /Rotate). */
      box: { x: number; y: number; width: number; height: number };
      /** /Rotate of page 1 in degrees (0, 90, 180, 270). */
      rotate: 0 | 90 | 180 | 270;
      pageCount: number;
    };

/* ────────────────────────────── PDF builder ────────────────────────────── */

export interface SheetPdfMeta {
  displayNo: string;
  /** Short ASCII description for PDF metadata, e.g. "circle 30x30mm x54". */
  description: string;
}

export interface PdfReport {
  pageWidthPt: number;
  pageHeightPt: number;
  /** Number of image/form XObject draws in the content stream. Must equal layout.countPerSheet. */
  drawCount: number;
  /** Cell rectangles in PDF points, bottom-left origin, same order as layout.placements. */
  placementsPt: { x: number; y: number; w: number; h: number }[];
  clipped: boolean;
  bytes: number;
}

export interface SheetPdfInput {
  layout: LayoutResult;
  artwork: NormalisedArtwork;
  meta: SheetPdfMeta;
}

export interface SheetPdfOutput {
  bytes: Uint8Array;
  report: PdfReport;
}

/* ────────────────────────────── Offers / settings ──────────────────────── */

export interface Offer {
  id: string;
  sheets: number;
  /** Iraqi dinar. null = price not set yet → UI shows «السعر يُحدد عند التأكيد». */
  priceIqd: number | null;
  /** Optional badge text, e.g. «الأكثر طلباً». */
  badge?: string;
  enabled: boolean;
}

export interface LayoutSettings {
  marginUm: number;
  circleGapXUm: number;
  circleGapYUm: number;
  rectRoundedGapUm: number;
  rectSharpGapUm: number;
  customGapUm: number;
  roundedRadiusUm: number;
  allowRotate: boolean;
  minSideUm: number;
}

export interface QualitySettings {
  /** Show a warning below this effective DPI. */
  warnDpi: number;
  /** Refuse the order below this effective DPI. */
  blockDpi: number;
  /** Resample rasters to this DPI for print. */
  targetDpi: number;
}

/** Everything the owner can edit in the admin dashboard. Stored via StorageAdapter. */
export interface ShopSettings {
  shopName: string;
  tagline: string;
  /** International digits only, no plus, e.g. "9647701234567". Empty string = not set. */
  whatsapp: string;
  /** Display phone, free text. */
  phone: string;
  hours: string;
  area: string;
  /** Telegram chat id that receives orders. Empty = Telegram disabled. */
  telegramChatId: string;
  offers: Offer[];
  deliveryFeeIqd: number;
  /** When false, all offer prices are hidden even if set. */
  pricesPublished: boolean;
  layout: LayoutSettings;
  quality: QualitySettings;
  maxUploadBytes: number;
  retentionDays: number;
}

/* ────────────────────────────── Pricing ────────────────────────────────── */

export interface PriceBreakdown {
  offerPriceIqd: number | null;
  deliveryFeeIqd: number;
  /** null when the offer price is not set / not published. */
  totalIqd: number | null;
  /** sheets × countPerSheet */
  totalStickers: number;
  /** totalIqd / totalStickers, rounded to the dinar; null when totalIqd is null. */
  perStickerIqd: number | null;
}

/* ────────────────────────────── Orders ─────────────────────────────────── */

export interface CustomerInfo {
  name?: string;
  /** Normalised E.164 without plus: "9647XXXXXXXXX" (13 digits). */
  phone: string;
  governorate: string;
  district: string;
  landmark: string;
  notes?: string;
}

/** Body of POST /api/orders (JSON). The design was uploaded earlier via POST /api/upload. */
export interface OrderRequest {
  /** Client-generated nanoid(21); idempotency key. */
  orderId: string;
  /** Returned by POST /api/upload. */
  uploadId: string;
  spec: StickerSpec;
  offerId: string;
  customer: CustomerInfo;
  /** Optional Turnstile token (enforced only when the server has a secret configured). */
  turnstileToken?: string;
}

export type OrderStatus = 'new' | 'printing' | 'done' | 'cancelled';

export interface OrderSummary {
  displayNo: string;
  shape: Shape;
  corners?: Corners;
  widthUm: number;
  heightUm: number;
  countPerSheet: number;
  sheets: number;
  totalStickers: number;
  offerPriceIqd: number | null;
  deliveryFeeIqd: number;
  totalIqd: number | null;
}

export interface OrderRecord {
  orderId: string;
  /** Human-friendly: EP-YYMMDD-XXXX (alphabet without 0/O/1/I). */
  displayNo: string;
  /** ISO 8601, UTC. Display in Asia/Baghdad. */
  createdAt: string;
  status: OrderStatus;
  spec: StickerSpec;
  layout: {
    cols: number;
    rows: number;
    countPerSheet: number;
    rotated: boolean;
    /** Stickers turned against the main block (mixed layout). Absent on older orders. */
    turnedCount?: number;
    cellWidthUm: number;
    cellHeightUm: number;
    gapXUm: number;
    gapYUm: number;
  };
  design: {
    kind: DesignKind;
    originalName: string;
    bytes: number;
    pxWidth: number;
    pxHeight: number;
    /** Undefined for vector PDFs. */
    effectiveDpi?: number;
  };
  offer: { id: string; sheets: number; priceIqd: number | null };
  price: PriceBreakdown;
  customer: CustomerInfo;
  files: {
    /** Storage path of the original upload. */
    designPath: string;
    /** Storage path of the generated A4 PDF. */
    pdfPath: string;
  };
  notified: { telegram: 'sent' | 'failed' | 'skipped' };
}

export type OrderError =
  | 'invalid_request'
  | 'upload_missing'
  | 'invalid_offer'
  | 'invalid_phone'
  | 'too_small'
  | 'too_big_for_page'
  | 'ratio_extreme'
  | 'low_dpi'
  | 'no_alpha'
  | 'unsupported_type'
  | 'corrupt'
  | 'encrypted'
  | 'needs_raster'
  | 'rate_limited'
  | 'captcha_failed'
  | 'server_error';

export type OrderResponse =
  | {
      ok: true;
      orderId: string;
      displayNo: string;
      summary: OrderSummary;
      /** wa.me link with the pre-filled Arabic summary; empty string when the shop has no WhatsApp set. */
      whatsappUrl: string;
      notified: OrderRecord['notified'];
    }
  | { ok: false; error: OrderError; message: string };

/* ────────────────────────────── Upload API ─────────────────────────────── */

export type UploadError = 'unsupported_type' | 'too_large' | 'corrupt' | 'rate_limited' | 'server_error';

export type UploadResponse =
  | { ok: true; uploadId: string; kind: DesignKind; bytes: number }
  | { ok: false; error: UploadError; message: string };

/**
 * POST /api/upload/direct (JSON `{ size, name }`). `direct`: PUT the file to `url`, then
 * POST /api/upload/direct/commit `{ uploadId, name }` (→ UploadResponse). `server`: the
 * storage has a disk, use the classic multipart POST /api/upload.
 */
export type DirectUploadStart =
  | { ok: true; mode: 'direct'; uploadId: string; url: string }
  | { ok: true; mode: 'server' }
  | { ok: false; error: UploadError; message: string };

/* ────────────────────────────── Storage adapter ────────────────────────── */

export interface StoredFileMeta {
  mime: string;
  originalName: string;
  bytes: number;
  /** ISO 8601 */
  createdAt: string;
}

export interface StorageAdapter {
  /** Save a customer upload under `uploadId`. Returns the storage path. */
  saveUpload(uploadId: string, bytes: Uint8Array, meta: StoredFileMeta): Promise<string>;
  readUpload(uploadId: string): Promise<{ bytes: Uint8Array; meta: StoredFileMeta } | null>;
  /** Save the generated sheet PDF for an order. Returns the storage path. */
  savePdf(orderId: string, bytes: Uint8Array): Promise<string>;
  /** Read any file by the storage path returned from saveUpload/savePdf. */
  readFile(path: string): Promise<Uint8Array | null>;
  deleteFile(path: string): Promise<void>;

  saveOrder(record: OrderRecord): Promise<void>;
  getOrder(orderId: string): Promise<OrderRecord | null>;
  /** Newest first. */
  listOrders(): Promise<OrderRecord[]>;
  updateOrder(orderId: string, patch: Partial<Pick<OrderRecord, 'status' | 'notified'>>): Promise<OrderRecord | null>;

  /** Returns defaults merged with whatever the owner saved. */
  getSettings(): Promise<ShopSettings>;
  saveSettings(settings: ShopSettings): Promise<void>;

  /**
   * Optional (cloud storage): one-time signed URL the BROWSER PUTs the file to, landing at
   * uploads/<uploadId>.bin. The server must validate the bytes before writing the meta.
   */
  createDirectUpload?(uploadId: string): Promise<string>;
  /** Hard size limit of the bucket behind createDirectUpload (bytes). */
  readonly directUploadMaxBytes?: number;
  /** Optional: write only the meta of a direct upload whose bytes the server has checked. */
  saveUploadMeta?(uploadId: string, meta: StoredFileMeta): Promise<void>;
  /** Optional: short-lived signed download URL for an admin download. */
  signedDownloadUrl?(path: string, downloadName: string, expiresInSec?: number): Promise<string | null>;
}

/* ────────────────────────────── Notification ───────────────────────────── */

export interface NotifyResult {
  telegram: 'sent' | 'failed' | 'skipped';
  error?: string;
}

/* ────────────────────────────── Client logging ─────────────────────────── */

export interface ClientLogEvent {
  step: 'decode' | 'preview' | 'upload' | 'order' | 'other';
  message: string;
  fileType?: string;
  fileSize?: number;
  userAgent?: string;
}
