import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
// A fresh id per test: a request left hanging by one test must not be joined by the next (inflight map).
let orderSeq = 0;
let ORDER_ID = "";
const UPLOAD_ID = "upload-bbbbbbbbbbbbbbbb";

const body = () => ({
  orderId: ORDER_ID,
  uploadId: UPLOAD_ID,
  spec: { shape: "circle", widthUm: 30000, heightUm: 30000 },
  material: "paper",
  sheets: 20,
  customer: { name: "علي", phone: "07701234567", governorate: "بغداد", district: "الكرادة", landmark: "قرب الجسر" },
});

let ipSeq = 0;
const call = () =>
  POST(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `8.9.0.${++ipSeq}` },
      body: JSON.stringify(body()),
    }),
  );

/** A promise that the test settles by hand. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
/** aiMarkOrdered is optional on the contract; the local adapter has it. */
const withMark = (s: ReturnType<typeof getStorage>) => s as typeof s & { aiMarkOrdered: (uploadId: string, orderId: string) => Promise<void> };
const flush =() => new Promise((r) => setTimeout(r, 25));
const logCalls = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;

beforeEach(async () => {
  ORDER_ID = `order-conc-${++orderSeq}-bbbbbbbb`;
  setupEnv();
  vi.spyOn(console, "error").mockImplementation(() => {});
  reportError.mockReset();
  normaliseArtwork.mockReset().mockResolvedValue({
    ok: true,
    kind: "png",
    pxWidth: 900,
    pxHeight: 900,
    artwork: { kind: "raster", bytes: PNG, mime: "image/png", pxWidth: 354, pxHeight: 354, hasAlpha: true, effectiveDpi: 300 },
  });
  buildSheetPdf.mockReset().mockResolvedValue({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), report: {} });
  notifyShop.mockReset().mockResolvedValue({ telegram: "sent" });
  const storage = getStorage();
  await storage.saveUpload(UPLOAD_ID, PNG, {
    mime: "image/png",
    originalName: "logo.png",
    bytes: PNG.length,
    createdAt: new Date().toISOString(),
  });
  await storage.saveSettings({ ...DEFAULT_SETTINGS, whatsapp: "9647709999999", pricesPublished: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/orders: best-effort writes run together with the Telegram notify", () => {
  it("all four start before any of them finishes, and updateOrder waits for all", async () => {
    const storage = getStorage();
    const mark = deferred();
    const upsert = deferred();
    const event = deferred();
    const notify = deferred<{ telegram: "sent" }>();
    const order: string[] = [];
    vi.spyOn(withMark(storage), "aiMarkOrdered").mockImplementation(() => {
      order.push("mark");
      return mark.promise;
    });
    vi.spyOn(storage, "upsertCustomerFromOrder").mockImplementation(() => {
      order.push("upsert");
      return upsert.promise as Promise<never>;
    });
    vi.spyOn(storage, "recordEvent").mockImplementation(() => {
      order.push("event");
      return event.promise;
    });
    notifyShop.mockImplementation(() => {
      order.push("notify");
      return notify.promise;
    });
    const updateOrder = vi.spyOn(storage, "updateOrder");

    const pending = call();
    await vi.waitFor(() => expect(order).toHaveLength(4));
    // None has been settled yet, and all four are already running.
    expect([...order].sort()).toEqual(["event", "mark", "notify", "upsert"]);
    expect(updateOrder).not.toHaveBeenCalled();

    mark.resolve();
    upsert.resolve();
    event.resolve();
    await flush();
    // The notify is still running, so the notified state is not written yet.
    expect(updateOrder).not.toHaveBeenCalled();

    notify.resolve({ telegram: "sent" });
    const res = await pending;
    expect(res.status).toBe(200);
    const r = (await res.json()) as OrderResponse;
    if (!r.ok) throw new Error("expected ok");
    expect(r.notified.telegram).toBe("sent");
    expect(updateOrder).toHaveBeenCalledTimes(1);
    expect(updateOrder).toHaveBeenCalledWith(ORDER_ID, { notified: { telegram: "sent" } });
  });

  it("a slow customer upsert does not hold the notify back", async () => {
    const storage = getStorage();
    const upsert = deferred();
    vi.spyOn(storage, "upsertCustomerFromOrder").mockImplementation(() => upsert.promise as Promise<never>);
    const pending = call();
    await vi.waitFor(() => expect(notifyShop).toHaveBeenCalledTimes(1));
    upsert.resolve();
    expect((await pending).status).toBe(200);
  });

  it("each failure keeps its own log line and report, and the order still succeeds", async () => {
    const storage = getStorage();
    vi.spyOn(withMark(storage), "aiMarkOrdered").mockRejectedValue(new Error('row {"idea":"secret"}'));
    vi.spyOn(storage, "upsertCustomerFromOrder").mockRejectedValue(new Error("[supabase] POST /rest/v1/customers -> 500 {}"));
    notifyShop.mockResolvedValue({ telegram: "failed", error: "telegram 401" });
    const res = await call();
    expect(res.status).toBe(200);
    const r = (await res.json()) as OrderResponse;
    if (!r.ok) throw new Error("expected ok");
    expect(r.notified.telegram).toBe("failed");
    const lines = logCalls().map((c) => c.join(" "));
    expect(lines).toContain("[orders] customer upsert failed (500)");
    expect(lines).toContain("[orders] notify failed: telegram 401");
    expect(JSON.stringify(lines)).not.toContain("secret");
    const wheres = reportError.mock.calls.map((c) => c[1]?.where).sort();
    expect(wheres).toEqual(["orders.aiMarkOrdered", "orders.customerUpsert", "orders.notify"]);
    const mark = reportError.mock.calls.find((c) => c[1]?.where === "orders.aiMarkOrdered");
    expect((mark![0] as Error).message).toBe("AI generation mark-ordered failed");
  });

  it("a notify that throws is answered as failed and the other writes still ran", async () => {
    const storage = getStorage();
    const upsert = vi.spyOn(storage, "upsertCustomerFromOrder");
    notifyShop.mockRejectedValue(new Error("boom"));
    const res = await call();
    expect(res.status).toBe(200);
    const r = (await res.json()) as OrderResponse;
    if (!r.ok) throw new Error("expected ok");
    expect(r.notified.telegram).toBe("failed");
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(logCalls().some((c) => c[0] === "[orders] notify threw")).toBe(true);
  });
});
