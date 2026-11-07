import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import { SupabaseStorage } from "@/lib/storage/supabase";
import type { OrderRecord, StoredFileMeta } from "@/lib/types";

const BASE = "https://proj.supabase.co";
const KEY = "test-secret-key-not-real";
const ID = "abcDEF_123-xyz";

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };

let fetchMock: ReturnType<typeof vi.fn>;
let calls: Call[];
let queue: Response[];

function respond(...rs: Response[]) {
  queue.push(...rs);
}
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const bytes = (b: Uint8Array, status = 200) => new Response(b as BodyInit, { status });
const empty = (status = 200) => new Response(status === 204 ? null : "", { status });

beforeEach(() => {
  calls = [];
  queue = [];
  fetchMock = vi.fn(async (url: string, init: Call["init"]) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const store = () => new SupabaseStorage(`${BASE}///`, KEY);

function expectAuth(c: Call) {
  expect(c.init.headers.apikey).toBe(KEY);
  expect(c.init.headers.Authorization).toBe(`Bearer ${KEY}`);
  expect(c.init.cache).toBe("no-store");
}

function record(orderId = ID): OrderRecord {
  return {
    orderId,
    createdAt: "2026-11-07T10:00:00.000Z",
    status: "new",
  } as unknown as OrderRecord;
}

describe("SupabaseStorage objects", () => {
  it("saveUpload POSTs bin then meta with upsert, apikey and Bearer", async () => {
    respond(empty(), empty());
    const meta: StoredFileMeta = { mime: "image/png", originalName: "a.png", bytes: 3, createdAt: "x" };
    const rel = await store().saveUpload(ID, new Uint8Array([1, 2, 3]), meta);
    expect(rel).toBe(`uploads/${ID}.bin`);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(`${BASE}/storage/v1/object/etihad/uploads/${ID}.bin`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["x-upsert"]).toBe("true");
    expect(calls[0].init.headers["content-type"]).toBe("application/octet-stream");
    expectAuth(calls[0]);
    expect(calls[1].url).toBe(`${BASE}/storage/v1/object/etihad/uploads/${ID}.json`);
    expect(calls[1].init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(calls[1].init.body as string)).toEqual(meta);
    expectAuth(calls[1]);
  });

  it("savePdf writes orders/<id>.pdf as application/pdf", async () => {
    respond(empty());
    expect(await store().savePdf(ID, new Uint8Array([0x25]))).toBe(`orders/${ID}.pdf`);
    expect(calls[0].url).toBe(`${BASE}/storage/v1/object/etihad/orders/${ID}.pdf`);
    expect(calls[0].init.headers["content-type"]).toBe("application/pdf");
  });

  it("rejects bad ids before any fetch", async () => {
    const s = store();
    await expect(s.saveUpload("../x", new Uint8Array(), {} as StoredFileMeta)).rejects.toThrow();
    await expect(s.savePdf("short", new Uint8Array())).rejects.toThrow();
    await expect(s.createDirectUpload("a/b/c/d/e/f")).rejects.toThrow();
    await expect(s.saveUploadMeta("..", {} as StoredFileMeta)).rejects.toThrow();
    await expect(s.saveOrder(record("../../evil"))).rejects.toThrow();
    expect(await s.readUpload("../../x")).toBeNull();
    expect(await s.getOrder("bad id")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "uploads/../x.bin",
    "settings.json",
    "../uploads/abcdefgh.bin",
    "uploads/abcdefgh.exe",
    "uploads/abc.bin",
    "other/abcdefgh.bin",
    "/uploads/abcdefgh.bin",
    "uploads/abcdefgh.bin?x=1",
    "uploads\\abcdefgh.bin",
  ])("PATH_RE rejects %s before any fetch", async (rel) => {
    const s = store();
    await expect(s.readFile(rel)).rejects.toThrow("Invalid storage path");
    await expect(s.deleteFile(rel)).rejects.toThrow("Invalid storage path");
    await expect(s.signedDownloadUrl(rel, "a.pdf")).rejects.toThrow("Invalid storage path");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("readFile GETs the authenticated object URL and returns its bytes", async () => {
    respond(bytes(new Uint8Array([7, 8, 9])));
    const out = await store().readFile(`orders/${ID}.pdf`);
    expect(Array.from(out!)).toEqual([7, 8, 9]);
    expect(calls[0].url).toBe(`${BASE}/storage/v1/object/authenticated/etihad/orders/${ID}.pdf`);
    expect(calls[0].init.method ?? "GET").toBe("GET");
    expectAuth(calls[0]);
  });

  it.each([400, 404])("getObject returns null on %i", async (status) => {
    respond(json({ error: "not_found" }, status));
    expect(await store().readFile(`uploads/${ID}.bin`)).toBeNull();
  });

  it("getObject throws on other errors", async () => {
    respond(json({ error: "x" }, 500));
    await expect(store().readFile(`uploads/${ID}.bin`)).rejects.toThrow(/-> 500/);
  });

  it("readUpload needs both meta and bin (meta first: it marks the bytes as checked)", async () => {
    respond(json({ statusCode: "404", error: "not_found" }, 400));
    expect(await store().readUpload(ID)).toBeNull();
    expect(calls).toHaveLength(1); // no bin fetch for an unchecked upload
    expect(calls[0].url).toContain(`uploads/${ID}.json`);

    const meta: StoredFileMeta = { mime: "image/png", originalName: "a.png", bytes: 1, createdAt: "x" };
    respond(json(meta), bytes(new Uint8Array([1])));
    const out = await store().readUpload(ID);
    expect(out?.meta).toEqual(meta);
    expect(Array.from(out!.bytes)).toEqual([1]);
  });

  it("deleteFile sends DELETE with prefixes to the bucket", async () => {
    respond(json([]));
    await store().deleteFile(`uploads/${ID}.bin`);
    expect(calls[0].url).toBe(`${BASE}/storage/v1/object/etihad`);
    expect(calls[0].init.method).toBe("DELETE");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ prefixes: [`uploads/${ID}.bin`] });
    expectAuth(calls[0]);
  });
});

describe("SupabaseStorage direct upload + signed download", () => {
  it("createDirectUpload signs uploads/<id>.bin and builds base + /storage/v1 + url", async () => {
    respond(json({ url: `/object/upload/sign/etihad/uploads/${ID}.bin?token=abc` }));
    const url = await store().createDirectUpload(ID);
    expect(url).toBe(`${BASE}/storage/v1/object/upload/sign/etihad/uploads/${ID}.bin?token=abc`);
    expect(calls[0].url).toBe(`${BASE}/storage/v1/object/upload/sign/etihad/uploads/${ID}.bin`);
    expect(calls[0].init.method).toBe("POST");
    expectAuth(calls[0]);
  });

  it.each([
    [{ url: "https://evil.example/object/upload/sign/x" }],
    [{ url: "/object/sign/etihad/x" }],
    [{}],
    [{ url: "" }],
  ])("createDirectUpload rejects unexpected url shape %j", async (body) => {
    respond(json(body));
    await expect(store().createDirectUpload(ID)).rejects.toThrow(/bad signed upload url/);
  });

  it("createDirectUpload propagates a sign error", async () => {
    respond(json({ error: "x" }, 403));
    await expect(store().createDirectUpload(ID)).rejects.toThrow(/-> 403/);
  });

  it("saveUploadMeta writes only the .json", async () => {
    respond(empty());
    const meta: StoredFileMeta = { mime: "image/png", originalName: "a", bytes: 1, createdAt: "x" };
    await store().saveUploadMeta(ID, meta);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/storage/v1/object/etihad/uploads/${ID}.json`);
  });

  it("signedDownloadUrl requests expiresIn and appends &download=", async () => {
    respond(json({ signedURL: `/object/sign/etihad/orders/${ID}.pdf?token=tok` }));
    const url = await store().signedDownloadUrl(`orders/${ID}.pdf`, "طلب 1.pdf", 30);
    expect(url).toBe(
      `${BASE}/storage/v1/object/sign/etihad/orders/${ID}.pdf?token=tok&download=${encodeURIComponent("طلب 1.pdf")}`,
    );
    expect(calls[0].url).toBe(`${BASE}/storage/v1/object/sign/etihad/orders/${ID}.pdf`);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ expiresIn: 30 });
    expectAuth(calls[0]);
  });

  it("signedDownloadUrl defaults to 60 s and returns null when missing", async () => {
    respond(json({ error: "not_found" }, 404));
    expect(await store().signedDownloadUrl(`orders/${ID}.pdf`, "a.pdf")).toBeNull();
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ expiresIn: 60 });
    respond(json({}));
    expect(await store().signedDownloadUrl(`orders/${ID}.pdf`, "a.pdf")).toBeNull();
  });
});

describe("SupabaseStorage orders", () => {
  it("saveOrder inserts with on_conflict=order_id and ignore-duplicates (first write wins)", async () => {
    respond(empty(201));
    const r = record();
    await store().saveOrder(r);
    expect(calls[0].url).toBe(`${BASE}/rest/v1/orders?on_conflict=order_id`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Prefer).toContain("resolution=ignore-duplicates");
    expectAuth(calls[0]);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      order_id: r.orderId,
      created_at: r.createdAt,
      record: r,
    });
  });

  it("getOrder filters by order_id and returns the record or null", async () => {
    const r = record();
    respond(json([{ record: r }]));
    expect(await store().getOrder(ID)).toEqual(r);
    expect(calls[0].url).toBe(`${BASE}/rest/v1/orders?select=record&order_id=eq.${ID}&limit=1`);
    respond(json([]));
    expect(await store().getOrder(ID)).toBeNull();
  });

  it("listOrders orders by created_at desc", async () => {
    respond(json([{ record: record("aaaaaaaa1") }, { record: record("bbbbbbbb2") }]));
    const list = await store().listOrders();
    expect(list.map((o) => o.orderId)).toEqual(["aaaaaaaa1", "bbbbbbbb2"]);
    expect(calls[0].url).toContain("order=created_at.desc");
  });

  it("updateOrder is one atomic rpc call with only status/notified; null when missing", async () => {
    respond(json({ ...record(), status: "done" }));
    const next = await store().updateOrder(ID, { status: "done", price: { totalIqd: 0 } } as never);
    expect(next).toMatchObject({ orderId: ID, status: "done" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/rest/v1/rpc/patch_order`);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ p_id: ID, p_patch: { status: "done" } });
    respond(json(null));
    expect(await store().updateOrder(ID, { status: "done" } as never)).toBeNull();
    expect(await store().updateOrder("../bad", { status: "done" } as never)).toBeNull();
  });
});

describe("SupabaseStorage settings", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("THROWS on an outage instead of showing default prices", async () => {
    respond(json({ error: "x" }, 500));
    await expect(store().getSettings()).rejects.toThrow(/500/);
  });

  it("THROWS when the network fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(store().getSettings()).rejects.toThrow(/offline/);
  });

  it("every request carries a timeout signal", async () => {
    respond(json([]));
    await store().getSettings();
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns defaults when no row exists", async () => {
    respond(json([]));
    expect(await store().getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(calls[0].url).toBe(`${BASE}/rest/v1/settings?select=data&id=eq.1&limit=1`);
  });

  it("deep-merges stored data over defaults", async () => {
    respond(json([{ data: { maxUploadBytes: 1234 } }]));
    const s = await store().getSettings();
    expect(s.maxUploadBytes).toBe(1234);
    expect({ ...s, maxUploadBytes: DEFAULT_SETTINGS.maxUploadBytes }).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to defaults when stored data is invalid", async () => {
    respond(json([{ data: { maxUploadBytes: "lots" } }]));
    expect(await store().getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("returns a fresh copy each time (callers may mutate)", async () => {
    respond(json([]), json([]));
    const a = await store().getSettings();
    (a as { maxUploadBytes: number }).maxUploadBytes = 1;
    expect((await store().getSettings()).maxUploadBytes).toBe(DEFAULT_SETTINGS.maxUploadBytes);
  });

  it("saveSettings upserts id=1 with on_conflict=id", async () => {
    respond(empty(201));
    await store().saveSettings(DEFAULT_SETTINGS);
    expect(calls[0].url).toBe(`${BASE}/rest/v1/settings?on_conflict=id`);
    expect(calls[0].init.method).toBe("POST");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.id).toBe(1);
    expect(body.data).toEqual(DEFAULT_SETTINGS);
    expectAuth(calls[0]);
  });
});

describe("SupabaseStorage not-found vs outage", () => {
  it("a 400 whose body says 404 means missing", async () => {
    respond(json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400));
    expect(await store().readFile(`orders/${ID}.pdf`)).toBeNull();
  });
  it("a 400 for a bad key is an ERROR, not missing", async () => {
    respond(json({ statusCode: "403", error: "Unauthorized", message: "invalid signature" }, 400));
    await expect(store().readFile(`orders/${ID}.pdf`)).rejects.toThrow(/400/);
  });
  it("a plain 404 means missing", async () => {
    respond(empty(404));
    expect(await store().readFile(`orders/${ID}.pdf`)).toBeNull();
  });
  it("signedDownloadUrl rejects an unexpected signedURL shape", async () => {
    respond(json({ signedURL: "https://evil.example/x" }));
    expect(await store().signedDownloadUrl(`orders/${ID}.pdf`, "a.pdf")).toBeNull();
  });
});

describe("SupabaseStorage purge", () => {
  const OLD = "oldOrder0001";
  const KEEP = "keepUpload01";
  it("deletes old orders with their files, keeps uploads used by newer orders, drops stale orphans", async () => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    const cutoff = new Date(now - 30 * 86400_000);
    const orphanCutoff = new Date(now - 3 * 3600_000);
    respond(
      json([{ order_id: OLD, files: { pdfPath: `orders/${OLD}.pdf`, designPath: `uploads/${OLD}.bin` } }]),
      json([{ design: `uploads/${KEEP}.bin` }]),
      json([
        { name: `${OLD}.bin`, created_at: "2026-09-01T00:00:00Z" },
        { name: `${OLD}.json`, created_at: "2026-09-01T00:00:00Z" },
        { name: `${KEEP}.bin`, created_at: "2026-09-01T00:00:00Z" },
        { name: `${KEEP}.json`, created_at: "2026-09-01T00:00:00Z" },
        { name: "orphanStale1.bin", created_at: "2026-11-07T06:00:00Z" },
        { name: "orphanFresh1.bin", created_at: "2026-11-07T11:30:00Z" },
        { name: "committedNew.bin", created_at: "2026-11-07T06:00:00Z" },
        { name: "committedNew.json", created_at: "2026-11-07T06:00:00Z" },
      ]),
      json([]),
      empty(204),
    );
    const removed = await store().purgeOlderThan(cutoff, false, orphanCutoff);
    expect(removed).toContain(`order:${OLD}`);
    expect(removed).toEqual(
      expect.arrayContaining([`orders/${OLD}.pdf`, `uploads/${OLD}.bin`, `uploads/${OLD}.json`, "uploads/orphanStale1.bin"]),
    );
    expect(removed).not.toContain(`uploads/${KEEP}.bin`);
    expect(removed).not.toContain("uploads/orphanFresh1.bin");
    expect(removed).not.toContain("uploads/committedNew.bin");
    const del = calls.find((c) => c.init.method === "DELETE" && c.url.endsWith("/object/etihad"))!;
    expect(JSON.parse(del.init.body as string).prefixes).toHaveLength(4);
    expect(calls.at(-1)!.url).toContain("/rest/v1/orders?created_at=lt.");
    expect(calls.at(-1)!.init.method).toBe("DELETE");
  });
  it("dry run deletes nothing", async () => {
    respond(json([]), json([]), json([]));
    expect(await store().purgeOlderThan(new Date(), true)).toEqual([]);
    expect(calls.every((c) => c.init.method !== "DELETE")).toBe(true);
  });
});
