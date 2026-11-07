import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import { LocalStorage } from "@/lib/storage/local";
import type { OrderRecord } from "@/lib/types";

const tmp = () => mkdtempSync(path.join(tmpdir(), "ep-store-"));

function record(orderId: string, createdAt: string): OrderRecord {
  return {
    orderId,
    displayNo: "EP-251107-ABCD",
    createdAt,
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
    offer: { id: "offer-20", sheets: 20, priceIqd: null },
    price: {
      offerPriceIqd: null,
      deliveryFeeIqd: 5000,
      totalIqd: null,
      totalStickers: 1080,
      perStickerIqd: null,
    },
    customer: {
      phone: "9647701234567",
      governorate: "بغداد",
      district: "x",
      landmark: "y",
    },
    files: {
      designPath: `uploads/${orderId}.bin`,
      pdfPath: `orders/${orderId}.pdf`,
    },
    notified: { telegram: "skipped" },
  };
}

describe("LocalStorage", () => {
  it("round-trips uploads and relative paths", async () => {
    const s = new LocalStorage(tmp());
    const meta = {
      mime: "image/png",
      originalName: "a.png",
      bytes: 3,
      createdAt: new Date().toISOString(),
    };
    const p = await s.saveUpload(
      "upload-id-1",
      new Uint8Array([1, 2, 3]),
      meta,
    );
    expect(p).toBe("uploads/upload-id-1.bin");
    const back = await s.readUpload("upload-id-1");
    expect(Array.from(back!.bytes)).toEqual([1, 2, 3]);
    expect(back!.meta).toEqual(meta);
    expect(await s.readUpload("missing-id-1")).toBeNull();
    expect(await s.readUpload("../etc/passwd")).toBeNull();
    expect(Array.from((await s.readFile(p))!)).toEqual([1, 2, 3]);
    await s.deleteFile(p);
    expect(await s.readFile(p)).toBeNull();
  });

  it("stores orders and lists newest first, updates status", async () => {
    const s = new LocalStorage(tmp());
    expect(await s.listOrders()).toEqual([]);
    await s.saveOrder(record("order-old-1", "2025-11-01T10:00:00.000Z"));
    await s.saveOrder(record("order-new-1", "2025-11-05T10:00:00.000Z"));
    await s.saveOrder(record("order-mid-1", "2025-11-03T10:00:00.000Z"));
    expect((await s.listOrders()).map((o) => o.orderId)).toEqual([
      "order-new-1",
      "order-mid-1",
      "order-old-1",
    ]);
    const updated = await s.updateOrder("order-mid-1", {
      status: "done",
      notified: { telegram: "failed" },
    });
    expect(updated?.status).toBe("done");
    expect((await s.getOrder("order-mid-1"))?.notified.telegram).toBe("failed");
    expect(await s.updateOrder("nope-nope-1", { status: "done" })).toBeNull();
    const pdf = await s.savePdf("order-new-1", new Uint8Array([9]));
    expect(pdf).toBe("orders/order-new-1.pdf");
  });

  it("merges settings with defaults and falls back on an invalid file", async () => {
    const dir = tmp();
    const s = new LocalStorage(dir);
    expect(await s.getSettings()).toEqual(DEFAULT_SETTINGS);

    writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({
        whatsapp: "9647701234567",
        layout: { allowRotate: true },
      }),
    );
    const merged = await s.getSettings();
    expect(merged.whatsapp).toBe("9647701234567");
    expect(merged.layout.allowRotate).toBe(true);
    expect(merged.layout.marginUm).toBe(DEFAULT_SETTINGS.layout.marginUm);
    expect(merged.offers).toEqual(DEFAULT_SETTINGS.offers);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ deliveryFeeIqd: -5 }),
    );
    expect(await s.getSettings()).toEqual(DEFAULT_SETTINGS);
    writeFileSync(path.join(dir, "settings.json"), "{not json");
    expect(await s.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();

    await s.saveSettings({ ...DEFAULT_SETTINGS, area: "البصرة" });
    expect((await s.getSettings()).area).toBe("البصرة");
  });

  it("rejects path traversal in readFile / deleteFile", async () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "uploads"));
    const s = new LocalStorage(path.join(dir, "uploads"));
    for (const bad of [
      "../settings.json",
      "a/../../x",
      "/etc/passwd",
      "C:/Windows/win.ini",
      "a\\b",
      "",
      "a//b",
      "./a",
    ]) {
      await expect(s.readFile(bad)).rejects.toThrow();
      await expect(s.deleteFile(bad)).rejects.toThrow();
    }
  });

  it("purges old orders and orphan uploads", async () => {
    const s = new LocalStorage(tmp());
    await s.saveUpload("order-old-1", new Uint8Array([1]), {
      mime: "image/png",
      originalName: "a",
      bytes: 1,
      createdAt: "2020-01-01T00:00:00Z",
    });
    await s.savePdf("order-old-1", new Uint8Array([1]));
    await s.saveOrder(record("order-old-1", "2020-01-01T00:00:00.000Z"));
    await s.saveOrder(record("order-new-1", new Date().toISOString()));
    const cutoff = new Date(Date.now() - 86_400_000);
    const dry = await s.purgeOlderThan(cutoff, true);
    expect(dry).toContain("orders/order-old-1.json");
    expect(await s.getOrder("order-old-1")).not.toBeNull();
    await s.purgeOlderThan(cutoff, false);
    expect(await s.getOrder("order-old-1")).toBeNull();
    expect(await s.getOrder("order-new-1")).not.toBeNull();
  });

  it("keeps uploads referenced by retained orders and removes old .tmp leftovers", async () => {
    const dir = tmp();
    const s = new LocalStorage(dir);
    const old = new Date("2020-01-01T00:00:00Z");
    const meta = {
      mime: "image/png",
      originalName: "a",
      bytes: 1,
      createdAt: old.toISOString(),
    };
    await s.saveUpload("order-keep-1", new Uint8Array([1]), meta);
    await s.saveOrder(record("order-keep-1", new Date().toISOString()));
    await s.saveUpload("upload-orphan-1", new Uint8Array([1]), meta);
    const fsp = await import("node:fs/promises");
    const pth = await import("node:path");
    for (const f of ["uploads/upload-orphan-1.bin", "uploads/order-keep-1.bin"])
      await fsp.utimes(pth.join(dir, f), old, old);
    const tmpFile = pth.join(dir, "uploads", "x.bin.1.2.tmp");
    await fsp.writeFile(tmpFile, "partial");
    await fsp.utimes(tmpFile, old, old);
    const fresh = pth.join(dir, "uploads", "y.bin.1.3.tmp");
    await fsp.writeFile(fresh, "partial");
    await s.purgeOlderThan(new Date(Date.now() - 86_400_000), false);
    expect(await s.readFile("uploads/order-keep-1.bin")).not.toBeNull();
    expect(await s.readFile("uploads/upload-orphan-1.bin")).toBeNull();
    await expect(fsp.stat(tmpFile)).rejects.toThrow();
    await expect(fsp.stat(fresh)).resolves.toBeTruthy();
  });
});
