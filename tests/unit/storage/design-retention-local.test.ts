/**
 * LocalStorage: the 7-day rule for designs no order used (owner 2026-11-26), the gallery filters, and the
 * lookups the admin gallery needs (aiGetGeneration, aiDeleteGeneration, orderUsingUpload).
 */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PURGE_WINDOW_DAYS, UNORDERED_DESIGN_DAYS } from "@/config/defaults";
import { LocalStorage } from "@/lib/storage/local";
import type { AiGenerationRecord, OrderRecord } from "@/lib/types";

const DAY = 86_400_000;
const meta = { mime: "image/png", originalName: "a.png", bytes: 1, createdAt: "2026-01-01T00:00:00.000Z" };
const ago = (days: number) => new Date(Date.now() - days * DAY);
const cutoff = () => ago(UNORDERED_DESIGN_DAYS);

function gen(id: string, uploadId: string, createdAt: Date, extra: Partial<AiGenerationRecord> = {}): AiGenerationRecord {
  return {
    id,
    createdAt: createdAt.toISOString(),
    day: createdAt.toISOString().slice(0, 10),
    ip: "185.23.4.5",
    ipKey: "k1",
    shape: "circle",
    corners: "rounded",
    widthUm: 50_000,
    heightUm: 50_000,
    idea: "قطة",
    lines: ["مطبعة"],
    hasRefs: false,
    model: "gpt-image",
    uploadId,
    orderId: null,
    ...extra,
  };
}

function order(orderId: string, createdAt: Date, files: Partial<OrderRecord["files"]> & { designPath: string }): OrderRecord {
  return {
    orderId,
    displayNo: "EP-261201-ABCD",
    createdAt: createdAt.toISOString(),
    status: "new",
    spec: { shape: "circle", widthUm: 30000, heightUm: 30000 },
    layout: { cols: 6, rows: 9, countPerSheet: 54, rotated: false, cellWidthUm: 30000, cellHeightUm: 30000, gapXUm: 2000, gapYUm: 0 },
    design: { kind: "png", originalName: "a.png", bytes: 3, pxWidth: 10, pxHeight: 10, effectiveDpi: 300 },
    price: {
      material: "paper",
      sheets: 20,
      unitBaseIqd: null,
      discountPercent: 0,
      unitPriceIqd: null,
      subtotalIqd: null,
      deliveryFeeIqd: 5000,
      totalIqd: null,
      totalStickers: 1080,
      perStickerIqd: null,
    },
    customer: { phone: "9647701234567", governorate: "بغداد", district: "x", landmark: "y" },
    files: { pdfPath: `orders/${orderId}.pdf`, ...files },
    notified: { telegram: "skipped" },
  };
}

let dir: string;
let s: LocalStorage;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ep-design-ret-"));
  s = new LocalStorage(dir);
});

const touch = (rel: string, when: Date) => utimesSync(path.join(dir, rel), when, when);
/** Stores the generation row AND its upload files (dated `when`). */
async function addGen(g: AiGenerationRecord, when = new Date(g.createdAt)) {
  await s.saveUpload(g.uploadId, new Uint8Array([1, 2]), meta);
  touch(`uploads/${g.uploadId}.bin`, when);
  touch(`uploads/${g.uploadId}.json`, when);
  await s.aiRecordGeneration(g);
}
async function addUpload(uploadId: string, when: Date) {
  await s.saveUpload(uploadId, new Uint8Array([1]), meta);
  touch(`uploads/${uploadId}.bin`, when);
  touch(`uploads/${uploadId}.json`, when);
}
const rows = async () => (await s.aiListGenerations({ limit: 100, offset: 0 })).rows.map((r) => r.id).sort();
const has = async (rel: string) => (await s.readFile(rel)) !== null;

describe("cutoff guard (irreversible deletes)", () => {
  it("refuses an invalid date and anything newer than 7 days, for both purges", async () => {
    await addGen(gen("gen-fresh-0001", "up-fresh-0001", ago(1)));
    for (const bad of [new Date("nope"), ago(0), ago(1), ago(UNORDERED_DESIGN_DAYS - 1), new Date(Date.now() + DAY)]) {
      await expect(s.aiPurgeUnordered(bad, false)).rejects.toThrow();
      await expect(s.purgeUnusedUploads(bad, false)).rejects.toThrow();
    }
    expect(await rows()).toEqual(["gen-fresh-0001"]);
    expect(await has("uploads/up-fresh-0001.bin")).toBe(true);
  });

  it("accepts exactly now − 7 days (with the caller's few ms of drift)", async () => {
    await expect(s.aiPurgeUnordered(cutoff(), true)).resolves.toEqual([]);
    await expect(s.purgeUnusedUploads(cutoff(), true)).resolves.toEqual([]);
  });
});

describe("aiPurgeUnordered", () => {
  it("removes old unordered designs (files then row), keeps ordered and fresh ones", async () => {
    await addGen(gen("gen-old-00001", "up-old-00001", ago(8)));
    await addGen(gen("gen-old-00002", "up-old-00002", ago(40), { staffId: "staff-0001-aaaa" }));
    await addGen(gen("gen-ordered-01", "up-ordered-01", ago(20), { orderId: "order-0001-aaaa" }));
    await addGen(gen("gen-fresh-001", "up-fresh-001", ago(2)));
    const removed = await s.aiPurgeUnordered(cutoff(), false);
    expect(removed.sort()).toEqual(
      [
        "ai_generation:gen-old-00001",
        "ai_generation:gen-old-00002",
        "uploads/up-old-00001.bin",
        "uploads/up-old-00001.json",
        "uploads/up-old-00002.bin",
        "uploads/up-old-00002.json",
      ].sort(),
    );
    expect(await rows()).toEqual(["gen-fresh-001", "gen-ordered-01"]);
    expect(await has("uploads/up-old-00001.bin")).toBe(false);
    expect(await has("uploads/up-old-00002.json")).toBe(false);
    expect(await has("uploads/up-ordered-01.bin")).toBe(true);
    expect(await has("uploads/up-fresh-001.bin")).toBe(true);
    // Idempotent.
    expect(await s.aiPurgeUnordered(cutoff(), false)).toEqual([]);
  });

  it("dry run reports the same list and changes nothing (no healing either)", async () => {
    await addGen(gen("gen-old-00001", "up-old-00001", ago(9)));
    await addGen(gen("gen-used-0001", "up-used-0001", ago(9)));
    await s.saveOrder(order("order-0001-aaaa", ago(8), { designPath: "uploads/up-used-0001.bin" }));
    const dry = await s.aiPurgeUnordered(cutoff(), true);
    expect(dry.sort()).toEqual(["ai_generation:gen-old-00001", "uploads/up-old-00001.bin", "uploads/up-old-00001.json"]);
    expect(await rows()).toEqual(["gen-old-00001", "gen-used-0001"]);
    expect((await s.aiGetGeneration("up-used-0001"))?.orderId).toBeNull();
    expect(await has("uploads/up-old-00001.bin")).toBe(true);
  });

  it("heals a generation an order uses (designPath or one of designPaths) instead of deleting it", async () => {
    await addGen(gen("gen-single-01", "up-single-01", ago(10)));
    await addGen(gen("gen-multi-001", "up-multi-001", ago(10)));
    await addGen(gen("gen-gone-0001", "up-gone-0001", ago(10)));
    await s.saveOrder(order("order-single-1", ago(9), { designPath: "uploads/up-single-01.bin" }));
    // designPath names another upload; the used one is only in designPaths.
    await s.saveOrder(
      order("order-multi-01", ago(9), { designPath: "uploads/other-first-1.bin", designPaths: ["uploads/other-first-1.bin", "uploads/up-multi-001.bin"] }),
    );
    const removed = await s.aiPurgeUnordered(cutoff(), false);
    expect(removed.sort()).toEqual(["ai_generation:gen-gone-0001", "uploads/up-gone-0001.bin", "uploads/up-gone-0001.json"]);
    expect((await s.aiGetGeneration("up-single-01"))?.orderId).toBe("order-single-1");
    expect((await s.aiGetGeneration("up-multi-001"))?.orderId).toBe("order-multi-01");
    expect(await has("uploads/up-single-01.bin")).toBe(true);
    expect(await has("uploads/up-multi-001.bin")).toBe(true);
  });

  it("fails closed: an unreadable order file aborts and nothing is deleted", async () => {
    await addGen(gen("gen-old-00001", "up-old-00001", ago(10)));
    mkdirSync(path.join(dir, "orders"), { recursive: true });
    writeFileSync(path.join(dir, "orders", "order-broken-1.json"), "{ not json");
    await expect(s.aiPurgeUnordered(cutoff(), false)).rejects.toThrow(/unreadable/);
    expect(await rows()).toEqual(["gen-old-00001"]);
    expect(await has("uploads/up-old-00001.bin")).toBe(true);
    await expect(s.purgeUnusedUploads(cutoff(), false)).rejects.toThrow(/unreadable/);
  });

  it("rows first: a file that cannot be deleted leaves the row gone (swept later as a plain upload) and the call throws", async () => {
    await addGen(gen("gen-bad-00001", "up-bad-00001", ago(10)));
    await addGen(gen("gen-good-0001", "up-good-0001", ago(10)));
    const real = s.deleteFile.bind(s);
    const rowsAtFileDelete: string[][] = [];
    vi.spyOn(s, "deleteFile").mockImplementation(async (rel: string) => {
      rowsAtFileDelete.push(await rows());
      if (rel.includes("up-bad-00001")) throw new Error("EPERM");
      return real(rel);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(s.aiPurgeUnordered(cutoff(), false)).rejects.toThrow(/1 design/);
    // The rows were already written without the removed generations when the first file was deleted.
    expect(rowsAtFileDelete.length).toBeGreaterThan(0);
    for (const r of rowsAtFileDelete) expect(r).toEqual([]);
    expect(await rows()).toEqual([]);
    expect(await has("uploads/up-good-0001.bin")).toBe(false);
    // The leftover file is an ordinary unused upload now; the second sweep removes it.
    vi.restoreAllMocks();
    expect(await has("uploads/up-bad-00001.bin")).toBe(true);
    const swept = await s.purgeUnusedUploads(cutoff(), false);
    expect(swept.sort()).toEqual(["uploads/up-bad-00001.bin", "uploads/up-bad-00001.json"]);
  });

  it("a generation an order picks up between the first read and the write is healed and keeps its files", async () => {
    await addGen(gen("gen-race-0001", "up-race-0001", ago(10)));
    await addGen(gen("gen-gone-0001", "up-gone-0001", ago(10)));
    const real = s.saveOrder.bind(s);
    const proto = Object.getPrototypeOf(s) as { orderUsesByPath: () => Promise<Map<string, string>> };
    let reads = 0;
    const orig = proto.orderUsesByPath;
    const spy = vi.spyOn(proto, "orderUsesByPath").mockImplementation(async function (this: LocalStorage) {
      reads++;
      // Between the first and the second read an order starts using up-race-0001.
      if (reads === 2) await real(order("order-race-001", ago(0), { designPath: "uploads/up-race-0001.bin" }));
      return orig.call(this);
    });
    const removed = await s.aiPurgeUnordered(cutoff(), false);
    spy.mockRestore();
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(removed.sort()).toEqual(["ai_generation:gen-gone-0001", "uploads/up-gone-0001.bin", "uploads/up-gone-0001.json"]);
    expect(await rows()).toEqual(["gen-race-0001"]);
    expect((await s.aiGetGeneration("up-race-0001"))?.orderId).toBe("order-race-001");
    expect(await has("uploads/up-race-0001.bin")).toBe(true);
  });

  it("never treats a generation with a bad date or id as a candidate", async () => {
    await addGen(gen("gen-baddate-01", "up-baddate-01", ago(10), { createdAt: "not a date" }), ago(10));
    await addGen(gen("short", "up-shortid-01", ago(10)));
    expect(await s.aiPurgeUnordered(cutoff(), false)).toEqual([]);
    expect(await rows()).toEqual(["gen-baddate-01", "short"]);
  });
});

describe("purgeUnusedUploads", () => {
  it("removes unused uploads in [cutoff − 30 d, cutoff); keeps used ones and ones outside the window", async () => {
    await addUpload("up-unused-001", ago(10));
    await addUpload("up-too-fresh1", ago(3));
    await addUpload("up-too-old-01", ago(UNORDERED_DESIGN_DAYS + PURGE_WINDOW_DAYS + 5));
    await addUpload("up-by-order1", ago(12));
    await addUpload("up-by-multi01", ago(12));
    await addUpload("up-by-gen-001", ago(12));
    await s.saveOrder(order("order-0001-aaaa", ago(11), { designPath: "uploads/up-by-order1.bin" }));
    await s.saveOrder(order("order-0002-aaaa", ago(11), { designPath: "uploads/up-by-order1.bin", designPaths: ["uploads/up-by-multi01.bin"] }));
    await s.aiRecordGeneration(gen("gen-keep-0001", "up-by-gen-001", ago(12)));
    // An orphan meta (its .bin is gone) in the window.
    writeFileSync(path.join(dir, "uploads", "up-orphan-001.json"), "{}");
    touch("uploads/up-orphan-001.json", ago(15));

    const dry = await s.purgeUnusedUploads(cutoff(), true);
    expect(dry.sort()).toEqual(["uploads/up-orphan-001.json", "uploads/up-unused-001.bin", "uploads/up-unused-001.json"]);
    expect(await has("uploads/up-unused-001.bin")).toBe(true);
    const removed = await s.purgeUnusedUploads(cutoff(), false);
    expect(removed.sort()).toEqual(dry.sort());
    for (const keep of ["up-too-fresh1", "up-too-old-01", "up-by-order1", "up-by-multi01", "up-by-gen-001"]) {
      expect(await has(`uploads/${keep}.bin`)).toBe(true);
    }
    expect(await has("uploads/up-unused-001.bin")).toBe(false);
    expect(await s.purgeUnusedUploads(cutoff(), false)).toEqual([]);
  });

  it("re-reads the references right before deleting: an order saved after the listing keeps its upload", async () => {
    await addUpload("up-late-0001", ago(10));
    await addUpload("up-plain-001", ago(10));
    const proto = Object.getPrototypeOf(s) as { orderUsesByPath: () => Promise<Map<string, string>> };
    const orig = proto.orderUsesByPath;
    let reads = 0;
    const spy = vi.spyOn(proto, "orderUsesByPath").mockImplementation(async function (this: LocalStorage) {
      reads++;
      if (reads === 2) await this.saveOrder(order("order-late-001", ago(0), { designPath: "uploads/up-late-0001.bin" }));
      return orig.call(this);
    });
    const removed = await s.purgeUnusedUploads(cutoff(), false);
    spy.mockRestore();
    expect(reads).toBe(2);
    expect(removed.sort()).toEqual(["uploads/up-plain-001.bin", "uploads/up-plain-001.json"]);
    expect(await has("uploads/up-late-0001.bin")).toBe(true);
  });

  it("fails closed: if the re-read throws nothing is deleted", async () => {
    await addUpload("up-plain-001", ago(10));
    const proto = Object.getPrototypeOf(s) as { orderUsesByPath: () => Promise<Map<string, string>> };
    const orig = proto.orderUsesByPath;
    let reads = 0;
    const spy = vi.spyOn(proto, "orderUsesByPath").mockImplementation(async function (this: LocalStorage) {
      if (++reads === 2) throw new Error("orders unreadable");
      return orig.call(this);
    });
    await expect(s.purgeUnusedUploads(cutoff(), false)).rejects.toThrow(/unreadable/);
    spy.mockRestore();
    expect(await has("uploads/up-plain-001.bin")).toBe(true);
  });

  it("a design the first step removed leaves nothing for the second (order of the cron)", async () => {
    await addGen(gen("gen-old-00001", "up-old-00001", ago(10)));
    await s.aiPurgeUnordered(cutoff(), false);
    expect(await s.purgeUnusedUploads(cutoff(), false)).toEqual([]);
  });
});

describe("aiGetGeneration / aiDeleteGeneration / orderUsingUpload", () => {
  it("get by uploadId; an invalid id is null", async () => {
    await addGen(gen("gen-one-00001", "up-one-00001", ago(1)));
    expect((await s.aiGetGeneration("up-one-00001"))?.id).toBe("gen-one-00001");
    expect(await s.aiGetGeneration("up-none-0001")).toBeNull();
    expect(await s.aiGetGeneration("../x")).toBeNull();
  });

  it("delete removes exactly that row, returns it, and leaves the files alone", async () => {
    await addGen(gen("gen-one-00001", "up-one-00001", ago(1)));
    await addGen(gen("gen-two-00001", "up-two-00001", ago(1)));
    const gone = await s.aiDeleteGeneration("gen-one-00001");
    expect(gone?.uploadId).toBe("up-one-00001");
    expect(await rows()).toEqual(["gen-two-00001"]);
    expect(await has("uploads/up-one-00001.bin")).toBe(true);
    expect(await s.aiDeleteGeneration("gen-one-00001")).toBeNull();
    for (const bad of ["", "a", "x/y/../z0000000", "gen two 000001"]) expect(await s.aiDeleteGeneration(bad)).toBeNull();
    expect(await rows()).toEqual(["gen-two-00001"]);
  });

  it("orderUsingUpload finds designPath and designPaths, with no age bound", async () => {
    await s.saveOrder(order("order-ancient-1", new Date("2020-01-01T00:00:00Z"), { designPath: "uploads/up-anc-00001.bin" }));
    await s.saveOrder(order("order-multi-001", ago(1), { designPath: "uploads/up-m1-000001.bin", designPaths: ["uploads/up-m1-000001.bin", "uploads/up-m2-000001.bin"] }));
    expect(await s.orderUsingUpload("up-anc-00001")).toBe("order-ancient-1");
    expect(await s.orderUsingUpload("up-m2-000001")).toBe("order-multi-001");
    expect(await s.orderUsingUpload("up-none-00001")).toBeNull();
    expect(await s.orderUsingUpload("bad id!")).toBeNull();
  });

  it("orderUsingUpload throws on an unreadable order file (fail closed)", async () => {
    mkdirSync(path.join(dir, "orders"), { recursive: true });
    writeFileSync(path.join(dir, "orders", "order-broken-1.json"), "[");
    await expect(s.orderUsingUpload("up-none-00001")).rejects.toThrow();
  });
});

describe("aiListGenerations filters", () => {
  beforeEach(async () => {
    await addGen(gen("gen-a-0000001", "up-a-0000001", new Date("2026-11-01T10:00:00Z"), { idea: "Coffee Shop", orderId: "order-0001-aaaa", shape: "rect" }));
    await addGen(gen("gen-b-0000001", "up-b-0000001", new Date("2026-11-05T10:00:00Z"), { idea: "قطة", instructions: "خلفية زرقاء", staffId: "staff-0001-aaaa" }));
    await addGen(gen("gen-c-0000001", "up-c-0000001", new Date("2026-11-10T10:00:00Z"), { idea: "x", staffId: "staff-0002-bbbb", shape: "custom", orderId: "order-0002-bbbb" }));
  });
  const ids = async (f: Parameters<LocalStorage["aiListGenerations"]>[0]) => (await s.aiListGenerations(f)).rows.map((r) => r.id);
  const base = { limit: 50, offset: 0 };

  it("no filter = every row; newest first; the total follows the filter", async () => {
    expect(await ids(base)).toEqual(["gen-c-0000001", "gen-b-0000001", "gen-a-0000001"]);
    expect((await s.aiListGenerations({ ...base, ordered: true, limit: 1 })).total).toBe(2);
  });
  it("ordered true / false", async () => {
    expect(await ids({ ...base, ordered: true })).toEqual(["gen-c-0000001", "gen-a-0000001"]);
    expect(await ids({ ...base, ordered: false })).toEqual(["gen-b-0000001"]);
  });
  it("maker customer / staff / one account", async () => {
    expect(await ids({ ...base, maker: "customer" })).toEqual(["gen-a-0000001"]);
    expect(await ids({ ...base, maker: "staff" })).toEqual(["gen-c-0000001", "gen-b-0000001"]);
    expect(await ids({ ...base, maker: { staffId: "staff-0002-bbbb" } })).toEqual(["gen-c-0000001"]);
    expect(await ids({ ...base, maker: { staffId: "bad id" } })).toEqual([]);
  });
  it("shape and the date range (since inclusive, until exclusive)", async () => {
    expect(await ids({ ...base, shape: "rect" })).toEqual(["gen-a-0000001"]);
    expect(await ids({ ...base, since: "2026-11-05T10:00:00Z", until: "2026-11-10T10:00:00Z" })).toEqual(["gen-b-0000001"]);
    expect(await ids({ ...base, since: "2026-11-05T10:00:00+00:00" })).toEqual(["gen-c-0000001", "gen-b-0000001"]);
  });
  it("an invalid date or shape gives no rows; an empty date string means no bound", async () => {
    expect(await ids({ ...base, since: "garbage" })).toEqual([]);
    expect(await ids({ ...base, shape: "triangle" as never })).toEqual([]);
    expect(await ids({ ...base, since: "" })).toHaveLength(3);
  });
  it("only strict ISO 8601 with a zone is a date: '1', a zone-less time and year 0 give no rows", async () => {
    for (const since of ["1", "2026-11-20T10:00", "2026-11-20", "0000-01-01T00:00:00Z", "10000-01-01T00:00:00Z", "2026-11-20 10:00:00Z", "Nov 20 2026"]) {
      expect(await ids({ ...base, since })).toEqual([]);
      expect(await ids({ ...base, until: since })).toEqual([]);
    }
    expect(await ids({ ...base, since: "2026-11-05T13:00:00+03:00" })).toEqual(["gen-c-0000001", "gen-b-0000001"]);
    expect(await ids({ ...base, until: "2026-11-30T21:00:00.000Z" })).toHaveLength(3);
  });
  it("search: case-insensitive substring of idea or instructions, or an order id", async () => {
    expect(await ids({ ...base, search: { text: "coffee", orderIds: [] } })).toEqual(["gen-a-0000001"]);
    expect(await ids({ ...base, search: { text: "زرقاء", orderIds: [] } })).toEqual(["gen-b-0000001"]);
    expect(await ids({ ...base, search: { text: "zzz", orderIds: ["order-0002-bbbb"] } })).toEqual(["gen-c-0000001"]);
    expect(await ids({ ...base, search: { text: "coffee", orderIds: ["order-0002-bbbb"] } })).toEqual(["gen-c-0000001", "gen-a-0000001"]);
  });
  it("search with no text and no valid order ids matches nothing; lines are not searched", async () => {
    expect(await ids({ ...base, search: { text: "  ", orderIds: [] } })).toEqual([]);
    expect(await ids({ ...base, search: { text: "", orderIds: ["bad id!"] } })).toEqual([]);
    expect(await ids({ ...base, search: { text: "مطبعة", orderIds: [] } })).toEqual([]);
  });
  it("filters combine with AND", async () => {
    expect(await ids({ ...base, ordered: true, maker: "staff" })).toEqual(["gen-c-0000001"]);
    expect(await ids({ ...base, ipKey: "other" })).toEqual([]);
  });
});
