import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderRecord } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import { setupEnv } from "./helpers";

vi.mock("@/lib/order-text", () => ({
  shapeLabel: () => "دائري",
  sizeLabel: (w: number, h: number) => `${w / 10000} × ${h / 10000} سم`,
  orderSummaryText: () => "summary",
}));
vi.mock("@/lib/pricing", () => ({ formatIqd: (n: number) => String(n) }));

import { notifyShop } from "@/lib/notify";
import { buildCaption } from "@/lib/notify/telegram";

const rec = (over: Partial<OrderRecord["customer"]> = {}): OrderRecord => ({
  orderId: "order-id-1",
  displayNo: "EP-251107-ABCD",
  createdAt: "2025-11-07T10:00:00.000Z",
  status: "new",
  spec: { shape: "circle", widthUm: 30000, heightUm: 30000 },
  layout: {
    cols: 6,
    rows: 9,
    countPerSheet: 54,
    rotated: false,
    cellWidthUm: 30000,
    cellHeightUm: 30000,
    gapXUm: 2000,
    gapYUm: 0,
  },
  design: {
    kind: "png",
    originalName: "a.png",
    bytes: 3,
    pxWidth: 10,
    pxHeight: 10,
    effectiveDpi: 300,
  },
  offer: { id: "o", sheets: 20, priceIqd: null },
  price: {
    offerPriceIqd: null,
    deliveryFeeIqd: 5000,
    totalIqd: null,
    totalStickers: 1080,
    perStickerIqd: null,
  },
  customer: {
    name: "علي <b>",
    phone: "9647701234567",
    governorate: "بغداد",
    district: "الكرادة",
    landmark: "قرب الجسر",
    ...over,
  },
  files: { designPath: "uploads/a.bin", pdfPath: "orders/a.pdf" },
  notified: { telegram: "skipped" },
});

afterEach(() => vi.unstubAllGlobals());

describe("telegram caption", () => {
  it("stays valid HTML and under 1024 chars when fields are full of < > &", () => {
    const evil = "<<<>>>&&&".repeat(40);
    const c = buildCaption(
      rec({
        name: evil,
        governorate: evil,
        district: evil,
        landmark: evil,
        notes: evil,
      }),
      DEFAULT_SETTINGS,
    );
    expect(c.length).toBeLessThanOrEqual(1024);
    expect(c).not.toMatch(/&(?!(amp|lt|gt);)/);
    expect(c).toContain("…");
    for (const line of c.split("\n")) {
      expect((line.match(/<b>/g) ?? []).length).toBe(
        (line.match(/<\/b>/g) ?? []).length,
      );
      expect((line.match(/<a /g) ?? []).length).toBe(
        (line.match(/<\/a>/g) ?? []).length,
      );
    }
  });

  it("drops notes entirely when the budgeted fields still overflow", () => {
    const c = buildCaption(
      rec({
        name: "<".repeat(60),
        district: "<".repeat(80),
        landmark: "<".repeat(120),
        governorate: "<".repeat(30),
        notes: "NOTESMARK",
      }),
      DEFAULT_SETTINGS,
    );
    expect(c.length).toBeLessThanOrEqual(1024);
    expect(c).not.toContain("NOTESMARK");
  });

  it("has links, escapes HTML, and stays within 1024 chars", () => {
    const c = buildCaption(rec({ notes: "ن".repeat(3000) }), DEFAULT_SETTINGS);
    expect(c).toContain('href="tel:+9647701234567"');
    expect(c).toContain('href="https://wa.me/9647701234567"');
    expect(c).toContain("علي &lt;b&gt;");
    expect(c).toContain("يُحدد عند التأكيد");
    expect(c.length).toBeLessThanOrEqual(1024);
  });
});

describe("notifyShop", () => {
  it("console transport skips", async () => {
    setupEnv();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(
      await notifyShop(rec(), new Uint8Array([1]), "x.pdf", DEFAULT_SETTINGS),
    ).toEqual({ telegram: "skipped" });
    log.mockRestore();
  });

  it("sends a multipart sendDocument request", async () => {
    setupEnv({
      ORDER_TRANSPORT: "telegram",
      TELEGRAM_BOT_TOKEN: "123:ABC",
      TELEGRAM_CHAT_ID: "555",
    });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await notifyShop(
      rec(),
      new Uint8Array([1, 2]),
      "EP-1.pdf",
      DEFAULT_SETTINGS,
    );
    expect(r).toEqual({ telegram: "sent" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.telegram.org/bot123:ABC/sendDocument");
    const form = init.body as FormData;
    expect(form.get("chat_id")).toBe("555");
    expect(form.get("parse_mode")).toBe("HTML");
    expect(String(form.get("caption")).length).toBeLessThanOrEqual(1024);
    const doc = form.get("document") as File;
    expect(doc.name).toBe("EP-1.pdf");
    expect(doc.type).toBe("application/pdf");
  });

  it("falls back to settings chat id, skips when none, never throws", async () => {
    setupEnv({ ORDER_TRANSPORT: "telegram", TELEGRAM_BOT_TOKEN: "123:ABC" });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, description: "bad" }), {
          status: 400,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await notifyShop(rec(), new Uint8Array(), "x.pdf", DEFAULT_SETTINGS),
    ).toEqual({ telegram: "skipped" });
    const r = await notifyShop(rec(), new Uint8Array(), "x.pdf", {
      ...DEFAULT_SETTINGS,
      telegramChatId: "777",
    });
    expect(r.telegram).toBe("failed");
    expect(r.error).toContain("400");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network 123:ABC down");
      }),
    );
    const r2 = await notifyShop(rec(), new Uint8Array(), "x.pdf", {
      ...DEFAULT_SETTINGS,
      telegramChatId: "777",
    });
    expect(r2.telegram).toBe("failed");
    expect(r2.error).not.toContain("123:ABC");
  });
});
