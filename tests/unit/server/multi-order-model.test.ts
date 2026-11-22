/**
 * The multi-design order model: request schema, stored record, summary and text, Telegram caption,
 * file names. Single-design output is pinned elsewhere (goldens); here it only has to stay free of
 * the new lines and keys.
 */
import { describe, expect, it } from "vitest";
import { MAX_DESIGNS } from "@/config/defaults";
import { computeMultiLayout } from "@/lib/layout";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import { orderPdfFileName } from "@/lib/display-no";
import { buildCaption } from "@/lib/notify/telegram";
import { buildMultiOrderRecord, isCutOutDesign, summaryOf } from "@/lib/order-record";
import { orderRequestSchema } from "@/lib/order-schema";
import { orderSummaryText } from "@/lib/order-text";
import type { NormalisedArtwork, OrderRequest, PriceBreakdown } from "@/lib/types";

const up = (i: number) => `upload-model-aaaaaaa${i}`;
const SIZES = [30_000, 25_000, 40_000, 20_000, 35_000, 22_000, 28_000, 26_000];

const base = (n = 3, over: Record<string, unknown> = {}) => ({
  orderId: "order-model-aaaaaaaaaa",
  uploadId: up(0),
  spec: { shape: "circle", widthUm: SIZES[0], heightUm: SIZES[0] },
  material: "paper",
  stickers: 1500,
  designs: Array.from({ length: n }, (_, i) => ({ uploadId: up(i), widthUm: SIZES[i], heightUm: SIZES[i] })),
  customer: { phone: "07701234567", governorate: "بغداد", district: "الكرادة", landmark: "x" },
  ...over,
});
const ok = (v: unknown) => orderRequestSchema.safeParse(v).success;

describe("orderRequestSchema multi designs", () => {
  it("accepts 2..MAX_DESIGNS designs whose first design is the main one", () => {
    expect(MAX_DESIGNS).toBe(8);
    for (const n of [2, 3, MAX_DESIGNS]) expect(ok(base(n))).toBe(true);
  });

  it("a single request parses exactly as before (no designs key)", () => {
    const { designs: _d, ...single } = base(3);
    void _d;
    const r = orderRequestSchema.safeParse({ ...single, stickers: undefined, sheets: 20 });
    expect(r.success && "designs" in r.data).toBe(false);
  });

  it("refuses fewer than 2, more than MAX_DESIGNS, a non-list, and an unknown field type", () => {
    expect(ok(base(1))).toBe(false);
    expect(ok({ ...base(3), designs: [] })).toBe(false);
    const nine = Array.from({ length: MAX_DESIGNS + 1 }, (_, i) => ({ uploadId: `upload-model-nine-${i}aaaa`, widthUm: 30_000, heightUm: 30_000 }));
    expect(ok({ ...base(3), designs: [{ uploadId: up(0), widthUm: 30_000, heightUm: 30_000 }, ...nine.slice(1)] })).toBe(false);
    expect(ok({ ...base(3), designs: "x" })).toBe(false);
  });

  it("never throws on a broken body: it is a refusal, not a 500", () => {
    const { spec: _s, ...noSpec } = base(3);
    void _s;
    const bad: unknown[] = [noSpec, { ...base(3), spec: null }, { ...base(3), designs: [null, null] }, { ...base(3), designs: [{}, {}] }, { ...base(3), uploadId: 5 }, { ...base(3), designs: [] }];
    for (const b of bad) expect(() => orderRequestSchema.safeParse(b)).not.toThrow();
    for (const b of bad) expect(ok(b)).toBe(false);
  });

  it("refuses a first design that is not the main upload or has another size", () => {
    const d = base(3).designs;
    expect(ok({ ...base(3), designs: [d[1], d[0], d[2]] })).toBe(false);
    expect(ok({ ...base(3), designs: [{ ...d[0], widthUm: 31_000, heightUm: 31_000 }, d[1], d[2]] })).toBe(false);
  });

  it("refuses duplicate uploads, bad ids and out-of-range sizes", () => {
    const d = base(3).designs;
    expect(ok({ ...base(3), designs: [d[0], d[1], { ...d[2], uploadId: d[1].uploadId }] })).toBe(false);
    expect(ok({ ...base(3), designs: [d[0], { ...d[1], uploadId: "short" }] })).toBe(false);
    expect(ok({ ...base(3), designs: [d[0], { ...d[1], widthUm: 0 }] })).toBe(false);
    expect(ok({ ...base(3), designs: [d[0], { ...d[1], heightUm: 400_001 }] })).toBe(false);
    expect(ok({ ...base(3), designs: [d[0], { ...d[1], widthUm: 1.5 }] })).toBe(false);
  });

  it("needs a sticker count, and keeps circles square", () => {
    expect(ok({ ...base(3), stickers: undefined, sheets: 20 })).toBe(false);
    const d = base(3).designs;
    expect(ok({ ...base(3), designs: [d[0], { ...d[1], heightUm: 26_000 }] })).toBe(false);
    // A rectangle design may be any size.
    const rect = { ...base(3), spec: { shape: "rect", corners: "sharp", widthUm: 30_000, heightUm: 40_000 }, designs: [{ uploadId: up(0), widthUm: 30_000, heightUm: 40_000 }, { uploadId: up(1), widthUm: 50_000, heightUm: 20_000 }] };
    expect(ok(rect)).toBe(true);
  });
});

/* ───────────────────────── record, summary, text, caption ───────────────────────── */

const RASTER_ALPHA: NormalisedArtwork = { kind: "raster", bytes: new Uint8Array([1]), mime: "image/png", pxWidth: 300, pxHeight: 300, hasAlpha: true, effectiveDpi: 700 };
const RASTER_FLAT: NormalisedArtwork = { ...RASTER_ALPHA, mime: "image/jpeg", hasAlpha: false, effectiveDpi: 650 };
const VECTOR: NormalisedArtwork = { kind: "pdf", bytes: new Uint8Array([1]), box: { x: 0, y: 0, width: 100, height: 100 }, rotate: 0, pageCount: 1 };
const PRICE: PriceBreakdown = {
  material: "paper",
  sheets: 20,
  unitBaseIqd: 800,
  discountPercent: 10,
  unitPriceIqd: 720,
  subtotalIqd: 14_400,
  deliveryFeeIqd: 5000,
  totalIqd: 19_000,
  totalStickers: 1500,
  requestedStickers: 1500,
  perStickerIqd: 10,
};

function multiRecord(n = 3, arts: NormalisedArtwork[] = [RASTER_ALPHA, RASTER_FLAT, VECTOR]) {
  const req = orderRequestSchema.parse(base(n)) as OrderRequest & { designs: NonNullable<OrderRequest["designs"]> };
  const specs = req.designs.map((d) => ({ ...req.spec, widthUm: d.widthUm, heightUm: d.heightUm }));
  const out = computeMultiLayout(specs, DEFAULT_SETTINGS.layout);
  if (!out.ok) throw new Error("layout");
  return buildMultiOrderRecord({
    req,
    phone: "9647701234567",
    displayNo: "EP-261122-AB3C",
    createdAt: "2026-11-22T09:00:00.000Z",
    layout: out.layout,
    designs: req.designs.map((_, i) => ({
      norm: { kind: arts[i % arts.length].kind === "pdf" ? "pdf" : (arts[i % arts.length] as { hasAlpha: boolean }).hasAlpha ? "png" : "jpeg", pxWidth: 900, pxHeight: 900, artwork: arts[i % arts.length] },
      uploadMeta: { mime: "image/png", originalName: `d${i + 1}.png`, bytes: 10 + i, createdAt: "2026-11-22T08:00:00.000Z" },
    })),
    price: PRICE,
    pdfPath: "orders/order-model-aaaaaaaaaa.pdf",
  });
}

describe("buildMultiOrderRecord", () => {
  it("stores designs, designPaths and the layout counts; design is design 0; key order stays", () => {
    const r = multiRecord();
    expect(Object.keys(r)).toEqual(["orderId", "displayNo", "createdAt", "status", "spec", "layout", "design", "designs", "price", "customer", "files", "notified"]);
    expect(r.files).toEqual({
      designPath: `uploads/${up(0)}.bin`,
      pdfPath: "orders/order-model-aaaaaaaaaa.pdf",
      designPaths: [0, 1, 2].map((i) => `uploads/${up(i)}.bin`),
    });
    expect(r.layout).toMatchObject({ rows: 1, rotated: false, designCount: 3, cols: r.layout.perDesign });
    expect(r.layout.countPerSheet).toBe(3 * (r.layout.perDesign ?? 0));
    expect(r.layout.cellWidthUm).toBe(30_000);
    expect("turnedCount" in r.layout).toBe(false);
    expect(r.designs).toEqual([
      { kind: "png", originalName: "d1.png", bytes: 10, pxWidth: 900, pxHeight: 900, effectiveDpi: 700, widthUm: 30_000, heightUm: 30_000, cutOut: true },
      { kind: "jpeg", originalName: "d2.png", bytes: 11, pxWidth: 900, pxHeight: 900, effectiveDpi: 650, widthUm: 25_000, heightUm: 25_000 },
      { kind: "pdf", originalName: "d3.png", bytes: 12, pxWidth: 900, pxHeight: 900, effectiveDpi: undefined, widthUm: 40_000, heightUm: 40_000 },
    ]);
    // «مفرغ» only for a raster with transparency; a PDF never has it.
    expect(r.designs?.map((d) => d.cutOut)).toEqual([true, undefined, undefined]);
    expect(r.design).toMatchObject({ originalName: "d1.png", cutOut: true });
  });

  it("a vector first design leaves `design.cutOut` out", () => {
    const r = multiRecord(2, [VECTOR, RASTER_ALPHA]);
    expect("cutOut" in r.design).toBe(false);
    expect(r.designs?.[1].cutOut).toBe(true);
  });

  it("isCutOutDesign: stored flag, or a png (single orders do not store it)", () => {
    expect(isCutOutDesign({ kind: "png" })).toBe(true);
    expect(isCutOutDesign({ kind: "jpeg" })).toBe(false);
    expect(isCutOutDesign({ kind: "pdf" })).toBe(false);
    expect(isCutOutDesign({ kind: "jpeg", cutOut: true })).toBe(true);
  });
});

describe("summary, text and file name of a multi-design order", () => {
  it("summaryOf adds designs and perDesign only for a multi record", () => {
    const r = multiRecord();
    const s = summaryOf(r);
    expect(s.designs).toEqual([
      { widthUm: 30_000, heightUm: 30_000, cutOut: true },
      { widthUm: 25_000, heightUm: 25_000 },
      { widthUm: 40_000, heightUm: 40_000 },
    ]);
    expect(s.perDesign).toBe(r.layout.perDesign);
    const single = { ...r, designs: undefined };
    delete (single as { designs?: unknown }).designs;
    expect("designs" in summaryOf(single) || "perDesign" in summaryOf(single)).toBe(false);
  });

  it("the WhatsApp text lists the count, each size with «مفرغ», and the copies of each design", () => {
    const r = multiRecord();
    const t = orderSummaryText(summaryOf(r));
    const lines = t.split("\n");
    expect(lines).toContain("التصاميم: 3 تصاميم");
    expect(lines).toContain("1) 3 × 3 سم — مفرغ");
    expect(lines).toContain("2) 2.5 × 2.5 سم");
    expect(lines).toContain("3) 4 × 4 سم");
    expect(lines).toContain(`من كل تصميم: ${r.price.sheets * (r.layout.perDesign ?? 0)} ستيكر`);
  });

  it("a single order's text has none of those lines", () => {
    const r = multiRecord();
    const s = { ...summaryOf(r) };
    delete s.designs;
    delete s.perDesign;
    expect(orderSummaryText(s)).not.toMatch(/التصاميم|من كل تصميم|مفرغ/);
  });

  it("the Telegram caption gets the designs block LAST, so a long caption loses it before the phone and total", () => {
    const r = multiRecord();
    const c = buildCaption(r, DEFAULT_SETTINGS);
    const lines = c.split("\n");
    const i = lines.findIndex((l) => l.startsWith("التصاميم:"));
    expect(i).toBeGreaterThan(lines.findIndex((l) => l.startsWith("الإجمالي")));
    expect(lines.slice(i)).toEqual([
      "التصاميم: 3 تصاميم",
      "1) 3 × 3 سم — مفرغ",
      "2) 2.5 × 2.5 سم",
      "3) 4 × 4 سم",
      `من كل تصميم: ${r.price.sheets * (r.layout.perDesign ?? 0)} ستيكر`,
    ]);
  });

  it("8 designs and the longest address: phone and total stay, the caption is within 1024 and the designs block is what gets cut", () => {
    const r = multiRecord(8, [RASTER_ALPHA]);
    r.customer = { ...r.customer, governorate: "ب".repeat(30), district: "ك".repeat(80), landmark: "ق".repeat(120) };
    const c = buildCaption(r, DEFAULT_SETTINGS);
    expect(c.length).toBeLessThanOrEqual(1024);
    expect(c).toContain("tel:+9647701234567");
    expect(c).toContain("الإجمالي");
    expect(c).not.toMatch(/&(?!(amp|lt|gt);)/);
    const lines = c.split("\n");
    // Whatever is cut, it is whole lines from the end.
    expect(lines.every((l) => l.length > 0)).toBe(true);
    expect(lines.some((l) => l.startsWith("1) "))).toBe(true);
    // The cut never splits a line: the last line is one of the designs lines, complete.
    expect(lines[lines.length - 1]).toMatch(/^(\d\) .+|التصاميم: .+|من كل تصميم: .+)$/);
  });

  it("a single order's caption has no designs block", () => {
    const r = multiRecord();
    const single = { ...r };
    delete single.designs;
    // An opaque single design (a transparent PNG gets its own «مفرغ» line: tests/unit/server/telegram.test.ts).
    single.design = { ...single.design, kind: 'jpeg' };
    delete single.design.cutOut;
    expect(buildCaption(single, DEFAULT_SETTINGS)).not.toMatch(/التصاميم|من كل تصميم|مفرغ/);
  });

  it("the print PDF of a multi order has its own ASCII name; a single one keeps its name", () => {
    const r = multiRecord();
    expect(orderPdfFileName(r)).toBe("EP-261122-AB3C_multi-3designs_x20.pdf");
    const single = { ...r, spec: { shape: "circle" as const, widthUm: 30_000, heightUm: 30_000 } };
    delete single.designs;
    expect(orderPdfFileName(single)).toBe("EP-261122-AB3C_circle-30x30mm_x20.pdf");
  });
});
