import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import type { OrderRecord } from "@/lib/types";
import { notifyShop } from "@/lib/notify";
import { setupEnv } from "./helpers";

const PHONE = "9647701234567";
const rec = {
  orderId: "order-id-1",
  displayNo: "EP-251107-ABCD",
  createdAt: "2025-11-07T10:00:00.000Z",
  status: "new",
  spec: { shape: "circle", widthUm: 30000, heightUm: 30000 },
  layout: { cols: 6, rows: 9, countPerSheet: 54, rotated: false, cellWidthUm: 30000, cellHeightUm: 30000, gapXUm: 2000, gapYUm: 0 },
  design: { kind: "png", originalName: "a.png", bytes: 3, pxWidth: 10, pxHeight: 10, effectiveDpi: 300 },
  price: {
    material: "paper", sheets: 20, unitBaseIqd: null, discountPercent: 0, unitPriceIqd: null,
    subtotalIqd: null, deliveryFeeIqd: 5000, totalIqd: null, totalStickers: 1080, perStickerIqd: null,
  },
  customer: { phone: PHONE, governorate: "بغداد", district: "الكرادة", landmark: "قرب الجسر" },
  files: { designPath: "uploads/a.bin", pdfPath: "orders/a.pdf" },
  notified: { telegram: "skipped" },
} as unknown as OrderRecord;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("console transport log", () => {
  it("on Vercel logs the file, size and displayNo only: no caption, phone or address", async () => {
    setupEnv();
    vi.stubEnv("VERCEL", "1");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await notifyShop(rec, new Uint8Array(7), "EP-251107-ABCD_x.pdf", DEFAULT_SETTINGS);
    expect(result).toEqual({ telegram: "skipped" });
    expect(log.mock.calls).toEqual([["[order] EP-251107-ABCD_x.pdf (7 bytes) EP-251107-ABCD"]]);
  });

  it("elsewhere the full caption is still logged (local development)", async () => {
    setupEnv();
    vi.stubEnv("VERCEL", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await notifyShop(rec, new Uint8Array(7), "x.pdf", DEFAULT_SETTINGS);
    const line = String(log.mock.calls[0][0]);
    expect(line.startsWith("[order] x.pdf (7 bytes)\n")).toBe(true);
    expect(line).toContain(PHONE);
  });
});
