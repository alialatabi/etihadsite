/**
 * Shared contract: the types (and a few runtime vocabulary lists) that the
 * builder, the API routes, the storage adapters and the PDF pipeline all code
 * against. Changing a shape here changes stored JSON (orders, settings,
 * customers, analytics events) and API payloads, so treat an edit as a data
 * and API change, not as a local refactor.
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
  /**
   * When true the engine also tries the 90°-rotated cell and keeps the better count (ties → upright),
   * and it may return a mixed layout (some cells turned 90°, see `Placement.turned`) when that fits
   * strictly more stickers than either uniform grid.
   */
  allowRotate: boolean;
  /** Smallest allowed side, in µm (default 5 000 = 5 mm). */
  minSideUm: number;
  /** Clip applied to the artwork in each cell (preview + PDF). */
  clip: ClipShape;
  /**
   * The 4 camera-cutter dots (see src/lib/layout/marks.ts). When present, no sticker is placed
   * near a dot and the result carries `marks` + `removedNearMarks`. Absent = today's layout exactly.
   */
  marks?: RegMarks;
}

/** Registration dots for the camera cutter, one in each page corner (integer µm). */
export interface RegMarks {
  /** Dot centre from each of the two nearest page edges. */
  offsetUm: number;
  diameterUm: number;
  /** Minimum white space between the dot's edge and any printed part of a sticker. */
  clearanceUm: number;
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
  /**
   * Present iff the params had `marks`: the dots to draw (TL, TR, BL, BR). With marks, `usable` is
   * still page minus margin, `block`/`cols`/`rows` describe the chosen arrangement BEFORE cells near
   * a dot were removed, and `countPerSheet`/`turnedCount`/`placements` are AFTER removal.
   */
  marks?: { diameterUm: number; centres: { xUm: number; yUm: number }[] };
  /** Present iff the params had `marks`: how many cells were dropped for being near a dot (diagnostic). */
  removedNearMarks?: number;
}

export type LayoutFailure = 'too_small' | 'too_big_for_page' | 'ratio_extreme' | 'invalid';

export type LayoutOutcome =
  | { ok: true; layout: LayoutResult }
  | { ok: false; reason: LayoutFailure };

/* ───────────────────── Multi-design layout (one sheet, N designs) ───────────────────── */

/**
 * One design's cell on a multi-design sheet. `turned: true` = this cell is the design's cell with
 * width/height swapped and the art turned 90° clockwise.
 */
export interface MultiPlacement {
  /** Index into MultiLayoutResult.designs. */
  designIndex: number;
  xUm: number;
  yUm: number;
  turned?: true;
}

/** Size and clip of one design's (unturned) cell. */
export interface MultiLayoutDesign {
  cell: { widthUm: number; heightUm: number };
  clip: ClipShape;
}

/**
 * Result of laying out N designs on one A4 sheet, `perDesign` copies of EACH design.
 * Invariants: countPerSheet === designs.length × perDesign === placements.length;
 * placements sorted by y then x.
 */
export interface MultiLayoutResult {
  kind: 'multi';
  page: { widthUm: number; heightUm: number };
  marginUm: number;
  usable: { xUm: number; yUm: number; widthUm: number; heightUm: number };
  gapXUm: number;
  gapYUm: number;
  designs: MultiLayoutDesign[];
  /** Copies of each design on one sheet. */
  perDesign: number;
  countPerSheet: number;
  /** Bounding box of all cells. */
  block: { xUm: number; yUm: number; widthUm: number; heightUm: number };
  placements: MultiPlacement[];
  /** Cutter dots, same meaning as LayoutResult.marks. */
  marks?: { diameterUm: number; centres: { xUm: number; yUm: number }[] };
}

export type MultiLayoutOutcome =
  | { ok: true; layout: MultiLayoutResult }
  | { ok: false; reason: LayoutFailure; designIndex?: number };

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
      /**
       * Box to embed, in PDF points of page 1: the RAW, unrotated TrimBox (or CropBox when there is
       * no TrimBox). /Rotate is NOT applied here; the PDF builder applies `rotate` when it draws.
       */
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

/** Input of the multi-design sheet builder; artworks[i] belongs to layout.designs[i]. Output: SheetPdfOutput. */
export interface MultiSheetPdfInput {
  layout: MultiLayoutResult;
  artworks: NormalisedArtwork[];
  meta: SheetPdfMeta;
}

export interface SheetPdfOutput {
  bytes: Uint8Array;
  report: PdfReport;
}

/* ────────────────────────────── Offers / settings ──────────────────────── */

/** Sticker sheet material. The customer picks it together with the sheet count. */
export type Material = 'paper' | 'plastic';
export const MATERIALS: readonly Material[] = ['paper', 'plastic'];

export interface MaterialPrice {
  enabled: boolean;
  /** Full price of ONE A4 sheet, Iraqi dinar, before any volume discount. */
  pricePerSheetIqd: number;
}

/** From `minSheets` sheets upward the whole order gets `percent`% off the per-sheet price. */
export interface DiscountTier {
  minSheets: number;
  /** 0–90, integer. */
  percent: number;
}

/** Per-sheet pricing with volume discounts (replaces the old fixed "offers"/packages). */
export interface PricingSettings {
  materials: Record<Material, MaterialPrice>;
  /** Smallest order the shop accepts (owner: 10 sheets). */
  minSheets: number;
  /** Largest order the site accepts online (sanity cap). */
  maxSheets: number;
  /** Sorted ascending by minSheets on save; the highest tier with minSheets ≤ sheets applies. */
  tiers: DiscountTier[];
  /** Quick-pick buttons shown next to the number input, e.g. [10, 20, 50, 100]. */
  quickPicks: number[];
}

export interface LayoutSettings {
  /** General sheet margin. Since per-shape margins it is only the FALLBACK for a shape without its own margin below. */
  marginUm: number;
  /** Gap between circles along the page width. */
  circleGapXUm: number;
  /** Gap between circles along the page height. */
  circleGapYUm: number;
  /** Rounded rectangles: horizontal gap (and the vertical one while `rectRoundedGapYUm` is absent). */
  rectRoundedGapUm: number;
  /** Sharp rectangles: horizontal gap (and the vertical one while `rectSharpGapYUm` is absent). */
  rectSharpGapUm: number;
  /** Custom shapes: horizontal gap (and the vertical one while `customGapYUm` is absent). */
  customGapUm: number;
  /** Sheet margin for circles. Absent: `marginUm`. Read through `resolveShapeSpacing` (src/lib/layout/spacing.ts). */
  circleMarginUm?: number;
  /** Sheet margin for rounded rectangles. Absent: `marginUm`. */
  roundedMarginUm?: number;
  /** Sheet margin for sharp rectangles. Absent: `marginUm`. */
  sharpMarginUm?: number;
  /** Sheet margin for custom shapes. Absent: `marginUm`. */
  customMarginUm?: number;
  /** Rounded rectangles: vertical gap. Absent: `rectRoundedGapUm`. */
  rectRoundedGapYUm?: number;
  /** Sharp rectangles: vertical gap. Absent: `rectSharpGapUm`. */
  rectSharpGapYUm?: number;
  /** Custom shapes: vertical gap. Absent: `customGapUm`. */
  customGapYUm?: number;
  roundedRadiusUm: number;
  allowRotate: boolean;
  minSideUm: number;
}

export interface QualitySettings {
  /** Show a warning below this effective DPI. */
  warnDpi: number;
  /** Refuse the order below this effective DPI. */
  blockDpi: number;
  /** @deprecated Ignored since 2026-11-15: print resolution is fixed at PRINT_DPI (src/lib/print-dpi.ts). Kept so stored settings still parse. */
  targetDpi: number;
}

/** In-site AI sticker designer: on/off switch and daily generation limits. */
export interface AiSettings {
  enabled: boolean;
  /** Generations one visitor (by IP) may start per day. */
  perIpDailyLimit: number;
  /** Generations the whole site may start per day. */
  siteDailyLimit: number;
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
  pricing: PricingSettings;
  /** Flat delivery fee, same for every governorate. */
  deliveryFeeIqd: number;
  /** When false, all prices are hidden («السعر يُحدد عند التأكيد»). */
  pricesPublished: boolean;
  layout: LayoutSettings;
  quality: QualitySettings;
  maxUploadBytes: number;
  retentionDays: number;
  ai: AiSettings;
}

/* ────────────────────────────── Pricing ────────────────────────────────── */

export interface PriceBreakdown {
  material: Material;
  /** Sheets printed. For a sticker order: ceil(requestedStickers / countPerSheet). */
  sheets: number;
  /** Full per-sheet price before discount; null when prices are not published. */
  unitBaseIqd: number | null;
  /** Volume discount applied to every sheet (0 when none). */
  discountPercent: number;
  /** round(unitBaseIqd × (100 − discountPercent) / 100); null when not published. */
  unitPriceIqd: number | null;
  /**
   * Price of the sheets INCLUDING the final rounding: totalIqd − deliveryFeeIqd
   * (= unitPriceIqd × sheets + roundingIqd); null when not published.
   * Orders saved before 2026-11-11 have no rounding: there it is exactly unitPriceIqd × sheets.
   */
  subtotalIqd: number | null;
  deliveryFeeIqd: number;
  /**
   * What the customer pays: max(deliveryFeeIqd, unitPriceIqd × sheets + deliveryFeeIqd rounded to
   * the nearest PRICE_ROUND_IQD, see src/lib/pricing.ts); null when not published.
   * Orders saved before 2026-11-11 are not rounded.
   */
  totalIqd: number | null;
  /** sheets × countPerSheet: what the customer receives (the whole last sheet). */
  totalStickers: number;
  /** totalIqd / totalStickers, rounded to the dinar; null when totalIqd is null. */
  perStickerIqd: number | null;
  /**
   * totalIqd − (unitPriceIqd × sheets + deliveryFeeIqd): the final rounding, may be negative or 0;
   * null when not published. Absent on orders saved before 2026-11-11.
   */
  roundingIqd?: number | null;
  /** Sticker count the customer typed. Absent on sheet-count orders (all orders before 2026-11-11). */
  requestedStickers?: number;
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
  /**
   * The customer ticked «ابعثولي عروض وخصومات على الواتساب» on this order (optional, unticked by default).
   * Request: omitted = false. Stored on the order only when true, together with marketingOptInAt.
   */
  marketingOptIn?: boolean;
  /** ISO 8601 UTC: when the box was ticked (the order's createdAt). Only on a stored order that opted in. */
  marketingOptInAt?: string;
}

/** One design of a multi-design order: its upload and its OWN size (aspect-locked to its artwork). */
export interface OrderDesignRequest {
  /** Returned by POST /api/upload (or /api/upload/direct/commit). */
  uploadId: string;
  widthUm: number;
  heightUm: number;
}

/** Body of POST /api/orders (JSON). The design was uploaded earlier via POST /api/upload. */
export interface OrderRequest {
  /** Client-generated nanoid(21); idempotency key. */
  orderId: string;
  /** Returned by POST /api/upload, or by POST /api/upload/direct/commit after a direct upload. */
  uploadId: string;
  spec: StickerSpec;
  material: Material;
  /**
   * Sticker count the customer typed: integer, minSheets × countPerSheet ≤ stickers ≤
   * maxSheets × countPerSheet. When present the server IGNORES `sheets` and computes
   * sheets = ceil(stickers / countPerSheet) from its own layout. Sent by clients since 2026-11-11.
   */
  stickers?: number;
  /**
   * Sheet count (the request before 2026-11-11): integer, pricing.minSheets ≤ sheets ≤ pricing.maxSheets.
   * Used only when `stickers` is absent. At least one of `stickers` / `sheets` is required.
   */
  sheets?: number;
  customer: CustomerInfo;
  /** Optional Turnstile token (enforced only when the server has a secret configured). */
  turnstileToken?: string;
  /**
   * Multi-design orders ONLY: 2..MAX_DESIGNS entries. designs[0].uploadId === uploadId and
   * designs[0]'s size === spec size; every design shares spec.shape / spec.corners. `stickers` is
   * the ONE total count (equal split: each sheet holds the same number of each design).
   * Absent on single-design orders (the request stays byte-identical to before).
   */
  designs?: OrderDesignRequest[];
}

export type OrderStatus = 'new' | 'printing' | 'done' | 'cancelled';
/** Every OrderStatus, in workflow order (runtime list for validation and menus). */
export const ORDER_STATUSES = ['new', 'printing', 'done', 'cancelled'] as const satisfies readonly OrderStatus[];

export interface OrderSummary {
  displayNo: string;
  shape: Shape;
  corners?: Corners;
  widthUm: number;
  heightUm: number;
  countPerSheet: number;
  sheets: number;
  material: Material;
  totalStickers: number;
  unitPriceIqd: number | null;
  discountPercent: number;
  subtotalIqd: number | null;
  deliveryFeeIqd: number;
  totalIqd: number | null;
  /** Sticker count the customer typed (price.requestedStickers). Absent on sheet-count orders. */
  requestedStickers?: number;
  /** Multi-design orders only: every design's size, in upload order (designs[0] === widthUm/heightUm). */
  designs?: { widthUm: number; heightUm: number }[];
  /** Multi-design orders only: copies of EACH design on one sheet (countPerSheet = designs.length × perDesign). */
  perDesign?: number;
}

/** One design of a multi-design order as stored (designs[0] describes the same file as OrderRecord.design). */
export interface OrderDesignRecord {
  kind: DesignKind;
  originalName: string;
  bytes: number;
  pxWidth: number;
  pxHeight: number;
  /** Undefined for vector PDFs. */
  effectiveDpi?: number;
  widthUm: number;
  heightUm: number;
  /** True when the raster has a transparent background («مفرغ»). Added only when true. */
  cutOut?: boolean;
}

export interface OrderRecord {
  orderId: string;
  /** Human-friendly: EP-YYMMDD-XXXX (alphabet without 0/O/1/I). */
  displayNo: string;
  /** ISO 8601, UTC. Display in shop time (SHOP_TIME_ZONE, see src/lib/shop-time.ts). */
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
    /**
     * Multi-design orders only: number of designs on the sheet. Then cols/rows/cellWidthUm/
     * cellHeightUm/rotated describe design 0's cell with cols = perDesign, rows = 1,
     * rotated = false and turnedCount omitted (cols = rows = 0 is NOT allowed).
     */
    designCount?: number;
    /** Multi-design orders only: copies of each design per sheet (countPerSheet = designCount × perDesign). */
    perDesign?: number;
  };
  design: {
    kind: DesignKind;
    originalName: string;
    bytes: number;
    pxWidth: number;
    pxHeight: number;
    /** Undefined for vector PDFs. */
    effectiveDpi?: number;
    /** True when the raster has a transparent background («مفرغ»). Added only when true (single and multi). */
    cutOut?: true;
  };
  /** Multi-design orders only: every design, in upload order; designs[0] describes the same file as `design`. */
  designs?: OrderDesignRecord[];
  /** material + sheets live in price (price.material, price.sheets). */
  price: PriceBreakdown;
  customer: CustomerInfo;
  files: {
    /** Storage path of the original upload. */
    designPath: string;
    /** Storage path of the generated A4 PDF. */
    pdfPath: string;
    /** Multi-design orders only: storage path of every original upload; [0] === designPath. */
    designPaths?: string[];
  };
  notified: { telegram: 'sent' | 'failed' | 'skipped' };
}

export type OrderError =
  | 'invalid_request'
  | 'upload_missing'
  | 'invalid_quantity'
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
  | {
      ok: false;
      error: OrderError;
      message: string;
      /** Multi-design orders only: 0-based index of the design the error is about. */
      designIndex?: number;
    };

/* ────────────────────────────── Upload API ─────────────────────────────── */

export type UploadError =
  | 'unsupported_type'
  | 'too_large'
  | 'corrupt'
  /** The file failed the security check (e.g. a PDF with scripts or embedded files). */
  | 'unsafe'
  | 'rate_limited'
  | 'server_error';

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

/* ───────────────── AI designer API (POST /api/design/brief, /api/design/generate) ───────────────── */

export type BriefError = 'unavailable' | 'rate_limited' | 'invalid_request' | 'failed';
export type BriefResponse =
  | { ok: true; lines: string[]; fixes: { from: string; to: string }[]; visualDescription: string; briefToken: string }
  | { ok: false; error: BriefError };

export type GenerateError =
  | 'unavailable'
  | 'blocked'
  | 'ip_limit'
  | 'site_limit'
  | 'text_too_long'
  | 'refused'
  | 'failed'
  | 'invalid_request';
export type GenerateResponse =
  | { ok: true; uploadId: string; png: string; pxWidth: number; pxHeight: number; remainingToday: number | null }
  | { ok: false; error: GenerateError };

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

  /** Append one analytics event (best effort — callers must not fail a request on error). */
  recordEvent(event: AnalyticsEvent): Promise<void>;
  /** Events with ts ≥ since, oldest first. */
  listEvents(since: Date): Promise<AnalyticsEvent[]>;
  /** Insert or update the customer for this order (increments ordersCount/totalIqd, refreshes address). */
  upsertCustomerFromOrder(record: OrderRecord): Promise<void>;
  /** Most recent lastOrderAt first. */
  listCustomers(): Promise<CustomerRecord[]>;

  /**
   * Optional (cloud storage): one-time signed URL the BROWSER PUTs the file to, landing at
   * uploads/<uploadId>.bin. The server must validate the bytes before writing the meta.
   */
  createDirectUpload?(uploadId: string): Promise<string>;
  /** Hard size limit of the bucket behind createDirectUpload (bytes). */
  readonly directUploadMaxBytes?: number;
  /** Optional: write only the meta of a direct upload whose bytes the server has checked. */
  saveUploadMeta?(uploadId: string, meta: StoredFileMeta): Promise<void>;
  /**
   * Optional: what a committed upload looks like WITHOUT reading its bytes: the stored meta and
   * the size of the .bin. null when the meta is missing or unreadable, the .bin is gone, or the
   * storage's answer was not a clean success (unknown): a null is NOT proof that the upload is
   * missing, so the commit step asks readUpload() before treating it as missing (the AI reference
   * pre-check treats it as an invalid reference, which costs nothing). Only a thrown network error propagates. Lets the commit step answer a retry cheaply.
   */
  uploadInfo?(uploadId: string): Promise<{ meta: StoredFileMeta; size: number } | null>;
  /** Optional: short-lived signed download URL for an admin download. */
  signedDownloadUrl?(path: string, downloadName: string, expiresInSec?: number): Promise<string | null>;

  /**
   * Optional (retention purge, owner decision D10). Deletes only items created in
   * [cutoff − PURGE_WINDOW_DAYS, cutoff). Orders created from KEEP_DESIGNS_FROM on keep their
   * record and design forever and lose only their print PDF; older orders keep the old rule
   * (record, PDF and design removed). Uploads that no order and no AI generation uses are
   * removed, plus adapter-specific leftovers (Supabase: direct uploads never committed after
   * 3 hours; local: interrupted .tmp writes older than `cutoff`). Returns what was removed, or
   * what would be when `dryRun` is true. Customers are never removed.
   */
  purgeOlderThan?(cutoff: Date, dryRun: boolean): Promise<string[]>;
  /**
   * Optional (retention purge): removes analytics events older than `cutoff`. Returns what was
   * removed, or what would be when `dryRun` is true. Customers are never removed.
   */
  purgeEventsOlderThan?(cutoff: Date, dryRun: boolean): Promise<string[]>;

  /**
   * Optional (retention purge): removes AI usage counters of days before `day` (YYYY-MM-DD).
   * Returns what was removed (`ai_usage:<n>`), or what would be when `dryRun` is true.
   */
  aiPurgeUsageBefore?(day: string, dryRun: boolean): Promise<string[]>;

  /* AI sticker designer (optional; both adapters implement them). Types: section below. */

  /**
   * Atomically checks blocked → site cap → per-IP cap for (day, kind) and, when allowed, counts
   * one use. `used` = this ipKey's count for the day after the call. `ipKey` '' = no per-IP
   * check (TRUST_PROXY=0); the use is then counted on the site-only row.
   */
  aiReserve?(a: { day: string; ipKey: string; ip: string; kind: AiKind; perIpLimit: number; siteLimit: number }): Promise<{ status: AiReserveResult; used: number }>;
  /** Gives back one reserved use (a failed try does not count); never below 0. */
  aiRelease?(a: { day: string; ipKey: string; kind: AiKind }): Promise<void>;
  aiRecordGeneration?(rec: AiGenerationRecord): Promise<void>;
  /** Sets orderId on the generation whose uploadId matches; no match = no-op. */
  aiMarkOrdered?(uploadId: string, orderId: string): Promise<void>;
  /** Newest first; `total` counts every row matching the filter. */
  aiListGenerations?(q: { limit: number; offset: number; ipKey?: string }): Promise<{ rows: AiGenerationRecord[]; total: number }>;
  /** Usage rows with day ≥ sinceDay (YYYY-MM-DD); only rows of `kind` when given. */
  aiUsage?(sinceDay: string, kind?: AiKind): Promise<AiUsageRow[]>;
  /** Throws on an empty ipKey ('' is the site-only row and must never be blocked). */
  aiBlock?(ipKey: string, ip: string): Promise<void>;
  aiUnblock?(ipKey: string): Promise<void>;
  /** Newest first. */
  aiListBlocks?(): Promise<AiBlock[]>;
}

/* ────────────────────────────── AI sticker designer ────────────────────── */

/**
 * Stored records of the in-site AI designer. Unlike analytics, these hold the FULL client IP
 * (owner decision D9, 2026-11-21); `ipKey` is a keyed hash of it, the limit/block key.
 * `day` is the shop day (Asia/Baghdad), YYYY-MM-DD.
 */
export type AiKind = 'image' | 'brief';
export type AiReserveResult = 'ok' | 'ip_limit' | 'site_limit' | 'blocked';

export interface AiGenerationRecord {
  id: string;
  createdAt: string;
  day: string;
  ip: string;
  ipKey: string;
  shape: Shape;
  corners: Corners;
  widthUm: number;
  heightUm: number;
  idea: string;
  lines: string[];
  hasRefs: boolean;
  model: string;
  /** The generated PNG, stored as an ordinary upload. */
  uploadId: string;
  /** Set when an order used this design. */
  orderId: string | null;
}

/** One daily counter. `ipKey` '' = the site-only row (per-IP check skipped). */
export interface AiUsageRow {
  day: string;
  ipKey: string;
  ip: string;
  kind: AiKind;
  count: number;
  lastAt: string;
}

export interface AiBlock {
  ipKey: string;
  ip: string;
  createdAt: string;
}

/* ────────────────────────────── Analytics & customers ──────────────────── */

/**
 * First-party, cookieless analytics event (owner request 2026-11-10). No IP, no user agent,
 * no personal data is stored: `visitor` is a daily-rotating salted hash, location is city-level
 * from the hosting edge headers.
 */
export type AnalyticsEventType =
  | 'pageview'
  /** Builder step reached; `step` = StepId ('shape' | 'design' | 'size' | 'quantity' | 'details'). */
  | 'step'
  /** Server-side: a design upload was accepted. */
  | 'upload'
  /** Server-side: an order was created. `meta` carries material/sheets/requestedStickers (sticker orders)/total/governorate/shape. */
  | 'order'
  /** PWA install card shown / accepted / app installed. `step` = 'shown' | 'accepted' | 'installed'. */
  | 'install';

/** Builder steps in order: the `step` value of a 'step' event. */
export const BUILDER_STEPS = ['shape', 'design', 'size', 'quantity', 'details'] as const;
export type BuilderStep = (typeof BUILDER_STEPS)[number];

/** PWA install funnel: the `step` value of an 'install' event. */
export const INSTALL_EVENTS = ['shown', 'accepted', 'installed'] as const;
export type InstallEvent = (typeof INSTALL_EVENTS)[number];

export type DeviceKind = 'mobile' | 'tablet' | 'desktop';

/** Normalised traffic source derived from referrer / utm_source. */
export type TrafficSource =
  | 'direct'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'whatsapp'
  | 'telegram'
  | 'google'
  | 'snapchat'
  | 'youtube'
  | 'other';

export interface AnalyticsEvent {
  /** ISO 8601 UTC. */
  ts: string;
  type: AnalyticsEventType;
  /** sha256(day + ip + ua + salt) truncated — counts unique visitors per day, unlinkable across days. */
  visitor: string;
  path?: string;
  step?: string;
  source?: TrafficSource;
  device?: DeviceKind;
  /** City / region / ISO country from x-vercel-ip-* headers (absent locally). */
  city?: string;
  region?: string;
  country?: string;
  /** Small, non-personal extras (e.g. order material/sheets/totalIqd/governorate/shape). */
  meta?: Record<string, string | number | boolean | null>;
}

/**
 * One row per customer phone, upserted on every order and NEVER purged by the retention cron
 * (owner decision 2026-11-10; the consent/footer copy says so). Design files still expire.
 */
export interface CustomerRecord {
  /** Normalised phone "9647XXXXXXXXX" — the key. */
  phone: string;
  name?: string;
  governorate: string;
  district: string;
  landmark: string;
  firstOrderAt: string;
  lastOrderAt: string;
  ordersCount: number;
  /** Sum of order totals (IQD) where the price was known. */
  totalIqd: number;
  lastOrderId: string;
  lastDisplayNo: string;
  /**
   * WhatsApp offers consent. The LATEST order's explicit choice wins (an order without the box ticked withdraws it).
   * Absent = never opted in (rows from before the opt-in existed, or a customer who never ticked).
   */
  marketingOptIn?: boolean;
  /** ISO 8601 UTC of the latest opt-in; null once withdrawn. Absent with `marketingOptIn`. */
  marketingOptInAt?: string | null;
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
