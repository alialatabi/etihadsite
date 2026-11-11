import { describe, expect, it } from "vitest";
import { buildOrderRecord, summaryOf, type OrderRecordInput } from "@/lib/order-record";
import type { LayoutResult, NormalisedArtwork, OrderRequest, PriceBreakdown } from "@/lib/types";

const REQ: OrderRequest = {
  orderId: "order-aaaaaaaaaaaaaaaaaa",
  uploadId: "upload-aaaaaaaaaaaaaaaa",
  spec: { shape: "rect", corners: "rounded", widthUm: 42400, heightUm: 30000 },
  material: "plastic",
  sheets: 20,
  customer: {
    name: "Ali",
    phone: "0770 123 4567",
    governorate: "Baghdad",
    district: "Karrada",
    landmark: "Near the bridge",
    notes: "Call first",
  },
  turnstileToken: "never-stored",
};

const LAYOUT: LayoutResult = {
  page: { widthUm: 210000, heightUm: 297000 },
  marginUm: 7000,
  usable: { xUm: 7000, yUm: 7000, widthUm: 196000, heightUm: 283000 },
  cell: { widthUm: 30000, heightUm: 42400 },
  rotated: true,
  turnedCount: 4,
  gapXUm: 2000,
  gapYUm: 1000,
  cols: 6,
  rows: 6,
  countPerSheet: 40,
  block: { xUm: 8000, yUm: 9000, widthUm: 190000, heightUm: 259400 },
  placements: [{ xUm: 8000, yUm: 9000 }],
  clip: { kind: "roundedRect", radiusUm: 3000 },
};

const RASTER: NormalisedArtwork = {
  kind: "raster",
  bytes: new Uint8Array([1, 2, 3]),
  mime: "image/png",
  pxWidth: 501,
  pxHeight: 354,
  hasAlpha: true,
  effectiveDpi: 762.5,
};

const VECTOR: NormalisedArtwork = {
  kind: "pdf",
  bytes: new Uint8Array([1, 2, 3]),
  box: { x: 0, y: 0, width: 120.2, height: 85 },
  rotate: 0,
  pageCount: 1,
};

const PRICE: PriceBreakdown = {
  material: "plastic",
  sheets: 20,
  unitBaseIqd: 1500,
  discountPercent: 10,
  unitPriceIqd: 1350,
  subtotalIqd: 27000,
  deliveryFeeIqd: 5000,
  totalIqd: 32000,
  totalStickers: 800,
  perStickerIqd: 40,
};

function input(over: Partial<OrderRecordInput> = {}): OrderRecordInput {
  return {
    req: REQ,
    phone: "9647701234567",
    displayNo: "EP-261110-AB3C",
    createdAt: "2026-11-10T09:00:00.000Z",
    layout: LAYOUT,
    norm: { kind: "png", pxWidth: 1272, pxHeight: 900, artwork: RASTER },
    uploadMeta: { mime: "image/png", originalName: "logo.png", bytes: 4321, createdAt: "2026-11-10T08:55:00.000Z" },
    price: PRICE,
    pdfPath: "orders/order-aaaaaaaaaaaaaaaaaa.pdf",
    ...over,
  };
}

describe("buildOrderRecord", () => {
  it("builds the stored record with its exact keys, in order", () => {
    const expected =
      '{"orderId":"order-aaaaaaaaaaaaaaaaaa","displayNo":"EP-261110-AB3C","createdAt":"2026-11-10T09:00:00.000Z","status":"new",' +
      '"spec":{"shape":"rect","corners":"rounded","widthUm":42400,"heightUm":30000},' +
      '"layout":{"cols":6,"rows":6,"countPerSheet":40,"rotated":true,"turnedCount":4,"cellWidthUm":30000,"cellHeightUm":42400,"gapXUm":2000,"gapYUm":1000},' +
      '"design":{"kind":"png","originalName":"logo.png","bytes":4321,"pxWidth":1272,"pxHeight":900,"effectiveDpi":762.5},' +
      '"price":{"material":"plastic","sheets":20,"unitBaseIqd":1500,"discountPercent":10,"unitPriceIqd":1350,"subtotalIqd":27000,"deliveryFeeIqd":5000,"totalIqd":32000,"totalStickers":800,"perStickerIqd":40},' +
      '"customer":{"name":"Ali","phone":"9647701234567","governorate":"Baghdad","district":"Karrada","landmark":"Near the bridge","notes":"Call first"},' +
      '"files":{"designPath":"uploads/upload-aaaaaaaaaaaaaaaa.bin","pdfPath":"orders/order-aaaaaaaaaaaaaaaaaa.pdf"},' +
      '"notified":{"telegram":"skipped"}}';
    expect(JSON.stringify(buildOrderRecord(input()))).toBe(expected);
  });

  it("stores the normalised phone, not the one the customer typed", () => {
    expect(buildOrderRecord(input()).customer.phone).toBe("9647701234567");
  });

  it("leaves name and notes undefined when they are empty or missing", () => {
    const empty = buildOrderRecord(input({ req: { ...REQ, customer: { ...REQ.customer, name: "", notes: "" } } }));
    expect(empty.customer.name).toBeUndefined();
    expect(empty.customer.notes).toBeUndefined();
    expect(JSON.stringify(empty.customer)).toBe(
      '{"phone":"9647701234567","governorate":"Baghdad","district":"Karrada","landmark":"Near the bridge"}',
    );

    const bare = { phone: "0770 123 4567", governorate: "Baghdad", district: "Karrada", landmark: "Near the bridge" };
    const missing = buildOrderRecord(input({ req: { ...REQ, customer: bare } }));
    expect(missing.customer.name).toBeUndefined();
    expect(missing.customer.notes).toBeUndefined();
  });

  it("sets effectiveDpi for a raster design only", () => {
    const raster = buildOrderRecord(input());
    expect(raster.design.effectiveDpi).toBe(762.5);

    const vector = buildOrderRecord(input({ norm: { kind: "pdf", pxWidth: 120.2, pxHeight: 85, artwork: VECTOR } }));
    expect(vector.design.effectiveDpi).toBeUndefined();
    expect(JSON.stringify(vector.design)).toBe(
      '{"kind":"pdf","originalName":"logo.png","bytes":4321,"pxWidth":120.2,"pxHeight":85}',
    );
  });
});

describe("summaryOf", () => {
  it("picks the customer-facing fields, in order", () => {
    expect(JSON.stringify(summaryOf(buildOrderRecord(input())))).toBe(
      '{"displayNo":"EP-261110-AB3C","shape":"rect","corners":"rounded","widthUm":42400,"heightUm":30000,"countPerSheet":40,' +
        '"sheets":20,"material":"plastic","totalStickers":800,"unitPriceIqd":1350,"discountPercent":10,"subtotalIqd":27000,' +
        '"deliveryFeeIqd":5000,"totalIqd":32000}',
    );
  });
});
