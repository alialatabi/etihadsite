/**
 * Retention purge under owner decision D10 (spec §5.6): orders from KEEP_DESIGNS_FROM on keep
 * their record and design forever and lose only the print PDF after retentionDays; older orders
 * keep the old rule. Every scan is bounded to [cutoff − PURGE_WINDOW_DAYS, cutoff).
 * Dates derive from KEEP_DESIGNS_FROM so the tests survive the owner moving it at deploy.
 */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEEP_DESIGNS_FROM, PURGE_WINDOW_DAYS } from "@/config/defaults";
import { LocalStorage } from "@/lib/storage/local";
import { SupabaseStorage } from "@/lib/storage/supabase";
import type { AiGenerationRecord, OrderRecord, StorageAdapter } from "@/lib/types";

const DAY = 86_400_000;
const KEEP = new Date(KEEP_DESIGNS_FROM).getTime();
const at = (ms: number) => new Date(ms).toISOString();
/** New rule: cutoff well after the switch, the whole window is new-rule time. */
const NEW_CUTOFF = new Date(KEEP + (PURGE_WINDOW_DAYS + 10) * DAY);
/** Old rule: cutoff before the switch, the whole window is old-rule time. */
const OLD_CUTOFF = new Date(KEEP - 2 * DAY);
const inWindow = (cutoff: Date, daysBefore: number) => at(cutoff.getTime() - daysBefore * DAY);

let storageMock: StorageAdapter | null = null;
vi.mock("@/lib/storage", () => ({ getStorage: () => storageMock }));
vi.mock("@/lib/auth/session", () => ({ adminApiGuard: async () => null }));

function record(orderId: string, createdAt: string, uploadId = orderId): OrderRecord {
  return {
    orderId,
    displayNo: "EP-261201-ABCD",
    createdAt,
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
    files: { designPath: `uploads/${uploadId}.bin`, pdfPath: `orders/${orderId}.pdf` },
    notified: { telegram: "skipped" },
  };
}

function generation(id: string, uploadId: string, createdAt: string): AiGenerationRecord {
  return {
    id,
    createdAt,
    day: createdAt.slice(0, 10),
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
  };
}

/* ───────────────────────── local adapter ───────────────────────── */

describe("LocalStorage purge (keep forever)", () => {
  const meta = { mime: "image/png", originalName: "a.png", bytes: 1, createdAt: "2026-01-01T00:00:00.000Z" };
  let dir: string;
  let s: LocalStorage;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ep-purge-"));
    s = new LocalStorage(dir);
  });
  const touch = (rel: string, iso: string) => utimesSync(path.join(dir, rel), new Date(iso), new Date(iso));
  async function order(id: string, createdAt: string, upload = id) {
    await s.saveUpload(upload, new Uint8Array([1]), meta);
    touch(`uploads/${upload}.bin`, createdAt);
    touch(`uploads/${upload}.json`, createdAt);
    await s.savePdf(id, new Uint8Array([2]));
    await s.saveOrder(record(id, createdAt, upload));
  }
  async function upload(id: string, mtime: string) {
    await s.saveUpload(id, new Uint8Array([1]), meta);
    touch(`uploads/${id}.bin`, mtime);
    touch(`uploads/${id}.json`, mtime);
  }

  it("purge keeps orders and designs, deletes old PDFs", async () => {
    await order("order-new-rule-1", inWindow(NEW_CUTOFF, 5));
    await order("order-recent-001", at(NEW_CUTOFF.getTime() + DAY));
    const dry = await s.purgeOlderThan(NEW_CUTOFF, true);
    expect(dry).toEqual(["orders/order-new-rule-1.pdf"]);
    expect(await s.readFile("orders/order-new-rule-1.pdf")).not.toBeNull();
    expect(await s.purgeOlderThan(NEW_CUTOFF, false)).toEqual(["orders/order-new-rule-1.pdf"]);
    expect(await s.readFile("orders/order-new-rule-1.pdf")).toBeNull();
    expect(await s.getOrder("order-new-rule-1")).not.toBeNull();
    expect(await s.readFile("uploads/order-new-rule-1.bin")).not.toBeNull();
    expect(await s.readFile("uploads/order-new-rule-1.json")).not.toBeNull();
    expect(await s.readFile("orders/order-recent-001.pdf")).not.toBeNull();
    // Idempotent: nothing left to report.
    expect(await s.purgeOlderThan(NEW_CUTOFF, false)).toEqual([]);
  });

  it("orders before KEEP_DESIGNS_FROM are purged the old way", async () => {
    await order("order-old-rule-1", inWindow(OLD_CUTOFF, 3));
    const removed = await s.purgeOlderThan(OLD_CUTOFF, false);
    expect(removed.sort()).toEqual(
      ["orders/order-old-rule-1.json", "orders/order-old-rule-1.pdf", "uploads/order-old-rule-1.bin", "uploads/order-old-rule-1.json"].sort(),
    );
    expect(await s.getOrder("order-old-rule-1")).toBeNull();
  });

  it("an old-rule order's design used by a new-rule order is kept", async () => {
    // Cutoff just after the switch: the window holds both rules.
    const cutoff = new Date(KEEP + 2 * DAY);
    await order("order-old-rule-2", at(KEEP - DAY), "shared-upload-01");
    await s.savePdf("order-new-rule-2", new Uint8Array([2]));
    await s.saveOrder(record("order-new-rule-2", at(KEEP + DAY), "shared-upload-01"));
    const removed = await s.purgeOlderThan(cutoff, false);
    expect(removed.sort()).toEqual(["orders/order-new-rule-2.pdf", "orders/order-old-rule-2.json", "orders/order-old-rule-2.pdf"]);
    expect(await s.readFile("uploads/shared-upload-01.bin")).not.toBeNull();
    expect(await s.getOrder("order-new-rule-2")).not.toBeNull();
  });

  it("purge only scans the 30-day window", async () => {
    const beyond = PURGE_WINDOW_DAYS + 2;
    await order("order-old-beyond", inWindow(OLD_CUTOFF, beyond));
    await upload("upload-beyond-01", inWindow(OLD_CUTOFF, beyond));
    await order("order-new-beyond", inWindow(NEW_CUTOFF, beyond));
    expect(await s.purgeOlderThan(OLD_CUTOFF, false)).toEqual([]);
    expect(await s.purgeOlderThan(NEW_CUTOFF, false)).toEqual([]);
    expect(await s.getOrder("order-old-beyond")).not.toBeNull();
    expect(await s.readFile("uploads/upload-beyond-01.bin")).not.toBeNull();
    expect(await s.readFile("orders/order-new-beyond.pdf")).not.toBeNull();
  });

  it("purge keeps an unordered AI upload", async () => {
    await upload("ai-upload-00001", inWindow(NEW_CUTOFF, 4));
    await s.aiRecordGeneration(generation("gen_aaaaaaaa", "ai-upload-00001", inWindow(NEW_CUTOFF, 4)));
    expect(await s.purgeOlderThan(NEW_CUTOFF, false)).toEqual([]);
    expect(await s.readFile("uploads/ai-upload-00001.bin")).not.toBeNull();
  });

  it("purge still deletes an unreferenced old upload", async () => {
    await upload("plain-upload-01", inWindow(NEW_CUTOFF, 4));
    await upload("fresh-upload-01", at(NEW_CUTOFF.getTime() + DAY));
    expect((await s.purgeOlderThan(NEW_CUTOFF, false)).sort()).toEqual(["uploads/plain-upload-01.bin", "uploads/plain-upload-01.json"]);
    expect(await s.readFile("uploads/fresh-upload-01.bin")).not.toBeNull();
  });
});

/* ───────────────────────── Supabase adapter (stateful fake) ───────────────────────── */

const BASE = "https://proj.supabase.co";
const KEY = "test-secret-key-not-real";

interface FakeDb {
  orders: { order_id: string; created_at: string; files: OrderRecord["files"] }[];
  ai: { upload_id: string; created_at: string }[];
  objects: { name: string; created_at: string }[];
  /** Server-side cap on rows per select / objects per listing (PostgREST max-rows), like a misconfigured project. */
  cap?: number;
}
let db: FakeDb;
let calls: { method: string; url: string; body?: unknown }[];

const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });

/** Applies `created_at=<op>.<iso>` filters the way PostgREST does (all ANDed). */
function byCreatedAt<T extends { created_at: string }>(rows: T[], url: URL): T[] {
  const filters = url.searchParams.getAll("created_at").map((f) => {
    const [op, ...rest] = f.split(".");
    return { op, t: new Date(rest.join(".")).getTime() };
  });
  return rows.filter((r) => {
    const t = new Date(r.created_at).getTime();
    return filters.every(({ op, t: v }) => (op === "gte" ? t >= v : op === "lt" ? t < v : op === "gt" ? t > v : op === "lte" ? t <= v : false));
  });
}

function paged<T>(rows: T[], init: RequestInit): T[] {
  const range = (init.headers as Record<string, string>).Range;
  if (!range) return rows;
  const [from, to] = range.split("-").map(Number);
  return rows.slice(from, Math.min(to + 1, from + (db.cap ?? Infinity)));
}

/** `order_id=in.(a,b)` (ids never contain commas or brackets: ID_RE). */
function byOrderIds<T extends { order_id: string }>(rows: T[], url: URL): T[] {
  const f = url.searchParams.get("order_id");
  if (f === null) return rows;
  const m = /^in\.\((.*)\)$/.exec(f);
  if (!m) throw new Error(`unsupported order_id filter ${f}`);
  const ids = new Set(m[1].split(","));
  return rows.filter((r) => ids.has(r.order_id));
}

beforeEach(() => {
  db = { orders: [], ai: [], objects: [] };
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, url: input.replace(BASE, ""), body });
      const p = url.pathname;
      if (p === "/rest/v1/orders" && method === "GET") return ok(paged(byCreatedAt(db.orders, url), init));
      if (p === "/rest/v1/orders" && method === "DELETE") {
        const gone = new Set(byOrderIds(byCreatedAt(db.orders, url), url));
        db.orders = db.orders.filter((o) => !gone.has(o));
        return new Response(null, { status: 204 });
      }
      if (p === "/rest/v1/ai_generations" && method === "GET") return ok(paged(byCreatedAt(db.ai, url), init));
      if (p === "/storage/v1/object/list/etihad") {
        const b = body as { prefix: string; limit: number; offset: number; sortBy: { column: string; order: string } };
        const dir = `${b.prefix}/`;
        const list = db.objects
          .filter((o) => o.name.startsWith(dir))
          .map((o) => ({ name: o.name.slice(dir.length), created_at: o.created_at }))
          .sort((x, y) => (x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : 0) * (b.sortBy.order === "desc" ? -1 : 1));
        return ok(list.slice(b.offset, b.offset + Math.min(b.limit, db.cap ?? Infinity)));
      }
      if (p === "/storage/v1/object/etihad" && method === "DELETE") {
        const prefixes = new Set((body as { prefixes: string[] }).prefixes);
        db.objects = db.objects.filter((o) => !prefixes.has(o.name));
        return ok([]);
      }
      throw new Error(`unexpected fetch ${method} ${input}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sb = () => new SupabaseStorage(BASE, KEY);
/** Adds an order row with its PDF and design (+meta) objects, all created at `createdAt`. */
function sbOrder(id: string, createdAt: string, upload = id, withObjects = true) {
  db.orders.push({ order_id: id, created_at: createdAt.replace("Z", "+00:00"), files: { designPath: `uploads/${upload}.bin`, pdfPath: `orders/${id}.pdf` } });
  if (withObjects) sbObjects(`orders/${id}.pdf`, `uploads/${upload}.bin`, `uploads/${upload}.json`)(createdAt);
}
const sbObjects = (...names: string[]) => (createdAt: string) => {
  for (const name of names) db.objects.push({ name, created_at: createdAt });
};
const objectNames = () => db.objects.map((o) => o.name).sort();
const ORPHAN_FAR = new Date(0); // no orphan .bin rule in these cases unless asked

describe("SupabaseStorage purge (keep forever)", () => {
  it("purge keeps orders and designs, deletes old PDFs", async () => {
    sbOrder("order-new-rule-1", inWindow(NEW_CUTOFF, 5));
    sbOrder("order-recent-001", at(NEW_CUTOFF.getTime() + DAY));
    const before = objectNames();
    expect(await sb().purgeOlderThan(NEW_CUTOFF, true, ORPHAN_FAR)).toEqual(["orders/order-new-rule-1.pdf"]);
    expect(objectNames()).toEqual(before);
    expect(await sb().purgeOlderThan(NEW_CUTOFF, false, ORPHAN_FAR)).toEqual(["orders/order-new-rule-1.pdf"]);
    expect(objectNames()).toEqual(before.filter((n) => n !== "orders/order-new-rule-1.pdf"));
    expect(db.orders.map((o) => o.order_id).sort()).toEqual(["order-new-rule-1", "order-recent-001"]);
    // The order rows are never deleted under the new rule.
    expect(calls.some((c) => c.method === "DELETE" && c.url.startsWith("/rest/v1/orders"))).toBe(false);
    // Second run: the PDF is gone, nothing is reported again.
    expect(await sb().purgeOlderThan(NEW_CUTOFF, false, ORPHAN_FAR)).toEqual([]);
  });

  it("orders before KEEP_DESIGNS_FROM are purged the old way", async () => {
    sbOrder("order-old-rule-1", inWindow(OLD_CUTOFF, 3));
    sbOrder("order-old-recent", at(OLD_CUTOFF.getTime() + DAY));
    const removed = await sb().purgeOlderThan(OLD_CUTOFF, false, ORPHAN_FAR);
    expect(removed).toEqual(["order:order-old-rule-1", "orders/order-old-rule-1.pdf", "uploads/order-old-rule-1.bin", "uploads/order-old-rule-1.json"]);
    expect(db.orders.map((o) => o.order_id)).toEqual(["order-old-recent"]);
    expect(objectNames()).toEqual(["orders/order-old-recent.pdf", "uploads/order-old-recent.bin", "uploads/order-old-recent.json"]);
  });

  it("the old-rule row delete never reaches new-rule rows older than the cutoff", async () => {
    const cutoff = new Date(KEEP + 2 * DAY);
    sbOrder("order-old-rule-2", at(KEEP - DAY), "shared-upload-01");
    sbOrder("order-new-rule-2", at(KEEP + DAY), "shared-upload-01", false);
    sbObjects("orders/order-new-rule-2.pdf")(at(KEEP + DAY));
    const removed = await sb().purgeOlderThan(cutoff, false, ORPHAN_FAR);
    expect(removed.sort()).toEqual(["order:order-old-rule-2", "orders/order-new-rule-2.pdf", "orders/order-old-rule-2.pdf"]);
    expect(db.orders.map((o) => o.order_id)).toEqual(["order-new-rule-2"]);
    expect(objectNames()).toEqual(["uploads/shared-upload-01.bin", "uploads/shared-upload-01.json"]);
    const del = calls.find((c) => c.method === "DELETE" && c.url.startsWith("/rest/v1/orders"))!;
    expect(del.url).toBe(`/rest/v1/orders?order_id=in.(order-old-rule-2)&created_at=lt.${encodeURIComponent(new Date(KEEP_DESIGNS_FROM).toISOString())}`);
  });

  it("purge only scans the 30-day window", async () => {
    const windowStart = NEW_CUTOFF.getTime() - PURGE_WINDOW_DAYS * DAY;
    // 1,000 recent kept uploads fill the first listing page; one more page reaches the window.
    for (let i = 0; i < 1000; i++) sbObjects(`uploads/recent-upload-${String(i).padStart(4, "0")}.bin`, `uploads/recent-upload-${String(i).padStart(4, "0")}.json`)(at(NEW_CUTOFF.getTime() + DAY + i * 1000));
    sbObjects("uploads/window-upload-1.bin", "uploads/window-upload-1.json")(inWindow(NEW_CUTOFF, 3));
    // Far older than the window: three more pages that must never be read.
    for (let i = 0; i < 3000; i++) sbObjects(`uploads/ancient-upload-${String(i).padStart(4, "0")}.bin`)(at(windowStart - 5 * DAY - i * 1000));
    sbOrder("order-new-beyond", at(windowStart - 2 * DAY));
    const removed = await sb().purgeOlderThan(NEW_CUTOFF, true, ORPHAN_FAR);
    expect(removed).toEqual(["uploads/window-upload-1.bin", "uploads/window-upload-1.json"]);
    const lists = calls.filter((c) => c.url === "/storage/v1/object/list/etihad" && (c.body as { prefix: string }).prefix === "uploads");
    expect(lists.length).toBeLessThanOrEqual(3);
    for (const c of lists) expect((c.body as { sortBy: unknown }).sortBy).toEqual({ column: "created_at", order: "desc" });
    for (const c of calls.filter((x) => x.url.startsWith("/rest/v1/"))) expect(c.url).toMatch(/created_at=gte\./);
  });

  it("purge keeps an unordered AI upload", async () => {
    sbObjects("uploads/ai-upload-00001.bin", "uploads/ai-upload-00001.json")(inWindow(NEW_CUTOFF, 4));
    db.ai.push({ upload_id: "ai-upload-00001", created_at: inWindow(NEW_CUTOFF, 4).replace("Z", "+00:00") });
    expect(await sb().purgeOlderThan(NEW_CUTOFF, false, ORPHAN_FAR)).toEqual([]);
    expect(objectNames()).toEqual(["uploads/ai-upload-00001.bin", "uploads/ai-upload-00001.json"]);
  });

  it("purge still deletes an unreferenced old upload and orphan .bin older than 3 h", async () => {
    const now = NEW_CUTOFF.getTime() + 30 * DAY;
    sbObjects("uploads/plain-upload-01.bin", "uploads/plain-upload-01.json")(inWindow(NEW_CUTOFF, 4));
    sbObjects("uploads/fresh-upload-01.bin", "uploads/fresh-upload-01.json")(at(now - 5 * 3600_000));
    sbObjects("uploads/orphan-stale-01.bin")(at(now - 4 * 3600_000));
    sbObjects("uploads/orphan-fresh-01.bin")(at(now - 3600_000));
    const removed = await sb().purgeOlderThan(NEW_CUTOFF, false, new Date(now - 3 * 3600_000));
    expect(removed.sort()).toEqual(["uploads/orphan-stale-01.bin", "uploads/plain-upload-01.bin", "uploads/plain-upload-01.json"]);
    expect(objectNames()).toEqual(["uploads/fresh-upload-01.bin", "uploads/fresh-upload-01.json", "uploads/orphan-fresh-01.bin"]);
  });
});

describe("SupabaseStorage purge: orphan metas", () => {
  it("removes a .json without its .bin in the window, keeps one whose .bin path is in use", async () => {
    sbObjects("uploads/meta-only-0001.json")(inWindow(NEW_CUTOFF, 4));
    sbObjects("uploads/meta-only-used1.json")(inWindow(NEW_CUTOFF, 4));
    sbObjects("orders/order-uses-meta-1.pdf")(at(NEW_CUTOFF.getTime() + DAY));
    db.orders.push({ order_id: "order-uses-meta-1", created_at: at(NEW_CUTOFF.getTime() + DAY), files: { designPath: "uploads/meta-only-used1.bin", pdfPath: "orders/order-uses-meta-1.pdf" } });
    expect(await sb().purgeOlderThan(NEW_CUTOFF, false, ORPHAN_FAR)).toEqual(["uploads/meta-only-0001.json"]);
    expect(objectNames()).toEqual(["orders/order-uses-meta-1.pdf", "uploads/meta-only-used1.json"]);
  });
});

/* ───────────────────────── fix round 1: boundaries, short pages, bad reference files ───────────────────────── */

describe("purge boundaries", () => {
  // Cutoff 10 days after the switch: windowStart = KEEP − 20 d.
  const cutoff = new Date(KEEP + 10 * DAY);
  const windowStart = cutoff.getTime() - PURGE_WINDOW_DAYS * DAY;

  it("supabase: exactly at windowStart is in, exactly at cutoff is out, exactly at KEEP_DESIGNS_FROM is new rule", async () => {
    sbOrder("order-at-window-start", at(windowStart)); // old rule (before KEEP), in the window: removed whole
    sbOrder("order-at-the-cutoffx", at(cutoff.getTime())); // not older than the cutoff: untouched
    sbOrder("order-at-keep-from-1", at(KEEP)); // new rule: only the PDF
    sbObjects("uploads/upload-at-wstart.bin", "uploads/upload-at-wstart.json")(at(windowStart)); // unused, in: removed
    sbObjects("uploads/upload-at-cutoff.bin", "uploads/upload-at-cutoff.json")(at(cutoff.getTime())); // unused, out: kept
    sbObjects("uploads/upload-before-ws.bin", "uploads/upload-before-ws.json")(at(windowStart - 1)); // 1 ms before the window: kept
    const removed = await sb().purgeOlderThan(cutoff, false, ORPHAN_FAR);
    expect(removed.sort()).toEqual(
      [
        "order:order-at-window-start",
        "orders/order-at-keep-from-1.pdf",
        "orders/order-at-window-start.pdf",
        "uploads/order-at-window-start.bin",
        "uploads/order-at-window-start.json",
        "uploads/upload-at-wstart.bin",
        "uploads/upload-at-wstart.json",
      ].sort(),
    );
    expect(db.orders.map((o) => o.order_id).sort()).toEqual(["order-at-keep-from-1", "order-at-the-cutoffx"]);
  });

  it("local: the same three boundaries", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ep-purge-edge-"));
    const s = new LocalStorage(dir);
    const meta = { mime: "image/png", originalName: "a.png", bytes: 1, createdAt: "2026-01-01T00:00:00.000Z" };
    const put = async (id: string, ms: number, withOrder: boolean) => {
      await s.saveUpload(id, new Uint8Array([1]), meta);
      for (const ext of ["bin", "json"]) utimesSync(path.join(dir, "uploads", `${id}.${ext}`), new Date(ms), new Date(ms));
      if (!withOrder) return;
      await s.savePdf(id, new Uint8Array([2]));
      await s.saveOrder(record(id, at(ms)));
    };
    await put("order-at-window-start", windowStart, true);
    await put("order-at-the-cutoffx", cutoff.getTime(), true);
    await put("order-at-keep-from-1", KEEP, true);
    await put("upload-at-wstart", windowStart, false);
    await put("upload-at-cutoff", cutoff.getTime(), false);
    const removed = await s.purgeOlderThan(cutoff, false);
    expect(removed.sort()).toEqual(
      [
        "orders/order-at-keep-from-1.pdf",
        "orders/order-at-window-start.json",
        "orders/order-at-window-start.pdf",
        "uploads/order-at-window-start.bin",
        "uploads/order-at-window-start.json",
        "uploads/upload-at-wstart.bin",
        "uploads/upload-at-wstart.json",
      ].sort(),
    );
    expect((await s.listOrders()).map((o) => o.orderId).sort()).toEqual(["order-at-keep-from-1", "order-at-the-cutoffx"]);
  });
});

describe("reference reads do not fail open", () => {
  it("supabase: a server that caps pages below 1,000 rows still yields every reference", async () => {
    db.cap = 2; // max-rows = 2: every page is "short"
    // Five kept orders newer than the cutoff all use designs in the window; the last one is on page 3.
    for (let i = 1; i <= 5; i++) {
      sbObjects(`uploads/kept-design-000${i}.bin`, `uploads/kept-design-000${i}.json`)(inWindow(NEW_CUTOFF, 3));
      sbOrder(`order-kept-0000${i}`, at(NEW_CUTOFF.getTime() + i * DAY), `kept-design-000${i}`, false);
    }
    for (let i = 1; i <= 3; i++) db.ai.push({ upload_id: `ai-upload-0000${i}`, created_at: inWindow(NEW_CUTOFF, 2) });
    for (let i = 1; i <= 3; i++) sbObjects(`uploads/ai-upload-0000${i}.bin`, `uploads/ai-upload-0000${i}.json`)(inWindow(NEW_CUTOFF, 2));
    sbObjects("uploads/nobody-uses-01.bin", "uploads/nobody-uses-01.json")(inWindow(NEW_CUTOFF, 1));
    const removed = await sb().purgeOlderThan(NEW_CUTOFF, false, ORPHAN_FAR);
    expect(removed.sort()).toEqual(["uploads/nobody-uses-01.bin", "uploads/nobody-uses-01.json"]);
    // Pages continue after the rows actually received (Range 2-1001, 4-1003, …) until an empty one.
    const orderReads = calls.filter((c) => c.url.startsWith("/rest/v1/orders?select="));
    expect(orderReads.length).toBe(4); // 2 + 2 + 1 rows, then empty
  });

  it("supabase: a non-list answer to a reference read throws before any delete", async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => ok({ message: "not a list" }));
    await expect(sb().purgeOlderThan(NEW_CUTOFF, false, ORPHAN_FAR)).rejects.toThrow(/unexpected answer/);
    expect(calls.every((c) => c.method !== "DELETE")).toBe(true);
  });

  it("supabase: old-rule rows are deleted by id in chunks of 200", async () => {
    for (let i = 0; i < 450; i++) db.orders.push({ order_id: `order-old-${String(i).padStart(4, "0")}`, created_at: inWindow(OLD_CUTOFF, 3), files: { designPath: `uploads/x${String(i).padStart(8, "0")}.bin`, pdfPath: `orders/order-old-${String(i).padStart(4, "0")}.pdf` } });
    await sb().purgeOlderThan(OLD_CUTOFF, false, ORPHAN_FAR);
    const dels = calls.filter((c) => c.method === "DELETE" && c.url.startsWith("/rest/v1/orders"));
    expect(dels.map((d) => (/in\.\(([^)]*)\)/.exec(d.url)?.[1] ?? "").split(",").length)).toEqual([200, 200, 50]);
    for (const d of dels) expect(d.url).toContain(`&created_at=lt.${encodeURIComponent(OLD_CUTOFF.toISOString())}`);
    expect(db.orders).toEqual([]);
  });

  it("local: an AI list that is valid JSON but not a list stops the purge", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ep-purge-ai-"));
    const s = new LocalStorage(dir);
    await s.saveUpload("ai-upload-00001", new Uint8Array([1]), { mime: "image/png", originalName: "a.png", bytes: 1, createdAt: "2026-01-01T00:00:00.000Z" });
    const mtime = new Date(inWindow(NEW_CUTOFF, 4));
    for (const ext of ["bin", "json"]) utimesSync(path.join(dir, "uploads", `ai-upload-00001.${ext}`), mtime, mtime);
    mkdirSync(path.join(dir, "ai"), { recursive: true });
    writeFileSync(path.join(dir, "ai", "generations.json"), JSON.stringify({ uploadId: "ai-upload-00001" }));
    await expect(s.purgeOlderThan(NEW_CUTOFF, false)).rejects.toThrow(/unreadable/);
    expect(await s.readFile("uploads/ai-upload-00001.bin")).not.toBeNull();
  });
});

/* ───────────────────────── admin PDF route ───────────────────────── */

describe("GET /api/admin/files/<orderId>/pdf after the purge", () => {
  it("admin pdf route answers 410 when the PDF was purged", async () => {
    const { GET } = await import("@/app/api/admin/files/[orderId]/[which]/route");
    const { admin } = await import("@/content/ar");
    const call = (which: string) =>
      GET(new Request(`http://localhost/api/admin/files/order-purged-01/${which}`), { params: Promise.resolve({ orderId: "order-purged-01", which }) });
    const dir = mkdtempSync(path.join(tmpdir(), "ep-purge-route-"));
    const local = new LocalStorage(dir);
    await local.saveUpload("order-purged-01", new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { mime: "image/png", originalName: "a.png", bytes: 4, createdAt: at(KEEP) });
    await local.saveOrder(record("order-purged-01", at(KEEP + DAY)));
    storageMock = local;
    const res = await call("pdf");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "purged", message: admin.orders.pdfPurged });
    expect(admin.orders.pdfPurged).toBe("ملف الطباعة انحذف بعد مدة الاحتفاظ. التصميم محفوظ.");
    // The design download still works.
    expect((await call("design")).status).toBe(200);
    // Cloud storage: no signed link for the missing PDF → the same 410; a missing design stays 404.
    storageMock = Object.assign(Object.create(local) as LocalStorage, { signedDownloadUrl: async () => null });
    const cloud = await call("pdf");
    expect(cloud.status).toBe(410);
    expect(await cloud.json()).toEqual({ error: "purged", message: admin.orders.pdfPurged });
    expect((await call("design")).status).toBe(404);
    storageMock = null;
  });
});

describe("order page: isPdfPurged", () => {
  it("is true only once the order is older than retentionDays", async () => {
    const { isPdfPurged } = await import("@/app/admin/_lib");
    const now = new Date("2026-12-31T12:00:00.000Z");
    expect(isPdfPurged("2026-12-01T12:00:00.000Z", 30, now)).toBe(false); // exactly 30 days
    expect(isPdfPurged("2026-12-01T11:59:59.999Z", 30, now)).toBe(true);
    expect(isPdfPurged("2026-12-30T00:00:00.000+00:00", 1, now)).toBe(true);
    expect(isPdfPurged("2026-12-31T00:00:00.000Z", 1, now)).toBe(false);
  });
});
