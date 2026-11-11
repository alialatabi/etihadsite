/**
 * Shapes an order for storage and for the customer's answer. Pure: no I/O, no clock (the
 * caller passes `createdAt`). The key order of both objects is the key order of the stored
 * order JSON and of the POST /api/orders response, so keep it when adding a field.
 */
import { uploadPath } from "@/lib/storage/paths";
import type {
  DesignKind,
  LayoutResult,
  NormalisedArtwork,
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
  };
}

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
    },
    files: { designPath: uploadPath(req.uploadId), pdfPath },
    notified: { telegram: "skipped" },
  };
}
