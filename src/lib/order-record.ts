/**
 * Shapes an order for storage and for the customer's answer. Pure: no I/O, no clock (the
 * caller passes `createdAt`). The key order of both objects is the key order of the stored
 * order JSON and of the POST /api/orders response, so keep it when adding a field.
 */
import { uploadPath } from "@/lib/storage/paths";
import type {
  DesignKind,
  LayoutResult,
  MultiLayoutResult,
  NormalisedArtwork,
  OrderDesignRecord,
  OrderRecord,
  OrderRequest,
  OrderSummary,
  PriceBreakdown,
  StoredFileMeta,
} from "@/lib/types";

export function summaryOf(record: OrderRecord): OrderSummary {
  return {
    displayNo: record.displayNo,
    shape: record.spec.shape,
    corners: record.spec.corners,
    widthUm: record.spec.widthUm,
    heightUm: record.spec.heightUm,
    countPerSheet: record.layout.countPerSheet,
    sheets: record.price.sheets,
    material: record.price.material,
    totalStickers: record.price.totalStickers,
    unitPriceIqd: record.price.unitPriceIqd,
    discountPercent: record.price.discountPercent,
    subtotalIqd: record.price.subtotalIqd,
    deliveryFeeIqd: record.price.deliveryFeeIqd,
    totalIqd: record.price.totalIqd,
    // Only on sticker-count orders; older orders keep their exact summary shape.
    ...(record.price.requestedStickers !== undefined
      ? { requestedStickers: record.price.requestedStickers }
      : {}),
    // Multi-design orders only; single orders keep their exact summary shape.
    ...(record.designs
      ? {
          designs: record.designs.map((d) => ({
            widthUm: d.widthUm,
            heightUm: d.heightUm,
            ...(d.cutOut ? { cutOut: true as const } : {}),
          })),
          perDesign: record.layout.perDesign ?? 0,
        }
      : {}),
  };
}

/**
 * «مفرغ» for the admin: the design has a transparent background. Multi-design records store it
 * (`cutOut`); a single-design record does not (its stored shape is pinned), but a raster is stored as
 * kind 'png' exactly when it has real transparent pixels (normalise.server.ts), so the kind says it.
 */
export const isCutOutDesign = (d: { kind: DesignKind; cutOut?: boolean }): boolean =>
  d.cutOut === true || d.kind === "png";

export interface OrderRecordInput {
  /** The validated request body. */
  req: OrderRequest;
  /** `req.customer.phone` after normalisePhone(). */
  phone: string;
  displayNo: string;
  /** ISO 8601, UTC. */
  createdAt: string;
  layout: LayoutResult;
  /** The successful outcome of normaliseArtwork(). */
  norm: {
    kind: DesignKind;
    pxWidth: number;
    pxHeight: number;
    artwork: NormalisedArtwork;
  };
  /** Meta of the stored upload the order uses. */
  uploadMeta: StoredFileMeta;
  /** Recomputed on the server; never taken from the client. */
  price: PriceBreakdown;
  /** Storage path of the generated sheet PDF. */
  pdfPath: string;
}

/** The record of a new order, before the shop has been notified. */
export function buildOrderRecord({
  req,
  phone,
  displayNo,
  createdAt,
  layout,
  norm,
  uploadMeta,
  price,
  pdfPath,
}: OrderRecordInput): OrderRecord {
  return {
    orderId: req.orderId,
    displayNo,
    createdAt,
    status: "new",
    spec: req.spec,
    layout: {
      cols: layout.cols,
      rows: layout.rows,
      countPerSheet: layout.countPerSheet,
      rotated: layout.rotated,
      turnedCount: layout.turnedCount,
      cellWidthUm: layout.cell.widthUm,
      cellHeightUm: layout.cell.heightUm,
      gapXUm: layout.gapXUm,
      gapYUm: layout.gapYUm,
    },
    design: {
      kind: norm.kind,
      originalName: uploadMeta.originalName,
      bytes: uploadMeta.bytes,
      pxWidth: norm.pxWidth,
      pxHeight: norm.pxHeight,
      effectiveDpi:
        norm.artwork.kind === "raster" ? norm.artwork.effectiveDpi : undefined,
    },
    price,
    customer: {
      name: req.customer.name || undefined,
      phone,
      governorate: req.customer.governorate,
      district: req.customer.district,
      landmark: req.customer.landmark,
      notes: req.customer.notes || undefined,
      // Only an explicit opt-in is stored, so an order without it keeps the exact shape it always had.
      ...(req.customer.marketingOptIn === true ? { marketingOptIn: true, marketingOptInAt: createdAt } : {}),
    },
    files: { designPath: uploadPath(req.uploadId), pdfPath },
    notified: { telegram: "skipped" },
  };
}

/** What the order route learned about ONE design of a multi-design order. */
export interface MultiDesignInput {
  /** The successful outcome of normaliseArtwork() for this design. */
  norm: {
    kind: DesignKind;
    pxWidth: number;
    pxHeight: number;
    artwork: NormalisedArtwork;
  };
  /** Meta of the stored upload of this design. */
  uploadMeta: StoredFileMeta;
}

export interface MultiOrderRecordInput {
  /** The validated request body; `req.designs` has 2..MAX_DESIGNS entries. */
  req: OrderRequest & { designs: NonNullable<OrderRequest["designs"]> };
  phone: string;
  displayNo: string;
  createdAt: string;
  layout: MultiLayoutResult;
  /** designs[i] belongs to req.designs[i] and layout.designs[i]. */
  designs: MultiDesignInput[];
  price: PriceBreakdown;
  pdfPath: string;
}

/**
 * The record of a new MULTI-design order. Same keys as buildOrderRecord plus `designs` and the
 * optional `layout.designCount` / `layout.perDesign` / `files.designPaths`. `design` is design 0.
 * Layout fields follow the types.ts comment: cols = perDesign, rows = 1, rotated = false.
 */
export function buildMultiOrderRecord({
  req,
  phone,
  displayNo,
  createdAt,
  layout,
  designs,
  price,
  pdfPath,
}: MultiOrderRecordInput): OrderRecord {
  const stored: OrderDesignRecord[] = designs.map(({ norm, uploadMeta }, i) => ({
    kind: norm.kind,
    originalName: uploadMeta.originalName,
    bytes: uploadMeta.bytes,
    pxWidth: norm.pxWidth,
    pxHeight: norm.pxHeight,
    effectiveDpi: norm.artwork.kind === "raster" ? norm.artwork.effectiveDpi : undefined,
    widthUm: req.designs[i].widthUm,
    heightUm: req.designs[i].heightUm,
    ...(norm.artwork.kind === "raster" && norm.artwork.hasAlpha ? { cutOut: true } : {}),
  }));
  const first = stored[0];
  return {
    orderId: req.orderId,
    displayNo,
    createdAt,
    status: "new",
    spec: req.spec,
    layout: {
      cols: layout.perDesign,
      rows: 1,
      countPerSheet: layout.countPerSheet,
      rotated: false,
      cellWidthUm: layout.designs[0].cell.widthUm,
      cellHeightUm: layout.designs[0].cell.heightUm,
      gapXUm: layout.gapXUm,
      gapYUm: layout.gapYUm,
      designCount: layout.designs.length,
      perDesign: layout.perDesign,
    },
    design: {
      kind: first.kind,
      originalName: first.originalName,
      bytes: first.bytes,
      pxWidth: first.pxWidth,
      pxHeight: first.pxHeight,
      effectiveDpi: first.effectiveDpi,
      ...(first.cutOut ? { cutOut: true as const } : {}),
    },
    designs: stored,
    price,
    customer: {
      name: req.customer.name || undefined,
      phone,
      governorate: req.customer.governorate,
      district: req.customer.district,
      landmark: req.customer.landmark,
      notes: req.customer.notes || undefined,
      ...(req.customer.marketingOptIn === true ? { marketingOptIn: true, marketingOptInAt: createdAt } : {}),
    },
    files: {
      designPath: uploadPath(req.uploadId),
      pdfPath,
      designPaths: req.designs.map((d) => uploadPath(d.uploadId)),
    },
    notified: { telegram: "skipped" },
  };
}
