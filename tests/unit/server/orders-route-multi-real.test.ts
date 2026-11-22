/**
 * POST /api/orders with three REAL designs (a PNG with transparency, an opaque JPEG, a vector PDF)
 * through the real normaliseArtwork and the real multi sheet builder: «مفرغ» comes from the pixels,
 * the PDF is drawn once per cell, and the stored record says what each file is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { PDFDocument, PDFName } from "pdf-lib";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import type { OrderResponse } from "@/lib/types";
import { setupEnv } from "./helpers";
import { contentOf } from "../pdf/pdf-helpers";

const notifyShop = vi.fn();
vi.mock("@/lib/notify", () => ({ notifyShop: (...a: unknown[]) => notifyShop(...a) }));

import { POST } from "@/app/api/orders/route";
import { getStorage } from "@/lib/storage";

const UP = ["upload-real-aaaaaaa1", "upload-real-aaaaaaa2", "upload-real-aaaaaaa3"];
const SIZES = [30_000, 25_000, 40_000];

async function files(): Promise<{ bytes: Uint8Array; mime: string; name: string }[]> {
  // 400 px over 25-40 mm is far above the quality gate. Half-transparent pixels make it «مفرغ».
  const png = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0.5 } } }).png().toBuffer();
  const jpg = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 20, g: 120, b: 200 } } }).jpeg().toBuffer();
  const doc = await PDFDocument.create();
  // pdf-lib cannot embed a page without content.
  doc.addPage([100, 100]).drawRectangle({ x: 10, y: 10, width: 80, height: 80 });
  const pdf = await doc.save();
  return [
    { bytes: new Uint8Array(png), mime: "image/png", name: "logo.png" },
    { bytes: new Uint8Array(jpg), mime: "image/jpeg", name: "photo.jpg" },
    { bytes: new Uint8Array(pdf), mime: "application/pdf", name: "art.pdf" },
  ];
}

beforeEach(async () => {
  setupEnv();
  notifyShop.mockReset().mockResolvedValue({ telegram: "sent" });
  const storage = getStorage();
  const fs = await files();
  for (let i = 0; i < 3; i++)
    await storage.saveUpload(UP[i], fs[i].bytes, { mime: fs[i].mime, originalName: fs[i].name, bytes: fs[i].bytes.length, createdAt: new Date().toISOString() });
  await storage.saveSettings({ ...DEFAULT_SETTINGS, whatsapp: "9647709999999", pricesPublished: true });
});

describe("POST /api/orders multi-design, real files", () => {
  it("marks cutOut from the pixels (true, absent, absent) and draws countPerSheet cells", async () => {
    const res = await POST(
      new Request("http://localhost/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7" },
        body: JSON.stringify({
          orderId: "order-real-aaaaaaaaaa",
          uploadId: UP[0],
          spec: { shape: "circle", widthUm: SIZES[0], heightUm: SIZES[0] },
          material: "paper",
          stickers: 3000,
          designs: UP.map((uploadId, i) => ({ uploadId, widthUm: SIZES[i], heightUm: SIZES[i] })),
          customer: { phone: "07701234567", governorate: "بغداد", district: "الكرادة", landmark: "x" },
        }),
      }),
    );
    const r = (await res.json()) as OrderResponse;
    if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
    expect(res.status).toBe(200);

    const stored = await getStorage().getOrder("order-real-aaaaaaaaaa");
    expect(stored?.designs?.map((d) => [d.kind, d.cutOut, d.originalName])).toEqual([
      ["png", true, "logo.png"],
      ["jpeg", undefined, "photo.jpg"],
      ["pdf", undefined, "art.pdf"],
    ]);
    expect(stored?.designs?.[2].effectiveDpi).toBeUndefined();
    expect(stored?.design).toMatchObject({ kind: "png", cutOut: true });
    expect(r.summary.designs?.map((d) => d.cutOut)).toEqual([true, undefined, undefined]);

    // The sheet PDF: one page, and every cell of every design is drawn (3 × perDesign).
    const countPerSheet = stored!.layout.countPerSheet;
    expect(countPerSheet).toBe(3 * (stored!.layout.perDesign ?? 0));
    const pdf = await getStorage().readFile(stored!.files.pdfPath);
    const doc = await PDFDocument.load(pdf!);
    expect(doc.getPageCount()).toBe(1);
    // Each cell is one `Do` (an image or a form) in the page content.
    const stream = contentOf(doc.getPage(0));
    expect((stream.match(/\/\S+ Do/g) ?? []).length).toBe(countPerSheet);
    // Telegram got the same bytes under an ASCII name.
    expect(notifyShop.mock.calls[0][2]).toMatch(/^EP-\d{6}-[A-Z2-9]{4}_multi-3designs_x\d+\.pdf$/);
    expect(notifyShop.mock.calls[0][1]).toBeInstanceOf(Uint8Array);
  });

  it("asks for the biggest vector PDF as a picture when the sheet would not fit the bucket (two 8 MiB PDFs)", async () => {
    // Two vector PDFs of about 8 MiB each: below the upload limit, but the one sheet holds both whole (over 14 MiB).
    async function bigPdf(): Promise<Uint8Array> {
      const doc = await PDFDocument.create();
      const page = doc.addPage([100, 100]);
      page.drawRectangle({ x: 10, y: 10, width: 80, height: 80 });
      // Incompressible bytes in a resource the page carries: embedPage copies the page with everything on it.
      page.node.Resources()?.set(PDFName.of("Extra"), doc.context.register(doc.context.stream(randomBytes(8 * 1024 * 1024))));
      return doc.save({ useObjectStreams: false });
    }
    const storage = getStorage();
    const ids = ["upload-big-aaaaaaaa1", "upload-big-aaaaaaaa2"];
    for (const id of ids) {
      const bytes = await bigPdf();
      await storage.saveUpload(id, bytes, { mime: "application/pdf", originalName: "big.pdf", bytes: bytes.length, createdAt: new Date().toISOString() });
    }
    const res = await POST(
      new Request("http://localhost/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.8" },
        body: JSON.stringify({
          orderId: "order-bigpdf-aaaaaaaaa",
          uploadId: ids[0],
          spec: { shape: "rect", corners: "sharp", widthUm: 50_000, heightUm: 50_000 },
          material: "paper",
          stickers: 1000,
          designs: ids.map((uploadId) => ({ uploadId, widthUm: 50_000, heightUm: 50_000 })),
          customer: { phone: "07701234567", governorate: "بغداد", district: "الكرادة", landmark: "x" },
        }),
      }),
    );
    const r = (await res.json()) as OrderResponse;
    expect(res.status).toBe(400);
    expect(r).toMatchObject({ ok: false, error: "needs_raster", designIndex: 0 });
    expect(await storage.getOrder("order-bigpdf-aaaaaaaaa")).toBeNull();
    expect(notifyShop).not.toHaveBeenCalled();
  });

  it("accepts two big PDFs whose bulk sits on a page that is not drawn (the sheet is small)", async () => {
    async function bulkyPage2(): Promise<Uint8Array> {
      const doc = await PDFDocument.create();
      const pages = [doc.addPage([100, 100]), doc.addPage([100, 100])];
      for (const p of pages) p.drawRectangle({ x: 10, y: 10, width: 80, height: 80 });
      pages[1].node.Resources()?.set(PDFName.of("Extra"), doc.context.register(doc.context.stream(randomBytes(8 * 1024 * 1024))));
      return doc.save({ useObjectStreams: false });
    }
    const storage = getStorage();
    const ids = ["upload-bulk-aaaaaaa1", "upload-bulk-aaaaaaa2"];
    for (const id of ids) {
      const bytes = await bulkyPage2();
      await storage.saveUpload(id, bytes, { mime: "application/pdf", originalName: "bulk.pdf", bytes: bytes.length, createdAt: new Date().toISOString() });
    }
    const res = await POST(
      new Request("http://localhost/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.9" },
        body: JSON.stringify({
          orderId: "order-bulkpdf-aaaaaaaa",
          uploadId: ids[0],
          spec: { shape: "rect", corners: "sharp", widthUm: 50_000, heightUm: 50_000 },
          material: "paper",
          stickers: 1000,
          designs: ids.map((uploadId) => ({ uploadId, widthUm: 50_000, heightUm: 50_000 })),
          customer: { phone: "07701234567", governorate: "بغداد", district: "الكرادة", landmark: "x" },
        }),
      }),
    );
    expect(((await res.json()) as OrderResponse).ok).toBe(true);
  });
});
