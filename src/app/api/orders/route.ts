import { BodyTooLarge, readJsonCapped } from "../_lib/body";
import { trackServer } from "@/lib/analytics/server";
import { builder, order } from "@/content/ar";
import { MULTI_DESIGN_ENABLED } from "@/config/defaults";
import { getOrderEnv } from "@/lib/env";
import { makeDisplayNo, multiPdfFileNameFor, pdfFileNameFor } from "@/lib/display-no";
import { normaliseArtwork } from "@/lib/design/normalise.server";
import { computeLayout, computeMultiLayout, layoutParamsFor } from "@/lib/layout";
import { reportError } from "@/lib/monitoring/report";
import { notifyShop } from "@/lib/notify";
import { buildMultiOrderRecord, buildOrderRecord, summaryOf, type MultiDesignInput } from "@/lib/order-record";
import { orderRequestSchema } from "@/lib/order-schema";
import { orderSummaryText } from "@/lib/order-text";
import { normalisePhone, whatsappUrl } from "@/lib/parse/phone";
import { buildMultiSheetPdf } from "@/lib/pdf/build-multi-sheet";
import { buildSheetPdf } from "@/lib/pdf/build-sheet";
import {
  priceFor,
  priceForStickers,
  sheetsForStickers,
  validateQuantity,
  validateStickers,
  type QuantityError,
} from "@/lib/pricing";
import { clientIp, limiters } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { getStorage } from "@/lib/storage";
import { uploadPath } from "@/lib/storage/paths";
import { verifyTurnstile } from "@/lib/turnstile";
import type {
  NormalisedArtwork,
  OrderError,
  OrderRecord,
  OrderRequest,
  OrderResponse,
  PriceBreakdown,
  ShopSettings,
  StickerSpec,
  StorageAdapter,
} from "@/lib/types";
import { PRINT_DPI } from "@/lib/print-dpi";
import { umToMm } from "@/lib/units";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const STATUS: Record<OrderError, number> = {
  invalid_request: 400,
  upload_missing: 400,
  invalid_quantity: 400,
  invalid_phone: 400,
  too_small: 400,
  too_big_for_page: 400,
  ratio_extreme: 400,
  low_dpi: 400,
  no_alpha: 400,
  unsupported_type: 400,
  corrupt: 400,
  encrypted: 400,
  needs_raster: 400,
  rate_limited: 429,
  captcha_failed: 403,
  server_error: 500,
};

/** Max JSON body for POST /api/orders (the real payload is a few KiB). */
const MAX_BODY_BYTES = 64 * 1024;

/** The sheet PDF must fit the storage bucket (15 MiB, migration 20261111000000); a little headroom. */
const MAX_SHEET_PDF_BYTES = 14 * 1024 * 1024;
/** A multi sheet is not even built when its raster artwork alone is this many times the limit (see processMultiOrder). */
const SKIP_BUILD_FACTOR = 3;
/** Lower resolutions tried, in order, when the 1200 DPI sheet PDF is over the limit. */
const FALLBACK_DPI = [600, 300] as const;

type Failure = Extract<OrderResponse, { ok: false }>;
// `designIndex` (0-based) is set only by multi-design orders, so a single order's error body keeps its keys.
const fail = (error: OrderError, designIndex?: number): Failure => ({
  ok: false,
  error,
  message: order.errors[error],
  ...(designIndex !== undefined ? { designIndex } : {}),
});

function successFor(
  record: OrderRecord,
  settings: ShopSettings,
): OrderResponse {
  const summary = summaryOf(record);
  const text = `${builder.whatsappText.newOrder}\n${orderSummaryText(summary)}`;
  return {
    ok: true,
    orderId: record.orderId,
    displayNo: record.displayNo,
    summary,
    whatsappUrl: settings.whatsapp ? whatsappUrl(settings.whatsapp, text) : "",
    notified: record.notified,
  };
}

/**
 * A short, non-personal label for a storage error: its own `code` when it has a plain one, else the
 * HTTP status the Supabase adapter puts in its message ("... -> 500 <body>"). Never the message or
 * the body itself: a PostgREST error can echo a row (phone, address).
 */
function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[\w.-]{1,32}$/.test(code)) return code;
  const status = e instanceof Error ? /-> (\d{3})/.exec(e.message) : null;
  return status ? status[1] : "unknown";
}

/** The stored order, or null when it is absent or the read failed (callers then carry on as the winner). */
async function readBack(
  storage: StorageAdapter,
  orderId: string,
): Promise<OrderRecord | null> {
  try {
    return await storage.getOrder(orderId);
  } catch {
    return null;
  }
}

/**
 * The quantity check, at its usual place in the pipeline (after the phone, before the upload).
 * A sticker request is checked against the layout the server computes itself (pure; the full
 * layout step still runs later). When that layout fails only the material is checked here, so
 * the layout error keeps its later position. A sheet request (old cached page) is checked as before.
 */
function quantityErrorFor(
  req: OrderRequest,
  settings: ShopSettings,
): QuantityError | null {
  if (req.stickers === undefined)
    return validateQuantity(req.material, req.sheets ?? Number.NaN, settings.pricing);
  const early = computeLayout(req.spec, layoutParamsFor(req.spec, settings.layout));
  if (!early.ok)
    return settings.pricing.materials[req.material]?.enabled
      ? null
      : "material_disabled";
  return validateStickers(
    req.material,
    req.stickers,
    early.layout.countPerSheet,
    settings.pricing,
  );
}

async function processOrder(
  request: Request,
  req: OrderRequest,
  ip: string,
  settings: ShopSettings,
): Promise<OrderResponse> {
  const storage = getStorage();
  const env = getOrderEnv();

  if (
    env.TURNSTILE_SECRET_KEY &&
    !(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, req.turnstileToken, ip))
  ) {
    return fail("captcha_failed");
  }

  const phone = normalisePhone(req.customer.phone);
  if (!phone) return fail("invalid_phone");

  if (req.designs) return processMultiOrder(request, req, req.designs, phone, settings);

  if (quantityErrorFor(req, settings) !== null) return fail("invalid_quantity");

  const upload = await storage.readUpload(req.uploadId);
  if (!upload) return fail("upload_missing");

  const spec = req.spec;
  const outcome = computeLayout(spec, layoutParamsFor(spec, settings.layout));
  if (!outcome.ok)
    return fail(
      outcome.reason === "invalid" ? "invalid_request" : outcome.reason,
    );
  const layout = outcome.layout;
  // A sticker request never trusts the client's sheet count.
  const sheets =
    req.stickers !== undefined
      ? sheetsForStickers(req.stickers, layout.countPerSheet)
      : (req.sheets ?? 0);

  let norm = await normaliseArtwork(upload.bytes, {
    spec,
    targetDpi: PRINT_DPI,
    blockDpi: settings.quality.blockDpi,
  });
  if (!norm.ok) return fail(norm.error);

  const displayNo = makeDisplayNo();
  const fileName = pdfFileNameFor(displayNo, spec, sheets);
  const buildPdf = (artwork: Parameters<typeof buildSheetPdf>[0]["artwork"]) =>
    buildSheetPdf({
      layout,
      artwork,
      meta: {
        displayNo,
        description: `${spec.shape} ${umToMm(spec.widthUm)}x${umToMm(spec.heightUm)}mm x${layout.countPerSheet}`,
      },
    });
  let pdf = await buildPdf(norm.artwork);
  // The storage bucket refuses a file over its limit, and a full-resolution raster at 1200 DPI can
  // push the sheet PDF over it. Rare: only then re-normalise at a lower DPI (the owner's 1200 is a
  // maximum, see print-dpi.ts) until the file fits. Vector PDFs do not grow with the DPI.
  for (const dpi of FALLBACK_DPI) {
    if (pdf.bytes.length <= MAX_SHEET_PDF_BYTES || norm.artwork.kind !== "raster") break;
    const again = await normaliseArtwork(upload.bytes, {
      spec,
      targetDpi: dpi,
      blockDpi: settings.quality.blockDpi,
    });
    if (!again.ok) break;
    norm = again;
    pdf = await buildPdf(norm.artwork);
  }

  const price =
    req.stickers !== undefined
      ? priceForStickers(req.material, req.stickers, layout.countPerSheet, settings)
      : priceFor(req.material, sheets, layout.countPerSheet, settings);
  const pdfPath = await storage.savePdf(req.orderId, pdf.bytes);

  const record = buildOrderRecord({
    req,
    phone,
    displayNo,
    createdAt: new Date().toISOString(),
    layout,
    norm,
    uploadMeta: upload.meta,
    price,
    pdfPath,
  });

  return completeOrder(request, storage, settings, { req, record, price, spec, pdfBytes: pdf.bytes, fileName });
}

interface PreparedOrder {
  req: OrderRequest;
  record: OrderRecord;
  price: PriceBreakdown;
  /** The spec the analytics event reports (design 0 for a multi-design order). */
  spec: StickerSpec;
  pdfBytes: Uint8Array;
  fileName: string;
}

/**
 * Everything after the record is built, shared by single and multi-design orders: persist, replay
 * race, AI mark, customer upsert, analytics, Telegram, answer.
 */
async function completeOrder(
  request: Request,
  storage: StorageAdapter,
  settings: ShopSettings,
  { req, record, price, spec, pdfBytes, fileName }: PreparedOrder,
): Promise<OrderResponse> {
  // Persist BEFORE notifying: the admin dashboard is the record of truth.
  // saveOrder is first-write-wins (a duplicate orderId never overwrites) and cannot tell the caller
  // it lost, so the stored record is read back: another serverless instance that got there first
  // has a different displayNo, and that run owns every side effect (customer count, event,
  // Telegram). We answer with its record and do nothing else.
  let confirmed = false;
  try {
    await storage.saveOrder(record);
  } catch (e) {
    // The insert can commit and still throw (the 10 s abort fires before the answer arrives):
    // confirm before answering server_error, as a retry would otherwise find the order and skip
    // the customer upsert and the notification for good.
    const stored = await readBack(storage, record.orderId);
    if (!stored) throw e;
    if (stored.displayNo !== record.displayNo)
      return successFor(stored, settings);
    confirmed = true;
    reportError(new Error("Order save timed out but the row exists"), {
      where: "orders.saveOrder",
      route: "/api/orders",
      level: "warning",
      tags: { orderId: record.orderId },
    });
  }
  if (!confirmed) {
    // A failed read-back means "assume we won": a duplicate message beats a lost one.
    const stored = await readBack(storage, record.orderId);
    if (stored && stored.displayNo !== record.displayNo)
      return successFor(stored, settings);
  }

  // An AI design (src/lib/ai/service.ts) is marked as ordered: best effort, never fails the order.
  try {
    await storage.aiMarkOrdered?.(req.uploadId, record.orderId);
  } catch {
    // Codes only: a storage error could echo the generation row (idea text, IP).
    reportError(new Error("AI generation mark-ordered failed"), {
      where: "orders.aiMarkOrdered",
      route: "/api/orders",
      tags: { orderId: record.orderId },
    });
  }

  // Customer list + analytics: best effort, must never fail the order.
  try {
    await storage.upsertCustomerFromOrder(record);
  } catch (e) {
    // A fixed message and a short code only: the error text can carry a PostgREST row (phone).
    console.error(`[orders] customer upsert failed (${errorCode(e)})`);
    reportError(e, { where: "orders.customerUpsert", route: "/api/orders", tags: { orderId: record.orderId } });
  }
  await trackServer(request, {
    type: "order",
    meta: {
      material: price.material,
      sheets: price.sheets,
      ...(price.requestedStickers !== undefined
        ? { requestedStickers: price.requestedStickers }
        : {}),
      totalIqd: price.totalIqd,
      governorate: record.customer.governorate,
      shape: spec.shape,
      widthMm: umToMm(spec.widthUm),
      heightMm: umToMm(spec.heightUm),
      // Multi-design orders only.
      ...(req.designs ? { designs: req.designs.length } : {}),
    },
  });

  let notified: OrderRecord["notified"] = { telegram: "failed" };
  try {
    const result = await notifyShop(record, pdfBytes, fileName, settings);
    notified = { telegram: result.telegram };
    if (result.error) {
      console.error("[orders] notify failed:", result.error);
      reportError(new Error(`Order notification failed: ${result.error}`), {
        where: "orders.notify",
        route: "/api/orders",
        tags: { orderId: record.orderId },
      });
    }
  } catch (e) {
    console.error("[orders] notify threw", e);
    reportError(e, { where: "orders.notify", route: "/api/orders", tags: { orderId: record.orderId } });
  }
  const updated = (await storage.updateOrder(record.orderId, { notified })) ?? {
    ...record,
    notified,
  };
  return successFor(updated, settings);
}

/** Each design's spec: the shared shape and corners with that design's own size. */
const specsOf = (req: OrderRequest, designs: NonNullable<OrderRequest["designs"]>): StickerSpec[] =>
  designs.map((d) => ({ ...req.spec, widthUm: d.widthUm, heightUm: d.heightUm }));

/**
 * Multi-design order (req.designs present): the same pipeline as a single order, in the same error
 * order (quantity, lowest missing upload, layout, normalise in design order), with one sheet that
 * holds the same number of copies of EACH design. Errors that belong to one design carry its index.
 */
async function processMultiOrder(
  request: Request,
  req: OrderRequest,
  designs: NonNullable<OrderRequest["designs"]>,
  phone: string,
  settings: ShopSettings,
): Promise<OrderResponse> {
  const storage = getStorage();
  const specs = specsOf(req, designs);
  const outcome = computeMultiLayout(specs, settings.layout);

  // Multi-design orders are always placed as a sticker count (the schema keeps `stickers` for them).
  if (req.stickers === undefined) return fail("invalid_request");
  const stickers = req.stickers;
  const quantityError = outcome.ok
    ? validateStickers(req.material, stickers, outcome.layout.countPerSheet, settings.pricing)
    : settings.pricing.materials[req.material]?.enabled
      ? null
      : "material_disabled";
  if (quantityError !== null) return fail("invalid_quantity");

  // Reads one at a time; the bytes stay for a possible lower-DPI pass below.
  const uploads: NonNullable<Awaited<ReturnType<StorageAdapter["readUpload"]>>>[] = [];
  for (let i = 0; i < designs.length; i++) {
    const upload = await storage.readUpload(designs[i].uploadId);
    if (!upload) return fail("upload_missing", i);
    uploads.push(upload);
  }

  if (!outcome.ok)
    return fail(outcome.reason === "invalid" ? "invalid_request" : outcome.reason, outcome.designIndex);
  const layout = outcome.layout;
  const sheets = sheetsForStickers(stickers, layout.countPerSheet);

  // One design at a time: sharp holds a full raw copy of the picture while it works.
  const normalised = async (dpi: number) => {
    const out: Extract<Awaited<ReturnType<typeof normaliseArtwork>>, { ok: true }>[] = [];
    for (let i = 0; i < specs.length; i++) {
      const norm = await normaliseArtwork(uploads[i].bytes, {
        spec: specs[i],
        targetDpi: dpi,
        blockDpi: settings.quality.blockDpi,
      });
      if (!norm.ok) return { ok: false as const, error: norm.error, designIndex: i };
      out.push(norm);
    }
    return { ok: true as const, norms: out };
  };
  const first = await normalised(PRINT_DPI);
  if (!first.ok) return fail(first.error, first.designIndex);
  let norms = first.norms;

  const displayNo = makeDisplayNo();
  const fileName = multiPdfFileNameFor(displayNo, designs.length, sheets);
  const buildPdf = (artworks: NormalisedArtwork[]) =>
    buildMultiSheetPdf({
      layout,
      artworks,
      meta: { displayNo, description: `multi ${designs.length} designs x${layout.countPerSheet}` },
    });
  // The raster artwork bytes are a rough floor for the sheet (a JPEG is embedded as it is; a PNG is
  // re-deflated, which usually gives about as many bytes or more, but can come out smaller on synthetic
  // images, so only a wide margin counts). When they are far over the cap, building this pass is wasted
  // work (14 s of PDF build for 8 big PNGs at 1200 DPI): skip straight to the next DPI. A vector PDF's file
  // size is NOT such a floor (only page 1 is drawn), so vectors are always built and judged by the real sheet.
  const rasterBytes = (ns: typeof norms) =>
    ns.reduce((sum, n) => sum + (n.artwork.kind === "raster" ? n.artwork.bytes.length : 0), 0);
  const hopeless = (ns: typeof norms) => rasterBytes(ns) > SKIP_BUILD_FACTOR * MAX_SHEET_PDF_BYTES;
  const hasRaster = (ns: typeof norms) => ns.some((n) => n.artwork.kind === "raster");
  let pdf: Awaited<ReturnType<typeof buildPdf>> | null =
    hopeless(norms) ? null : await buildPdf(norms.map((n) => n.artwork));
  // Same size cap as a single order: when over it, ALL raster designs are re-normalised at a lower DPI
  // (the whole set or nothing: a failed pass keeps the last set that built). Vector PDFs do not grow with
  // it, so with no raster design there is nothing to lower; a mix lowers the pictures, then names the PDF.
  for (const dpi of FALLBACK_DPI) {
    if (pdf && pdf.bytes.length <= MAX_SHEET_PDF_BYTES) break;
    if (!hasRaster(norms)) break;
    const again = await normalised(dpi);
    if (!again.ok) break;
    norms = again.norms;
    pdf =
      !hopeless(norms) || dpi === FALLBACK_DPI[FALLBACK_DPI.length - 1]
        ? await buildPdf(norms.map((n) => n.artwork))
        : null;
  }
  pdf ??= await buildPdf(norms.map((n) => n.artwork));
  if (pdf.bytes.length > MAX_SHEET_PDF_BYTES) {
    // Still over what the bucket takes. Only a vector PDF can be shrunk by the customer's browser: name the
    // biggest upload among them, the client turns it into a picture (the needs_raster path) and retries.
    let biggest = -1;
    norms.forEach((n, i) => {
      if (n.artwork.kind === "pdf" && (biggest < 0 || uploads[i].bytes.length > uploads[biggest].bytes.length)) biggest = i;
    });
    if (biggest >= 0) return fail("needs_raster", biggest);
    // (No vector design left and already at the lowest DPI: nothing more to shrink; storage decides.)
  }

  const price = priceForStickers(req.material, stickers, layout.countPerSheet, settings);
  const pdfPath = await storage.savePdf(req.orderId, pdf.bytes);
  const inputs: MultiDesignInput[] = norms.map((norm, i) => ({ norm, uploadMeta: uploads[i].meta }));
  const record = buildMultiOrderRecord({
    req: { ...req, designs },
    phone,
    displayNo,
    createdAt: new Date().toISOString(),
    layout,
    designs: inputs,
    price,
    pdfPath,
  });
  return completeOrder(request, storage, settings, { req, record, price, spec: req.spec, pdfBytes: pdf.bytes, fileName });
}

/** A replay must carry the same designs as the stored order: both single (no list) or the same uploads in the same order. */
function sameDesignPaths(stored: string[] | undefined, designs: OrderRequest["designs"]): boolean {
  if (stored === undefined || designs === undefined) return stored === undefined && designs === undefined;
  return stored.length === designs.length && stored.every((p, i) => p === uploadPath(designs[i].uploadId));
}

const inflight = new Map<string, Promise<OrderResponse>>();

/** POST JSON OrderRequest → OrderResponse. See docs/ARCHITECTURE.md section 2. */
export async function POST(request: Request): Promise<Response> {
  const send = (body: OrderResponse, headers?: HeadersInit, status?: number) =>
    Response.json(body, {
      status: status ?? (body.ok ? 200 : STATUS[body.error]),
      headers,
    });

  try {
    // Throttle BEFORE reading anything from the body.
    const ip = clientIp(request);
    const rl = limiters().order.check(ip);
    if (!rl.ok)
      return send(fail("rate_limited"), {
        "Retry-After": String(rl.retryAfterSec),
      });

    let json: unknown;
    try {
      json = await readJsonCapped(request, MAX_BODY_BYTES);
    } catch (e) {
      if (e instanceof BodyTooLarge)
        return send(fail("invalid_request"), undefined, 413);
      return send(fail("invalid_request"));
    }
    const parsed = orderRequestSchema.safeParse(json);
    if (!parsed.success) return send(fail("invalid_request"));
    const req: OrderRequest = parsed.data;
    // Multi-design orders are switched off (MULTI_DESIGN_ENABLED): refuse them like any other bad request.
    if (req.designs && !MULTI_DESIGN_ENABLED) return send(fail("invalid_request"));

    const settings = await getSettings();

    // Idempotency: the same orderId returns the same result without redoing work, but only to a
    // request for the same upload (a retry resends the whole body). Another upload for a known
    // orderId is not a replay: same answer as any other bad request.
    const existing = await getStorage().getOrder(req.orderId);
    if (existing)
      return send(
        existing.files.designPath === uploadPath(req.uploadId) &&
          sameDesignPaths(existing.files.designPaths, req.designs)
          ? successFor(existing, settings)
          : fail("invalid_request"),
      );
    const running = inflight.get(req.orderId);
    if (running) return send(await running);

    const work = processOrder(request, req, ip, settings);
    inflight.set(req.orderId, work);
    try {
      return send(await work);
    } finally {
      inflight.delete(req.orderId);
    }
  } catch (e) {
    console.error("[orders] failed", e);
    reportError(e, { where: "orders.post", route: "/api/orders" });
    return send(fail("server_error"));
  }
}
