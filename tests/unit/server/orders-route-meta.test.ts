import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import { setupEnv } from "./helpers";

// POST /api/orders sends the Conversions API copy of a NEW order's purchase, and only when configured.
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
import { POST } from "@/app/api/orders/route";
import { getStorage } from "@/lib/storage";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PIXEL = "1234567890123456";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const body = {
  orderId: "order-meta-aaaaaaaaaaaaa",
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

let ipSeq = 0;
const call = () =>
  POST(
    new Request("https://softy-print.vercel.app/api/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `5.6.7.${++ipSeq}`,
        "user-agent": "Mozilla/5.0 test",
        cookie: "_fbp=fb.1.1795700000000.1234567890; other=1",
        referer: "https://softy-print.vercel.app/?utm_source=meta",
      },
      body: JSON.stringify(body),
    }),
  );

let fetchMock: ReturnType<typeof vi.fn>;
const graphCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).startsWith("https://graph.facebook.com/"));

beforeEach(async () => {
  setupEnv();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
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
  await storage.saveUpload("upload-aaaaaaaaaaaaaaaa", PNG, {
    mime: "image/png",
    originalName: "logo.png",
    bytes: PNG.length,
    createdAt: new Date().toISOString(),
  });
  await storage.saveSettings({ ...DEFAULT_SETTINGS, whatsapp: "9647709999999", pricesPublished: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/orders → Meta Conversions API", () => {
  it("sends nothing while the pixel id or the token is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", PIXEL);
    vi.stubEnv("META_CAPI_TOKEN", "");
    const res = await call();
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(graphCalls()).toHaveLength(0);
  });

  it("sends one Purchase for a new order, and nothing for its replay", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", PIXEL);
    vi.stubEnv("META_CAPI_TOKEN", "TOKEN-xyz");
    vi.stubEnv("NEXT_PUBLIC_META_IQD_PER_USD", "1310");
    const first = await call();
    const r = await first.json();
    expect(r.ok).toBe(true);
    await vi.waitFor(() => expect(graphCalls()).toHaveLength(1));

    const [url, init] = graphCalls()[0] as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/v24.0/${PIXEL}/events`);
    const sent = JSON.parse(init.body as string);
    expect(sent.access_token).toBe("TOKEN-xyz");
    const ev = sent.data[0];
    expect(ev).toMatchObject({
      event_name: "Purchase",
      event_id: body.orderId,
      action_source: "website",
      event_source_url: "https://softy-print.vercel.app/",
      user_data: {
        ph: [sha("9647701234567")],
        country: [sha("iq")],
        client_ip_address: expect.stringMatching(/^5\.6\.7\.\d+$/),
        client_user_agent: "Mozilla/5.0 test",
        fbp: "fb.1.1795700000000.1234567890",
      },
    });
    expect(ev.custom_data).toEqual({
      value: Math.round((r.summary.totalIqd / 1310) * 100) / 100,
      currency: "USD",
      order_id: body.orderId,
    });
    expect(init.body as string).not.toContain("7701234567");

    // The same orderId again is a replay: answered from storage, no second purchase.
    const again = await call();
    expect(again.status).toBe(200);
    await new Promise((res) => setTimeout(res, 20));
    expect(graphCalls()).toHaveLength(1);
  });

  it("still answers the order when Meta refuses or is unreachable", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", PIXEL);
    vi.stubEnv("META_CAPI_TOKEN", "TOKEN-xyz");
    fetchMock.mockRejectedValue(new Error("offline"));
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    await vi.waitFor(() => expect(graphCalls()).toHaveLength(1));
  });
});
