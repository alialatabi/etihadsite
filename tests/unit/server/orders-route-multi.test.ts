/**
 * POST /api/orders with `designs` (multi-design orders): the stored record, the one sheet PDF with
 * the same number of copies of every design, per-design errors, replay and the lower-DPI pass.
 * Normalising is mocked (one artwork per design); the multi sheet builder is the real one, wrapped
 * so a test can pretend the PDF is too large.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import type { MultiSheetPdfInput, NormalisedArtwork, OrderResponse } from "@/lib/types";
import { setupEnv } from "./helpers";
import { raster } from "../pdf/pdf-helpers";

const normaliseArtwork = vi.fn();
const notifyShop = vi.fn();
const buildMulti = vi.fn();

vi.mock("@/lib/design/normalise.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/design/normalise.server")>()),
  normaliseArtwork: (...a: unknown[]) => normaliseArtwork(...a),
}));
vi.mock("@/lib/pdf/build-multi-sheet", () => ({
  buildMultiSheetPdf: (...a: unknown[]) => buildMulti(...a),
}));
vi.mock("@/lib/notify", () => ({ notifyShop: (...a: unknown[]) => notifyShop(...a) }));
import { POST } from "@/app/api/orders/route";
import { computeMultiLayout } from "@/lib/layout";
import { priceForStickers } from "@/lib/pricing";
import { getStorage } from "@/lib/storage";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const UP = ["upload-multi-aaaaaaaa1", "upload-multi-aaaaaaaa2", "upload-multi-aaaaaaaa3"];
const SIZES = [30_000, 25_000, 40_000];

const designs = (n = 3) => UP.slice(0, n).map((uploadId, i) => ({ uploadId, widthUm: SIZES[i], heightUm: SIZES[i] }));

function body(over: Record<string, unknown> = {}) {
  return {
    orderId: "order-multi-aaaaaaaaaa",
    uploadId: UP[0],
    spec: { shape: "circle", widthUm: SIZES[0], heightUm: SIZES[0] },
    material: "paper",
    stickers: 3000,
    designs: designs(),
    customer: { name: "علي", phone: "07701234567", governorate: "بغداد", district: "الكرادة", landmark: "قرب الجسر" },
    ...over,
  };
}

let ipSeq = 0;
function call(b: unknown) {
  return POST(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `8.8.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}` },
      body: JSON.stringify(b),
    }),
  );
}
const json = async (res: Response) => (await res.json()) as OrderResponse;

const meta = (name: string) => ({ mime: "image/png", originalName: name, bytes: PNG.length, createdAt: new Date().toISOString() });

/** An artwork per design; the second one is a JPEG without transparency. */
async function artworks(): Promise<NormalisedArtwork[]> {
  return [await raster(60, 60, true), await raster(50, 50, false), await raster(80, 80, true)];
}

beforeEach(async () => {
  setupEnv();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const arts = await artworks();
  normaliseArtwork.mockReset().mockImplementation(async (_bytes: Uint8Array, opts: { spec: { widthUm: number } }) => {
    const i = SIZES.indexOf(opts.spec.widthUm);
    const artwork = arts[i];
    return {
      ok: true,
      kind: artwork.kind === "raster" && artwork.hasAlpha ? "png" : "jpeg",
      pxWidth: 900 + i,
      pxHeight: 900 + i,
      artwork,
    };
  });
  notifyShop.mockReset().mockResolvedValue({ telegram: "sent" });
  const real = await vi.importActual<typeof import("@/lib/pdf/build-multi-sheet")>("@/lib/pdf/build-multi-sheet");
  buildMulti.mockReset().mockImplementation((input: MultiSheetPdfInput) => real.buildMultiSheetPdf(input));
  const storage = getStorage();
  for (let i = 0; i < 3; i++) await storage.saveUpload(UP[i], PNG, meta(`logo${i + 1}.png`));
  await storage.saveSettings({ ...DEFAULT_SETTINGS, whatsapp: "9647709999999", pricesPublished: true });
});

describe("POST /api/orders multi-design", () => {
  it("stores the designs, the paths, the layout counts and a PDF with countPerSheet drawings", async () => {
    const res = await call(body());
    expect(res.status).toBe(200);
    const r = await json(res);
    if (!r.ok) throw new Error("expected ok");

    const specs = designs().map((d) => ({ shape: "circle" as const, widthUm: d.widthUm, heightUm: d.heightUm }));
    const outcome = computeMultiLayout(specs, DEFAULT_SETTINGS.layout);
    if (!outcome.ok) throw new Error("layout");
    const { countPerSheet, perDesign } = outcome.layout;
    expect(countPerSheet).toBe(3 * perDesign);
    const sheets = Math.ceil(3000 / countPerSheet);
    expect(r.summary).toMatchObject({ countPerSheet, sheets, perDesign, requestedStickers: 3000 });
    expect(r.summary.designs).toEqual([
      { widthUm: 30_000, heightUm: 30_000, cutOut: true },
      { widthUm: 25_000, heightUm: 25_000 },
      { widthUm: 40_000, heightUm: 40_000, cutOut: true },
    ]);
    expect(r.summary.totalIqd).toBe(priceForStickers("paper", 3000, countPerSheet, { ...DEFAULT_SETTINGS, pricesPublished: true }).totalIqd);

    const stored = await getStorage().getOrder("order-multi-aaaaaaaaaa");
    expect(stored?.files).toEqual({
      designPath: `uploads/${UP[0]}.bin`,
      pdfPath: "orders/order-multi-aaaaaaaaaa.pdf",
      designPaths: UP.map((u) => `uploads/${u}.bin`),
    });
    expect(stored?.layout).toMatchObject({ designCount: 3, perDesign, cols: perDesign, rows: 1, rotated: false, countPerSheet });
    expect(stored?.layout).not.toHaveProperty("turnedCount");
    expect(stored?.designs?.map((d) => [d.originalName, d.widthUm, d.cutOut, d.kind])).toEqual([
      ["logo1.png", 30_000, true, "png"],
      ["logo2.png", 25_000, undefined, "jpeg"],
      ["logo3.png", 40_000, true, "png"],
    ]);
    // `design` is design 0.
    expect(stored?.design).toMatchObject({ originalName: "logo1.png", kind: "png", cutOut: true, pxWidth: 900 });

    const pdf = await getStorage().readFile(stored!.files.pdfPath);
    const out = await buildMulti.mock.results[0].value;
    expect(out.report.drawCount).toBe(countPerSheet);
    expect((await PDFDocument.load(pdf!)).getPageCount()).toBe(1);
    // ASCII file name for the Telegram document.
    expect(notifyShop.mock.calls[0][2]).toBe(`${r.displayNo}_multi-3designs_x${sheets}.pdf`);
    expect(notifyShop.mock.calls[0][0].designs).toHaveLength(3);
  });

  it("reads each design of the order, never trusting a client price", async () => {
    const r = await json(await call(body({ totalIqd: 1, priceIqd: 1 })));
    if (!r.ok) throw new Error("expected ok");
    expect(r.summary.totalIqd).not.toBe(1);
  });

  it("names the design whose upload is missing", async () => {
    const res = await call(body({ orderId: "order-multi-missing0001", designs: [...designs(2), { uploadId: "upload-multi-never0001", widthUm: 40_000, heightUm: 40_000 }] }));
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ ok: false, error: "upload_missing", designIndex: 2 });
    expect(await getStorage().getOrder("order-multi-missing0001")).toBeNull();
  });

  it("names the design that cannot be normalised", async () => {
    normaliseArtwork.mockImplementation(async (_b: Uint8Array, opts: { spec: { widthUm: number } }) =>
      opts.spec.widthUm === SIZES[1] ? { ok: false, error: "low_dpi" } : { ok: true, kind: "jpeg", pxWidth: 9, pxHeight: 9, artwork: (await artworks())[0] },
    );
    const res = await call(body({ orderId: "order-multi-lowdpi00001" }));
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ ok: false, error: "low_dpi", designIndex: 1 });
  });

  it("names the design that does not fit the page", async () => {
    const big = [designs()[0], { uploadId: UP[1], widthUm: 300_000, heightUm: 300_000 }];
    const res = await call(body({ orderId: "order-multi-toobig00001", designs: big }));
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ ok: false, error: "too_big_for_page", designIndex: 1 });
  });

  it("refuses a total below the minimum for the layout", async () => {
    const res = await call(body({ orderId: "order-multi-small000001", stickers: 5 }));
    expect(await json(res)).toMatchObject({ ok: false, error: "invalid_quantity" });
    expect(res.status).toBe(400);
  });

  it("refuses designs the schema does not allow (mismatched first design, duplicates, sheets only)", async () => {
    const d = designs();
    const cases = [
      body({ designs: [{ ...d[0], widthUm: 31_000, heightUm: 31_000 }, d[1]] }),
      body({ designs: [d[1], d[0]] }),
      body({ designs: [d[0], { ...d[1], uploadId: UP[0] }] }),
      body({ designs: [d[0]] }),
      body({ stickers: undefined, sheets: 20 }),
    ];
    for (const c of cases) {
      const res = await call({ ...c, orderId: "order-multi-schema00001" });
      expect(res.status).toBe(400);
      expect(await json(res)).toMatchObject({ ok: false, error: "invalid_request" });
    }
  });

  it("replays the same request with the same answer, and refuses another set of designs for a known orderId", async () => {
    const first = await json(await call(body({ orderId: "order-multi-replay00001" })));
    const again = await json(await call(body({ orderId: "order-multi-replay00001" })));
    if (!first.ok || !again.ok) throw new Error("expected ok");
    expect(again.displayNo).toBe(first.displayNo);
    expect(notifyShop).toHaveBeenCalledTimes(1);

    // Same orderId with only two designs, or as a single-design request: not a replay.
    const two = await call(body({ orderId: "order-multi-replay00001", designs: designs(2) }));
    expect(await json(two)).toMatchObject({ ok: false, error: "invalid_request" });
    const single = await call({ ...body({ orderId: "order-multi-replay00001" }), designs: undefined });
    expect(await json(single)).toMatchObject({ ok: false, error: "invalid_request" });
    // Reordered designs are another request.
    const d = designs();
    const swapped = await call(body({ orderId: "order-multi-replay00001", uploadId: UP[1], spec: { shape: "circle", widthUm: SIZES[1], heightUm: SIZES[1] }, designs: [d[1], d[0], d[2]] }));
    expect(await json(swapped)).toMatchObject({ ok: false, error: "invalid_request" });
  });

  it("replaying a SINGLE order with a multi request is refused (the other direction)", async () => {
    const single = await json(
      await call({ ...body({ orderId: "order-single-replay001" }), designs: undefined, stickers: undefined, sheets: 20 }),
    );
    // (a single order has no `designs`; the stored record has no designPaths)
    expect(single.ok).toBe(true);
    const multi = await call(body({ orderId: "order-single-replay001" }));
    expect(await json(multi)).toMatchObject({ ok: false, error: "invalid_request" });
  });

  it("re-normalises every raster design at 600 DPI when the sheet PDF is over the limit, and stops when it fits", async () => {
    const big = new Uint8Array(15 * 1024 * 1024);
    const real = await vi.importActual<typeof import("@/lib/pdf/build-multi-sheet")>("@/lib/pdf/build-multi-sheet");
    let n = 0;
    buildMulti.mockImplementation(async (input: MultiSheetPdfInput) => {
      const out = await real.buildMultiSheetPdf(input);
      return n++ === 0 ? { ...out, bytes: big } : out;
    });
    const r = await json(await call(body({ orderId: "order-multi-dpi0000001" })));
    expect(r.ok).toBe(true);
    const dpis = normaliseArtwork.mock.calls.map((c) => (c[1] as { targetDpi: number }).targetDpi);
    expect(dpis).toEqual([1200, 1200, 1200, 600, 600, 600]);
    expect(buildMulti).toHaveBeenCalledTimes(2);
  });

  it("goes down to 300 DPI when 600 is still too large, and keeps the last set when a pass fails", async () => {
    const big = new Uint8Array(15 * 1024 * 1024);
    const real = await vi.importActual<typeof import("@/lib/pdf/build-multi-sheet")>("@/lib/pdf/build-multi-sheet");
    buildMulti.mockImplementation(async (input: MultiSheetPdfInput) => ({ ...(await real.buildMultiSheetPdf(input)), bytes: big }));
    const r = await json(await call(body({ orderId: "order-multi-dpi0000002" })));
    expect(r.ok).toBe(true);
    const dpis = normaliseArtwork.mock.calls.map((c) => (c[1] as { targetDpi: number }).targetDpi);
    expect(dpis).toEqual([1200, 1200, 1200, 600, 600, 600, 300, 300, 300]);

    // A failing lower-DPI pass: the order still goes through with the 1200 DPI sheet.
    normaliseArtwork.mockReset().mockImplementation(async (_b: Uint8Array, opts: { spec: { widthUm: number }; targetDpi: number }) => {
      const arts = await artworks();
      if (opts.targetDpi < 1200 && opts.spec.widthUm === SIZES[2]) return { ok: false, error: "corrupt" };
      return { ok: true, kind: "png", pxWidth: 9, pxHeight: 9, artwork: arts[SIZES.indexOf(opts.spec.widthUm)] };
    });
    const r2 = await json(await call(body({ orderId: "order-multi-dpi0000003" })));
    expect(r2.ok).toBe(true);
  });

  /** The first mock artwork becomes a vector PDF (its normalised bytes are the upload's). */
  const asPdfs = () =>
    normaliseArtwork.mockReset().mockImplementation(async (bytes: Uint8Array) => ({
      ok: true,
      kind: "pdf",
      pxWidth: 100,
      pxHeight: 100,
      artwork: { kind: "pdf", bytes, box: { x: 0, y: 0, width: 100, height: 100 }, rotate: 0, pageCount: 1 },
    }));
  const OVER = 15 * 1024 * 1024;

  it("asks the browser to turn the largest vector PDF into a picture when the sheet is over the limit (no pass at lower DPI)", async () => {
    // Only the PDFs' bytes matter here, and no lower DPI can shrink them: the builder is stubbed.
    asPdfs();
    buildMulti.mockReset().mockResolvedValue({ bytes: new Uint8Array(OVER), report: { drawCount: 0 } });
    await getStorage().saveUpload(UP[2], new Uint8Array(PNG.length + 500), meta("big.pdf"));
    const res = await call(body({ orderId: "order-multi-vector0001" }));
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ ok: false, error: "needs_raster", designIndex: 2 });
    expect(normaliseArtwork).toHaveBeenCalledTimes(3);
    expect(await getStorage().getOrder("order-multi-vector0001")).toBeNull();
  });

  it("does not store an oversized sheet: the retry with the PDF as a picture goes through", async () => {
    // First request: three PDFs over the limit. Then design 2 is a small picture and the sheet fits.
    asPdfs();
    buildMulti.mockReset().mockResolvedValue({ bytes: new Uint8Array(OVER), report: { drawCount: 0 } });
    const first = await json(await call(body({ orderId: "order-multi-vector0002" })));
    expect(first).toMatchObject({ ok: false, error: "needs_raster", designIndex: 0 });
    const arts = await artworks();
    normaliseArtwork.mockReset().mockImplementation(async (_b: Uint8Array, opts: { spec: { widthUm: number } }) => ({
      ok: true,
      kind: "png",
      pxWidth: 9,
      pxHeight: 9,
      artwork: arts[SIZES.indexOf(opts.spec.widthUm)],
    }));
    const real = await vi.importActual<typeof import("@/lib/pdf/build-multi-sheet")>("@/lib/pdf/build-multi-sheet");
    buildMulti.mockReset().mockImplementation((input: MultiSheetPdfInput) => real.buildMultiSheetPdf(input));
    expect((await json(await call(body({ orderId: "order-multi-vector0002" })))).ok).toBe(true);
  });

  it("a picture next to over-sized PDFs: the picture goes down in DPI, then the biggest PDF is named", async () => {
    const arts = await artworks();
    // A PDF's file size says nothing about the sheet (only page 1 is drawn), so the sheet is built once and judged by its size.
    normaliseArtwork.mockReset().mockImplementation(async (_b: Uint8Array, opts: { spec: { widthUm: number } }) =>
      opts.spec.widthUm === SIZES[0]
        ? { ok: true, kind: "png", pxWidth: 9, pxHeight: 9, artwork: arts[0] }
        : { ok: true, kind: "pdf", pxWidth: 9, pxHeight: 9, artwork: { kind: "pdf", bytes: new Uint8Array(OVER), box: { x: 0, y: 0, width: 100, height: 100 }, rotate: 0, pageCount: 1 } },
    );
    buildMulti.mockReset().mockResolvedValue({ bytes: new Uint8Array(OVER), report: { drawCount: 0 } });
    await getStorage().saveUpload(UP[1], new Uint8Array(PNG.length + 900), meta("big1.pdf"));
    const res = await json(await call(body({ orderId: "order-multi-vector0003" })));
    expect(res).toMatchObject({ ok: false, error: "needs_raster", designIndex: 1 });
    expect(normaliseArtwork).toHaveBeenCalledTimes(9); // 1200, 600 and 300 DPI
    expect(buildMulti).toHaveBeenCalledTimes(3);
  });

  it("accepts vector PDFs whose file size is large but whose sheet fits (only page 1 is drawn)", async () => {
    // The artwork bytes of each PDF are over the cap, the built sheet is small: the order goes through.
    normaliseArtwork.mockReset().mockImplementation(async () => ({
      ok: true,
      kind: "pdf",
      pxWidth: 9,
      pxHeight: 9,
      artwork: { kind: "pdf", bytes: new Uint8Array(OVER), box: { x: 0, y: 0, width: 100, height: 100 }, rotate: 0, pageCount: 2 },
    }));
    buildMulti.mockReset().mockResolvedValue({ bytes: new Uint8Array(1000), report: { drawCount: 0 } });
    expect((await json(await call(body({ orderId: "order-multi-vector0004" })))).ok).toBe(true);
    expect(buildMulti).toHaveBeenCalledTimes(1);
  });

  it("skips building a pass whose raster artwork is far over the limit and goes to the next DPI", async () => {
    const arts = await artworks();
    const HUGE = 3 * OVER; // more than 3 x the 14 MiB cap
    normaliseArtwork.mockReset().mockImplementation(async (_b: Uint8Array, opts: { spec: { widthUm: number }; targetDpi: number }) => {
      const a = arts[SIZES.indexOf(opts.spec.widthUm)];
      const artwork = opts.targetDpi === 1200 && a.kind === "raster" ? { ...a, bytes: new Uint8Array(HUGE / 3 + 1) } : a;
      return { ok: true, kind: "png", pxWidth: 9, pxHeight: 9, artwork };
    });
    const r = await json(await call(body({ orderId: "order-multi-floor000001" })));
    expect(r.ok).toBe(true);
    const dpis = normaliseArtwork.mock.calls.map((c) => (c[1] as { targetDpi: number }).targetDpi);
    expect(dpis).toEqual([1200, 1200, 1200, 600, 600, 600]);
    expect(buildMulti).toHaveBeenCalledTimes(1); // the 1200 DPI sheet was never built
  });

  it("still builds a pass whose raster artwork is only a little over the limit (the sheet may be smaller)", async () => {
    const arts = await artworks();
    normaliseArtwork.mockReset().mockImplementation(async (_b: Uint8Array, opts: { spec: { widthUm: number } }) => {
      const a = arts[SIZES.indexOf(opts.spec.widthUm)];
      return { ok: true, kind: "png", pxWidth: 9, pxHeight: 9, artwork: a.kind === "raster" ? { ...a, bytes: new Uint8Array(6 * 1024 * 1024) } : a };
    });
    // 18 MiB of artwork, but the (stubbed) sheet is small: built once, accepted at 1200 DPI.
    buildMulti.mockReset().mockResolvedValue({ bytes: new Uint8Array(1000), report: { drawCount: 0 } });
    const r = await json(await call(body({ orderId: "order-multi-floor000002" })));
    expect(r.ok).toBe(true);
    expect(buildMulti).toHaveBeenCalledTimes(1);
    expect(normaliseArtwork).toHaveBeenCalledTimes(3);
  });
});
