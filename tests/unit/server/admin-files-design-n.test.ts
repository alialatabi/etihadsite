/** GET /api/admin/files/<orderId>/design-<n>: the Nth original upload of a multi-design order. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupEnv } from "./helpers";

let allowed = true;
vi.mock("@/lib/auth/session", () => ({
  adminApiGuard: async () => (allowed ? null : new Response(null, { status: 401 })),
}));

import { GET } from "@/app/api/admin/files/[orderId]/[which]/route";
import { getStorage } from "@/lib/storage";
import type { OrderRecord } from "@/lib/types";

const ID = "order-files-aaaaaaaaa";
const UP = ["upload-files-aaaaaaa1", "upload-files-aaaaaaa2", "upload-files-aaaaaaa3"];
const BYTES = [new Uint8Array([1, 1]), new Uint8Array([2, 2, 2]), new Uint8Array([3])];

function record(over: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderId: ID,
    displayNo: "EP-261122-AB3C",
    createdAt: new Date().toISOString(),
    status: "new",
    spec: { shape: "circle", widthUm: 30_000, heightUm: 30_000 },
    layout: { cols: 6, rows: 1, countPerSheet: 18, rotated: false, cellWidthUm: 30_000, cellHeightUm: 30_000, gapXUm: 2000, gapYUm: 0, designCount: 3, perDesign: 6 },
    design: { kind: "png", originalName: "a.png", bytes: 2, pxWidth: 10, pxHeight: 10 },
    designs: [
      { kind: "png", originalName: "a.png", bytes: 2, pxWidth: 10, pxHeight: 10, widthUm: 30_000, heightUm: 30_000 },
      { kind: "jpeg", originalName: "b.jpg", bytes: 3, pxWidth: 10, pxHeight: 10, widthUm: 25_000, heightUm: 25_000 },
      { kind: "pdf", originalName: "c.pdf", bytes: 1, pxWidth: 10, pxHeight: 10, widthUm: 40_000, heightUm: 40_000 },
    ],
    price: { material: "paper", sheets: 20, unitBaseIqd: null, discountPercent: 0, unitPriceIqd: null, subtotalIqd: null, deliveryFeeIqd: 5000, totalIqd: null, totalStickers: 360, perStickerIqd: null },
    customer: { phone: "9647701234567", governorate: "بغداد", district: "x", landmark: "y" },
    files: { designPath: `uploads/${UP[0]}.bin`, pdfPath: `orders/${ID}.pdf`, designPaths: UP.map((u) => `uploads/${u}.bin`) },
    notified: { telegram: "skipped" },
    ...over,
  };
}

const get = (which: string, orderId = ID) =>
  GET(new Request(`http://localhost/api/admin/files/${orderId}/${which}`), { params: Promise.resolve({ orderId, which }) });

beforeEach(async () => {
  allowed = true;
  setupEnv();
  const s = getStorage();
  for (let i = 0; i < 3; i++)
    await s.saveUpload(UP[i], BYTES[i], { mime: "image/png", originalName: `f${i}`, bytes: BYTES[i].length, createdAt: new Date().toISOString() });
  await s.saveOrder(record());
});

describe("admin files route: design-<n>", () => {
  it("serves the second design with its own kind, name and bytes", async () => {
    const res = await get("design-2");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="EP-261122-AB3C_design-2.jpg"');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([2, 2, 2]);
    const third = await get("design-3");
    expect(third.headers.get("content-type")).toBe("application/pdf");
    expect([...new Uint8Array(await third.arrayBuffer())]).toEqual([3]);
  });

  it("the old `design` still answers with design 1", async () => {
    const res = await get("design");
    expect(res.status).toBe(200);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 1]);
  });

  it("refuses an index outside the list, a malformed one, and design-N on a single-design order", async () => {
    for (const w of ["design-0", "design-4", "design-9", "design-01", "design--1", "design-1.5", "design-", "design-x", "designs-1", "design-1000"])
      expect((await get(w)).status).toBe(404);
    const single = record({ orderId: "order-files-single01" });
    delete single.designs;
    delete single.files.designPaths;
    await getStorage().saveOrder(single);
    expect((await get("design-1", "order-files-single01")).status).toBe(404);
    expect((await get("design", "order-files-single01")).status).toBe(200);
  });

  it("is behind the admin guard", async () => {
    allowed = false;
    expect((await get("design-2")).status).toBe(401);
  });
});
