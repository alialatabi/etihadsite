import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import type { OrderResponse } from "@/lib/types";
import { setupEnv } from "./helpers";

const normaliseArtwork = vi.fn();
const buildSheetPdf = vi.fn();
const notifyShop = vi.fn();

vi.mock("@/lib/design/normalise.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/design/normalise.server")>()),
  normaliseArtwork: (...a: unknown[]) => normaliseArtwork(...a),
}));
vi.mock("@/lib/pdf/build-sheet", () => ({
  buildSheetPdf: (...a: unknown[]) => buildSheetPdf(...a),
}));
vi.mock("@/lib/notify", () => ({
  notifyShop: (...a: unknown[]) => notifyShop(...a),
}));
vi.mock("@/lib/order-text", () => ({
  orderSummaryText: (s: { displayNo: string }) => `SUMMARY ${s.displayNo}`,
  shapeLabel: () => "x",
  sizeLabel: () => "y",
}));
vi.mock("@/lib/parse/phone", () => ({
  normalisePhone: (p: string) => {
    const d = p.replace(/\D/g, "").replace(/^0+/, "").replace(/^964/, "");
    return /^7\d{9}$/.test(d) ? `964${d}` : null;
  },
  whatsappUrl: (d: string, t?: string) =>
    `https://wa.me/${d}${t ? `?text=${encodeURIComponent(t)}` : ""}`,
}));
import { POST } from "@/app/api/orders/route";
import { computeLayout, layoutParamsFor } from "@/lib/layout";
import { getStorage } from "@/lib/storage";
import { safeLayout } from "@/components/builder/safe";
import type { StickerSpec } from "@/lib/types";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

function body(over: Record<string, unknown> = {}) {
  return {
    orderId: "order-aaaaaaaaaaaaaaaaaa",
    uploadId: "upload-aaaaaaaaaaaaaaaa",
    spec: { shape: "circle", widthUm: 30000, heightUm: 30000 },
    material: "paper",
    sheets: 20,
    customer: {
      name: "علي",
      phone: "07701234567",
      governorate: "بغداد",
      district: "الكرادة",
      landmark: "قرب الجسر",
    },
    ...over,
  };
}

let ipSeq = 0;
/** Each call gets its own IP unless one is given, so the per-IP limiter does not interfere. */
function call(
  b: unknown,
  ip = `9.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`,
) {
  return POST(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(b),
    }),
  );
}

async function json(res: Response): Promise<OrderResponse> {
  return (await res.json()) as OrderResponse;
}

beforeEach(async () => {
  setupEnv();
  vi.spyOn(console, "error").mockImplementation(() => {});
  normaliseArtwork.mockReset().mockResolvedValue({
    ok: true,
    kind: "png",
    pxWidth: 900,
    pxHeight: 900,
    artwork: {
      kind: "raster",
      bytes: PNG,
      mime: "image/png",
      pxWidth: 354,
      pxHeight: 354,
      hasAlpha: true,
      effectiveDpi: 300,
    },
  });
  buildSheetPdf
    .mockReset()
    .mockResolvedValue({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      report: {},
    });
  notifyShop.mockReset().mockResolvedValue({ telegram: "sent" });
  const storage = getStorage();
  await storage.saveUpload("upload-aaaaaaaaaaaaaaaa", PNG, {
    mime: "image/png",
    originalName: "logo.png",
    bytes: PNG.length,
    createdAt: new Date().toISOString(),
  });
  await storage.saveSettings({
    ...DEFAULT_SETTINGS,
    whatsapp: "9647709999999",
    pricesPublished: true,
  });
});

describe("POST /api/orders", () => {
  it("creates an order with the price recomputed from settings", async () => {
    // A hostile client smuggles in its own price; it must be ignored.
    const res = await call(
      body({
        priceIqd: 1,
        totalIqd: 1,
        unitPriceIqd: 1,
        discountPercent: 99,
        price: { totalIqd: 1 },
        offer: { priceIqd: 1 },
      }),
    );
    expect(res.status).toBe(200);
    const r = await json(res);
    if (!r.ok) throw new Error("expected ok");
    expect(r.displayNo).toMatch(/^EP-\d{6}-[A-Z2-9]{4}$/);
    // paper 800 x 20 sheets, 10% off -> 720 per sheet; 14,400 + 5,000 = 19,400 -> 19,000
    expect(r.summary.material).toBe("paper");
    expect(r.summary.unitPriceIqd).toBe(720);
    expect(r.summary.discountPercent).toBe(10);
    expect(r.summary.subtotalIqd).toBe(14000);
    expect(r.summary.totalIqd).toBe(19000);
    expect(r.summary.sheets).toBe(20);
    expect(r.summary.countPerSheet).toBeGreaterThan(0);
    expect(r.notified.telegram).toBe("sent");
    expect(r.whatsappUrl).toContain("https://wa.me/9647709999999?text=");
    expect(decodeURIComponent(r.whatsappUrl)).toContain(
      `SUMMARY ${r.displayNo}`,
    );

    const stored = await getStorage().getOrder("order-aaaaaaaaaaaaaaaaaa");
    expect(stored?.status).toBe("new");
    expect(stored?.customer.phone).toBe("9647701234567");
    expect(stored?.files).toEqual({
      designPath: "uploads/upload-aaaaaaaaaaaaaaaa.bin",
      pdfPath: "orders/order-aaaaaaaaaaaaaaaaaa.pdf",
    });
    expect(await getStorage().readFile(stored!.files.pdfPath)).not.toBeNull();
    const fileName = notifyShop.mock.calls[0][2] as string;
    expect(fileName).toBe(`${r.displayNo}_circle-30x30mm_x20.pdf`);
    expect(stored?.price.totalIqd).toBe(19000);
    expect(stored?.price.roundingIqd).toBe(-400);
    expect(stored).not.toHaveProperty("offer");
    expect(stored).not.toHaveProperty("priceIqd");
  });

  it("computes plastic x 50 on the server: 1,275 each, 68,750 rounded to 69,000", async () => {
    const r = await json(
      await call(
        body({
          orderId: "order-plastic50aaaaaaaa",
          material: "plastic",
          sheets: 50,
        }),
      ),
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.summary).toMatchObject({
      material: "plastic",
      sheets: 50,
      unitPriceIqd: 1275,
      discountPercent: 15,
      subtotalIqd: 64000,
      deliveryFeeIqd: 5000,
      totalIqd: 69000,
    });
    expect(r.summary).not.toHaveProperty("requestedStickers");
  });

  it("rejects a quantity below the minimum", async () => {
    const res = await call(
      body({ orderId: "order-belowminaaaaaaaa", sheets: 9 }),
    );
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({
      ok: false,
      error: "invalid_quantity",
    });
    expect(await getStorage().getOrder("order-belowminaaaaaaaa")).toBeNull();
  });

  it("rejects a quantity above the maximum", async () => {
    const res = await call(
      body({
        orderId: "order-abovemaxaaaaaaaa",
        sheets: DEFAULT_SETTINGS.pricing.maxSheets + 1,
      }),
    );
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: "invalid_quantity" });
  });

  it("rejects a disabled material", async () => {
    await getStorage().saveSettings({
      ...DEFAULT_SETTINGS,
      pricing: {
        ...DEFAULT_SETTINGS.pricing,
        materials: {
          ...DEFAULT_SETTINGS.pricing.materials,
          plastic: { enabled: false, pricePerSheetIqd: 1500 },
        },
      },
    });
    const res = await call(
      body({ orderId: "order-disabledaaaaaaaa", material: "plastic" }),
    );
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: "invalid_quantity" });
  });

  it("rejects an unknown material or fractional sheets as invalid_request", async () => {
    const m = await call(
      body({ orderId: "order-badmaterialaaaaa", material: "gold" }),
    );
    expect(m.status).toBe(400);
    const f = await call(
      body({ orderId: "order-fractionalaaaaaa", sheets: 10.5 }),
    );
    expect(f.status).toBe(400);
  });

  it("is idempotent on orderId", async () => {
    const first = await json(await call(body()));
    const second = await json(await call(body()));
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(second.displayNo).toBe(first.displayNo);
    expect(buildSheetPdf).toHaveBeenCalledTimes(1);
    expect(notifyShop).toHaveBeenCalledTimes(1);
  });

  it("returns an empty whatsappUrl when the shop has no WhatsApp", async () => {
    await getStorage().saveSettings({
      ...DEFAULT_SETTINGS,
      pricesPublished: false,
    });
    const r = await json(await call(body()));
    if (!r.ok) throw new Error("expected ok");
    expect(r.whatsappUrl).toBe("");
    expect(r.summary.totalIqd).toBeNull();
    expect(r.summary.unitPriceIqd).toBeNull();
    expect(r.summary.deliveryFeeIqd).toBe(5000);
  });

  it("maps validation failures to error codes", async () => {
    const bad = await json(
      await call(body({ customer: { ...body().customer, phone: "12345" } })),
    );
    expect(bad).toMatchObject({ ok: false, error: "invalid_phone" });

    const qty = await call(
      body({ orderId: "order-bbbbbbbbbbbbbbbbbb", sheets: 3 }),
    );
    expect(await json(qty)).toMatchObject({
      ok: false,
      error: "invalid_quantity",
    });

    const up = await call(
      body({
        orderId: "order-cccccccccccccccccc",
        uploadId: "upload-zzzzzzzzzzzzzzzz",
      }),
    );
    expect(await json(up)).toMatchObject({
      ok: false,
      error: "upload_missing",
    });

    const tooBig = await call(
      body({
        orderId: "order-dddddddddddddddddd",
        spec: {
          shape: "rect",
          corners: "sharp",
          widthUm: 300000,
          heightUm: 300000,
        },
      }),
    );
    expect(await json(tooBig)).toMatchObject({
      ok: false,
      error: "too_big_for_page",
    });

    const invalid = await call({ nonsense: true });
    expect(invalid.status).toBe(400);
    expect(await json(invalid)).toMatchObject({
      ok: false,
      error: "invalid_request",
    });

    normaliseArtwork.mockResolvedValueOnce({
      ok: false,
      error: "needs_raster",
    });
    const nr = await call(body({ orderId: "order-eeeeeeeeeeeeeeeeee" }));
    expect(await json(nr)).toMatchObject({ ok: false, error: "needs_raster" });
    expect(await getStorage().getOrder("order-eeeeeeeeeeeeeeeeee")).toBeNull();
  });

  it("persists the order even when notification fails", async () => {
    notifyShop.mockResolvedValue({ telegram: "failed", error: "boom" });
    const r = await json(await call(body()));
    if (!r.ok) throw new Error("expected ok");
    expect(r.notified.telegram).toBe("failed");
    expect(
      (await getStorage().getOrder("order-aaaaaaaaaaaaaaaaaa"))?.notified
        .telegram,
    ).toBe("failed");

    notifyShop.mockRejectedValue(new Error("threw"));
    const r2 = await json(
      await call(body({ orderId: "order-ffffffffffffffffff" })),
    );
    expect(r2.ok).toBe(true);
    expect(
      (await getStorage().getOrder("order-ffffffffffffffffff"))?.notified
        .telegram,
    ).toBe("failed");
  });

  it("returns server_error when a sibling throws, and rate limits per IP", async () => {
    buildSheetPdf.mockRejectedValueOnce(new Error("pdf exploded"));
    const res = await call(body());
    expect(res.status).toBe(500);
    expect(await json(res)).toMatchObject({ ok: false, error: "server_error" });

    for (let i = 0; i < 5; i++)
      await call(body({ orderId: `order-limit-${i}-aaaaaaaa` }), "7.7.7.7");
    const limited = await call(
      body({ orderId: "order-limit-9-aaaaaaaa" }),
      "7.7.7.7",
    );
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({
      ok: false,
      error: "rate_limited",
    });
  });

  it("works without any admin env vars (public path is independent of them)", async () => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    const res = await call(body());
    expect(res.status).toBe(200);
  });

  it("rejects oversize bodies with 413 and throttles before reading the body", async () => {
    const big = await POST(
      new Request("http://localhost/api/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(65 * 1024),
          "x-forwarded-for": "3.3.3.3",
        },
        body: JSON.stringify({ pad: "a".repeat(65 * 1024) }),
      }),
    );
    expect(big.status).toBe(413);

    for (let i = 0; i < 4; i++) await call({ nonsense: i }, "2.2.2.2");
    await call({ nonsense: 5 }, "2.2.2.2");
    const req = new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "x-forwarded-for": "2.2.2.2" },
      body: JSON.stringify({ nonsense: 6 }),
    });
    const limited = await POST(req);
    expect(limited.status).toBe(429);
    expect(req.bodyUsed).toBe(false);
  });
});

describe("POST /api/orders analytics + customers", () => {
  it("upserts the customer and records an order event (not on replay)", async () => {
    const storage = getStorage() as unknown as Record<string, unknown>;
    const upsert = vi.fn().mockResolvedValue(undefined);
    const record = vi.fn().mockResolvedValue(undefined);
    storage.upsertCustomerFromOrder = upsert;
    storage.recordEvent = record;
    const b = body({ orderId: "order-analytics-aaaaaa" });
    expect((await call(b)).status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({ customer: { phone: "9647701234567" } });
    expect(record).toHaveBeenCalledTimes(1);
    const ev = record.mock.calls[0][0];
    expect(ev.type).toBe("order");
    expect(ev.meta).toMatchObject({ material: "paper", sheets: 20, governorate: "بغداد", shape: "circle", widthMm: 30, heightMm: 30 });
    await call(b);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("still succeeds when the customer upsert throws", async () => {
    const storage = getStorage() as unknown as Record<string, unknown>;
    storage.upsertCustomerFromOrder = vi.fn().mockRejectedValue(new Error("boom"));
    storage.recordEvent = vi.fn().mockResolvedValue(undefined);
    expect((await call(body({ orderId: "order-analytics-bbbbbb" }))).status).toBe(200);
  });
});

describe("POST /api/orders with a sticker count", () => {
  const CIRCLE: StickerSpec = { shape: "circle", widthUm: 30000, heightUm: 30000 };
  const cpsFor = (spec: StickerSpec): number => {
    const out = computeLayout(spec, layoutParamsFor(spec, DEFAULT_SETTINGS.layout));
    if (!out.ok) throw new Error("layout expected");
    return out.layout.countPerSheet;
  };
  const cps = cpsFor(CIRCLE);
  const P = DEFAULT_SETTINGS.pricing;
  const stickerBody = (over: Record<string, unknown> = {}) => {
    const b: Record<string, unknown> = { ...body(), ...over };
    if (!("sheets" in over)) delete b.sheets;
    return b;
  };

  it("rounds the sheets up, ignores the client's sheets and stores the typed count", async () => {
    // 11 full sheets + 1 sticker -> 12 sheets. The client claims 3 sheets (below the minimum): ignored.
    const stickers = cps * 11 + 1;
    const res = await call(stickerBody({ orderId: "order-stickers-aaaaaaa", stickers, sheets: 3, totalIqd: 1 }));
    expect(res.status).toBe(200);
    const r = await json(res);
    if (!r.ok) throw new Error("expected ok");
    const raw = 800 * 12 + 5000;
    const total = Math.max(5000, Math.round(raw / 1000) * 1000);
    expect(r.summary).toMatchObject({
      sheets: 12,
      countPerSheet: cps,
      totalStickers: 12 * cps,
      requestedStickers: stickers,
      unitPriceIqd: 800,
      subtotalIqd: total - 5000,
      totalIqd: total,
    });
    const stored = await getStorage().getOrder("order-stickers-aaaaaaa");
    expect(stored?.price.requestedStickers).toBe(stickers);
    expect(stored?.price.sheets).toBe(12);
    expect(stored?.price.roundingIqd).toBe(total - raw);
    expect(notifyShop.mock.calls[0][2] as string).toMatch(/_x12\.pdf$/);
  });

  it("accepts exactly the minimum (stickers of minSheets sheets) and rejects one less", async () => {
    const ok = await call(stickerBody({ orderId: "order-stickers-minokaa", stickers: P.minSheets * cps }));
    expect(ok.status).toBe(200);
    const r = await json(ok);
    if (!r.ok) throw new Error("expected ok");
    expect(r.summary.sheets).toBe(P.minSheets);
    const low = await call(stickerBody({ orderId: "order-stickers-minlowa", stickers: P.minSheets * cps - 1 }));
    expect(low.status).toBe(400);
    expect(await json(low)).toMatchObject({ ok: false, error: "invalid_quantity" });
    expect(await getStorage().getOrder("order-stickers-minlowa")).toBeNull();
  });

  it("rejects more than the stickers of maxSheets sheets, even with a valid client sheet count", async () => {
    const res = await call(stickerBody({ orderId: "order-stickers-maxaaaa", stickers: P.maxSheets * cps + 1, sheets: 20 }));
    expect(await json(res)).toMatchObject({ ok: false, error: "invalid_quantity" });
  });

  it("rejects a fractional, zero or string sticker count and a request without stickers or sheets", async () => {
    for (const [i, stickers] of [600.5, 0, -600, "600", 10_000_001].entries()) {
      const res = await call(stickerBody({ orderId: `order-stickers-bad${i}aa`, stickers }));
      expect(res.status, String(stickers)).toBe(400);
      expect(await json(res)).toMatchObject({ ok: false, error: "invalid_request" });
    }
    const none = await call(stickerBody({ orderId: "order-stickers-noneaaa" }));
    expect(await json(none)).toMatchObject({ ok: false, error: "invalid_request" });
  });

  it("an old sheets-only request still works and stores no requestedStickers", async () => {
    const r = await json(await call(body({ orderId: "order-sheetsonly-aaaa", sheets: 12 })));
    if (!r.ok) throw new Error("expected ok");
    expect(r.summary.sheets).toBe(12);
    expect(r.summary).not.toHaveProperty("requestedStickers");
    const stored = await getStorage().getOrder("order-sheetsonly-aaaa");
    expect(stored?.price).not.toHaveProperty("requestedStickers");
  });

  it("unpublished prices: money fields null, counts and typed count kept", async () => {
    await getStorage().saveSettings({ ...DEFAULT_SETTINGS, pricesPublished: false });
    const r = await json(await call(stickerBody({ orderId: "order-stickers-hidden", stickers: cps * 10 + 5 })));
    if (!r.ok) throw new Error("expected ok");
    expect(r.summary).toMatchObject({ sheets: 11, requestedStickers: cps * 10 + 5, unitPriceIqd: null, subtotalIqd: null, totalIqd: null });
    expect((await getStorage().getOrder("order-stickers-hidden"))?.price.roundingIqd).toBeNull();
  });

  it("keeps the error order: captcha -> phone -> quantity -> upload -> layout -> artwork", async () => {
    // bad phone AND bad stickers -> phone
    expect(
      await json(await call(stickerBody({ orderId: "order-prec-phoneaaaaa", stickers: 1, customer: { ...body().customer, phone: "12345" } }))),
    ).toMatchObject({ error: "invalid_phone" });
    // bad stickers AND missing upload -> quantity
    expect(
      await json(await call(stickerBody({ orderId: "order-prec-qtyaaaaaaa", stickers: 1, uploadId: "upload-zzzzzzzzzzzzzzzz" }))),
    ).toMatchObject({ error: "invalid_quantity" });
    // layout too big: the range check is skipped, so a missing upload still wins over the layout ...
    const big = { shape: "rect", corners: "sharp", widthUm: 300000, heightUm: 300000 };
    expect(
      await json(await call(stickerBody({ orderId: "order-prec-uploadaaaa", stickers: 1, spec: big, uploadId: "upload-zzzzzzzzzzzzzzzz" }))),
    ).toMatchObject({ error: "upload_missing" });
    // ... and with the upload present the layout error comes at its usual place.
    expect(await json(await call(stickerBody({ orderId: "order-prec-layoutaaaa", stickers: 1, spec: big })))).toMatchObject({
      error: "too_big_for_page",
    });
    // A disabled material is still a quantity error even when the layout fails.
    await getStorage().saveSettings({
      ...DEFAULT_SETTINGS,
      pricing: { ...P, materials: { ...P.materials, plastic: { enabled: false, pricePerSheetIqd: 1500 } } },
    });
    expect(
      await json(await call(stickerBody({ orderId: "order-prec-materialaa", stickers: 1, material: "plastic", spec: big, uploadId: "upload-zzzzzzzzzzzzzzzz" }))),
    ).toMatchObject({ error: "invalid_quantity" });
    // artwork errors come after a valid sticker count
    normaliseArtwork.mockResolvedValueOnce({ ok: false, error: "low_dpi" });
    expect(await json(await call(stickerBody({ orderId: "order-prec-artworkaa", stickers: cps * 10 })))).toMatchObject({ error: "low_dpi" });
    expect(buildSheetPdf).not.toHaveBeenCalled();
  });

  it("adds requestedStickers to the analytics order event", async () => {
    const storage = getStorage() as unknown as Record<string, unknown>;
    const record = vi.fn().mockResolvedValue(undefined);
    storage.recordEvent = record;
    expect((await call(stickerBody({ orderId: "order-stickers-event1", stickers: 600 }))).status).toBe(200);
    expect(record.mock.calls[0][0].meta).toMatchObject({ requestedStickers: 600, sheets: Math.ceil(600 / cps) });
    expect((await call(body({ orderId: "order-stickers-event2" }))).status).toBe(200);
    expect(record.mock.calls[1][0].meta).not.toHaveProperty("requestedStickers");
  });
});

describe("POST /api/orders layout agrees with the browser", () => {
  it("returns the countPerSheet safeLayout() gives (circle 5.8 cm, rotation on, 15)", async () => {
    const layoutSettings = { ...DEFAULT_SETTINGS.layout, allowRotate: true };
    await getStorage().saveSettings({
      ...DEFAULT_SETTINGS,
      whatsapp: "9647709999999",
      pricesPublished: true,
      layout: layoutSettings,
    });
    const spec: StickerSpec = { shape: "circle", widthUm: 58000, heightUm: 58000 };
    const browser = safeLayout(spec, layoutSettings);
    if (!browser.ok) throw new Error("layout expected");
    const res = await call(body({ orderId: "order-agree-aaaaaaaaaa", spec }));
    const r = await json(res);
    if (!r.ok) throw new Error("expected ok");
    expect(r.summary.countPerSheet).toBe(browser.layout.countPerSheet);
    expect(r.summary.countPerSheet).toBe(15);
  });
});
