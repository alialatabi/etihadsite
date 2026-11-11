import { BodyTooLarge, readJsonCapped } from "../_lib/body";
import { trackServer } from "@/lib/analytics/server";
import { builder, order } from "@/content/ar";
import { getOrderEnv } from "@/lib/env";
import { makeDisplayNo, pdfFileNameFor } from "@/lib/display-no";
import { normaliseArtwork } from "@/lib/design/normalise.server";
import { computeLayout, layoutParamsFor } from "@/lib/layout";
import { notifyShop } from "@/lib/notify";
import { buildOrderRecord, summaryOf } from "@/lib/order-record";
import { orderRequestSchema } from "@/lib/order-schema";
import { orderSummaryText } from "@/lib/order-text";
import { normalisePhone, whatsappUrl } from "@/lib/parse/phone";
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
import { verifyTurnstile } from "@/lib/turnstile";
import type {
  OrderError,
  OrderRecord,
  OrderRequest,
  OrderResponse,
  ShopSettings,
} from "@/lib/types";
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

type Failure = Extract<OrderResponse, { ok: false }>;
const fail = (error: OrderError): Failure => ({
  ok: false,
  error,
  message: order.errors[error],
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

  const norm = await normaliseArtwork(upload.bytes, {
    spec,
    targetDpi: settings.quality.targetDpi,
    blockDpi: settings.quality.blockDpi,
  });
  if (!norm.ok) return fail(norm.error);

  const displayNo = makeDisplayNo();
  const fileName = pdfFileNameFor(displayNo, spec, sheets);
  const pdf = await buildSheetPdf({
    layout,
    artwork: norm.artwork,
    meta: {
      displayNo,
      description: `${spec.shape} ${umToMm(spec.widthUm)}x${umToMm(spec.heightUm)}mm x${layout.countPerSheet}`,
    },
  });

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

  // Persist BEFORE notifying: the admin dashboard is the record of truth.
  await storage.saveOrder(record);

  // Customer list + analytics: best effort, must never fail the order.
  try {
    await storage.upsertCustomerFromOrder(record);
  } catch (e) {
    console.error("[orders] customer upsert failed", e);
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
    },
  });

  let notified: OrderRecord["notified"] = { telegram: "failed" };
  try {
    const result = await notifyShop(record, pdf.bytes, fileName, settings);
    notified = { telegram: result.telegram };
    if (result.error) console.error("[orders] notify failed:", result.error);
  } catch (e) {
    console.error("[orders] notify threw", e);
  }
  const updated = (await storage.updateOrder(record.orderId, { notified })) ?? {
    ...record,
    notified,
  };
  return successFor(updated, settings);
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

    const settings = await getSettings();

    // Idempotency: the same orderId returns the same result without redoing work.
    const existing = await getStorage().getOrder(req.orderId);
    if (existing) return send(successFor(existing, settings));
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
    return send(fail("server_error"));
  }
}
