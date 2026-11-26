import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import type { OrderResponse } from "@/lib/types";
import { setupEnv } from "./helpers";

const normaliseArtwork = vi.fn();
const buildSheetPdf = vi.fn();
const notifyShop = vi.fn();
const reportError = vi.fn();

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
vi.mock("@/lib/monitoring/report", () => ({
  reportError: (...a: unknown[]) => reportError(...a),
}));
import { POST } from "@/app/api/orders/route";
import { getStorage } from "@/lib/storage";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PHONE = "9647701234567";
/** What the Supabase adapter throws: the status plus up to 200 characters of the response body. */
const ECHO = `[supabase] POST /rest/v1/orders -> 400 {"details":"Failing row contains (order-x, {"customer":{"phone":"${PHONE}"}})"}`;

function body() {
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
  };
}

let ipSeq = 0;
function call() {
  return POST(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `8.8.0.${++ipSeq}` },
      body: JSON.stringify(body()),
    }),
  );
}

const logCalls = () =>
  (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;

beforeEach(async () => {
  setupEnv();
  vi.spyOn(console, "error").mockImplementation(() => {});
  reportError.mockReset();
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
  buildSheetPdf.mockReset().mockResolvedValue({
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
  await storage.saveSettings({ ...DEFAULT_SETTINGS, whatsapp: "9647709999999", pricesPublished: true });
});

describe("POST /api/orders: platform log never carries a storage error body", () => {
  it("the outer catch logs scrubbed text, not the raw error", async () => {
    vi.spyOn(getStorage(), "saveOrder").mockRejectedValue(new Error(ECHO));
    const res = await call();
    expect(res.status).toBe(500);
    expect(((await res.json()) as OrderResponse).ok).toBe(false);
    const failed = logCalls().find((c) => c[0] === "[orders] failed");
    expect(failed).toBeDefined();
    expect(typeof failed![1]).toBe("string");
    expect(failed![1]).toContain("Failing row contains ([redacted])");
    expect(JSON.stringify(logCalls())).not.toContain(PHONE);
    // Sentry still gets the original error (its own scrubber handles it).
    expect(reportError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("a notify step that throws logs scrubbed text and the order still succeeds", async () => {
    notifyShop.mockRejectedValue(new Error(ECHO));
    const res = await call();
    expect(res.status).toBe(200);
    const threw = logCalls().find((c) => c[0] === "[orders] notify threw");
    expect(threw).toBeDefined();
    expect(typeof threw![1]).toBe("string");
    expect(JSON.stringify(logCalls())).not.toContain(PHONE);
  });
});

describe("POST /api/orders: a failed notified-state write does not fail a saved order", () => {
  it("answers ok, logs a code only and reports a fixed error", async () => {
    const storage = getStorage();
    const spy = vi.spyOn(storage, "updateOrder").mockRejectedValue(
      new Error(`[supabase] POST /rest/v1/rpc/patch_order -> 500 {"phone":"${PHONE}"}`),
    );
    const res = await call();
    expect(res.status).toBe(200);
    const r = (await res.json()) as OrderResponse;
    if (!r.ok) throw new Error("expected ok");
    expect(r.notified.telegram).toBe("sent");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(notifyShop).toHaveBeenCalledTimes(1);
    expect(await storage.getOrder("order-aaaaaaaaaaaaaaaaaa")).not.toBeNull();
    const logged = JSON.stringify(logCalls());
    expect(logged).toContain("notified-state save failed (500)");
    expect(logged).not.toContain(PHONE);
    const reported = reportError.mock.calls.find((c) => c[1]?.where === "orders.notifiedState");
    expect(reported).toBeDefined();
    expect((reported![0] as Error).message).toBe("Order notified-state save failed");
    spy.mockRestore();
  });
});
