import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import type {
  DirectUploadStart,
  ShopSettings,
  StorageAdapter,
  StoredFileMeta,
  UploadResponse,
} from "@/lib/types";
import { setupEnv } from "./helpers";

/**
 * `fake` = null -> the real getStorage() (local disk under a fresh DATA_DIR).
 * Otherwise every caller (routes and getSettings) sees the fake adapter.
 */
let fake: StorageAdapter | null = null;

vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { getStorage: () => fake ?? actual.getStorage() };
});

import { POST as start } from "@/app/api/upload/direct/route";
import { POST as commit } from "@/app/api/upload/direct/commit/route";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const ID = "abcDEF_123-xyz";

type FakeAdapter = StorageAdapter & {
  files: Map<string, Uint8Array>;
  metas: Map<string, StoredFileMeta>;
  createDirectUpload: ReturnType<typeof vi.fn>;
  saveUploadMeta: ReturnType<typeof vi.fn>;
  saveUpload: ReturnType<typeof vi.fn>;
  deleteFile: ReturnType<typeof vi.fn>;
};

function makeFake(settings: Partial<ShopSettings> = {}): FakeAdapter {
  const files = new Map<string, Uint8Array>();
  const metas = new Map<string, StoredFileMeta>();
  const a = {
    files,
    metas,
    createDirectUpload: vi.fn(
      async (id: string) => `https://sb.example/storage/v1/object/upload/sign/etihad/uploads/${id}.bin?token=t`,
    ),
    saveUploadMeta: vi.fn(async (id: string, meta: StoredFileMeta) => {
      metas.set(id, meta);
    }),
    saveUpload: vi.fn(async () => {
      throw new Error("saveUpload must not be called for direct uploads");
    }),
    deleteFile: vi.fn(async (rel: string) => {
      files.delete(rel);
    }),
    readFile: vi.fn(async (rel: string) => files.get(rel) ?? null),
    readUpload: vi.fn(async (id: string) => {
      const bytes = files.get(`uploads/${id}.bin`);
      const meta = metas.get(id);
      return bytes && meta ? { bytes, meta } : null;
    }),
    savePdf: vi.fn(),
    saveOrder: vi.fn(),
    getOrder: vi.fn(async () => null),
    listOrders: vi.fn(async () => []),
    updateOrder: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({ ...structuredClone(DEFAULT_SETTINGS), ...settings })),
    saveSettings: vi.fn(),
  };
  return a as unknown as FakeAdapter;
}

function jsonReq(url: string, body: unknown, ip = "8.8.8.8"): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(raw).byteLength),
      "x-forwarded-for": ip,
    },
    body: raw,
  });
}

const startReq = (body: unknown, ip?: string) => jsonReq("http://localhost/api/upload/direct", body, ip);
const commitReq = (body: unknown, ip?: string) => jsonReq("http://localhost/api/upload/direct/commit", body, ip);

beforeEach(() => {
  setupEnv();
  delete process.env.STORAGE;
  fake = null;
});

afterEach(() => {
  fake = null;
  vi.restoreAllMocks();
});

describe("POST /api/upload/direct", () => {
  it("answers mode:'server' for local storage (no createDirectUpload)", async () => {
    const res = await start(startReq({ size: 1000, name: "a.png" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as DirectUploadStart).toEqual({ ok: true, mode: "server" });
  });

  it("returns a signed URL and a fresh uploadId with a direct adapter", async () => {
    const f = makeFake();
    fake = f;
    const res = await start(startReq({ size: 1000, name: "a.png" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as DirectUploadStart;
    if (!body.ok || body.mode !== "direct") throw new Error("expected direct");
    expect(body.uploadId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(f.createDirectUpload).toHaveBeenCalledWith(body.uploadId);
    expect(body.url).toBe(
      `https://sb.example/storage/v1/object/upload/sign/etihad/uploads/${body.uploadId}.bin?token=t`,
    );
  });

  it("rejects a declared size over maxUploadBytes with 413 too_large", async () => {
    const f = makeFake({ maxUploadBytes: 5000 });
    fake = f;
    const res = await start(startReq({ size: 5001 }));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, error: "too_large" });
    expect(f.createDirectUpload).not.toHaveBeenCalled();
  });

  it("accepts a size exactly at the cap", async () => {
    fake = makeFake({ maxUploadBytes: 5000 });
    const res = await start(startReq({ size: 5000 }));
    expect(res.status).toBe(200);
  });

  it.each([
    ["bad JSON", "{not json"],
    ["missing size", { name: "a.png" }],
    ["zero size", { size: 0 }],
    ["fractional size", { size: 1.5 }],
    ["string size", { size: "100" }],
  ])("rejects %s with 400 corrupt", async (_label, body) => {
    const f = makeFake();
    fake = f;
    const res = await start(startReq(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "corrupt" });
    expect(f.createDirectUpload).not.toHaveBeenCalled();
  });

  it("returns 500 server_error when signing fails", async () => {
    const f = makeFake();
    f.createDirectUpload.mockRejectedValueOnce(new Error("boom"));
    fake = f;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await start(startReq({ size: 10 }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, error: "server_error" });
  });

  it("rate limits direct starts per IP", async () => {
    fake = makeFake();
    for (let i = 0; i < 20; i++) await start(startReq({ size: 10 }, "7.7.7.7"));
    const limited = await start(startReq({ size: 10 }, "7.7.7.7"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(await limited.json()).toMatchObject({ ok: false, error: "rate_limited" });
  });
});

describe("POST /api/upload/direct/commit", () => {
  it("returns 400 corrupt when the bytes were never uploaded", async () => {
    const f = makeFake();
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "corrupt" });
    expect(f.saveUploadMeta).not.toHaveBeenCalled();
  });

  it("rejects non-image bytes with 415 and deletes them", async () => {
    const f = makeFake();
    f.files.set(`uploads/${ID}.bin`, new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]));
    fake = f;
    const res = await commit(commitReq({ uploadId: ID, name: "a.png" }));
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ ok: false, error: "unsupported_type" });
    expect(f.deleteFile).toHaveBeenCalledWith(`uploads/${ID}.bin`);
    expect(f.saveUploadMeta).not.toHaveBeenCalled();
    expect(f.files.has(`uploads/${ID}.bin`)).toBe(false);
  });

  it("rejects oversize real bytes with 413 and deletes them", async () => {
    const f = makeFake({ maxUploadBytes: 100 });
    const big = new Uint8Array(101);
    big.set(PNG);
    f.files.set(`uploads/${ID}.bin`, big);
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, error: "too_large" });
    expect(f.deleteFile).toHaveBeenCalledWith(`uploads/${ID}.bin`);
    expect(f.saveUploadMeta).not.toHaveBeenCalled();
  });

  it("rejects empty bytes with 400 and deletes them", async () => {
    const f = makeFake();
    f.files.set(`uploads/${ID}.bin`, new Uint8Array(0));
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(400);
    expect(f.deleteFile).toHaveBeenCalledWith(`uploads/${ID}.bin`);
  });

  it("still answers the rejection when the delete itself fails", async () => {
    const f = makeFake();
    f.files.set(`uploads/${ID}.bin`, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    f.deleteFile.mockRejectedValueOnce(new Error("network"));
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(415);
  });

  it("commits a valid PNG: 200 and saveUploadMeta with the sniffed mime (not the name)", async () => {
    const f = makeFake();
    const bytes = new Uint8Array([...PNG, 1, 2, 3]);
    f.files.set(`uploads/${ID}.bin`, bytes);
    fake = f;
    const res = await commit(commitReq({ uploadId: ID, name: "photo\u0001.jpg" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as UploadResponse).toEqual({ ok: true, uploadId: ID, kind: "png", bytes: 11 });
    expect(f.saveUploadMeta).toHaveBeenCalledTimes(1);
    const [id, meta] = f.saveUploadMeta.mock.calls[0] as [string, StoredFileMeta];
    expect(id).toBe(ID);
    expect(meta).toMatchObject({ mime: "image/png", originalName: "photo.jpg", bytes: 11 });
    expect(Number.isNaN(Date.parse(meta.createdAt))).toBe(false);
    expect(f.deleteFile).not.toHaveBeenCalled();
    expect(f.saveUpload).not.toHaveBeenCalled();
  });

  it("sniffs JPEG and defaults the name to 'design'", async () => {
    const f = makeFake();
    f.files.set(`uploads/${ID}.bin`, new Uint8Array([...JPEG, 0, 0]));
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(200);
    expect(f.saveUploadMeta).toHaveBeenCalledWith(ID, expect.objectContaining({ mime: "image/jpeg", originalName: "design" }));
  });

  it("answers an already-committed id with 200 without re-writing", async () => {
    const f = makeFake();
    const bytes = new Uint8Array([...PNG, 9]);
    f.files.set(`uploads/${ID}.bin`, bytes);
    f.metas.set(ID, { mime: "image/png", originalName: "a.png", bytes: 9, createdAt: new Date().toISOString() });
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, uploadId: ID, kind: "png", bytes: 9 });
    expect(f.saveUploadMeta).not.toHaveBeenCalled();
    expect(f.saveUpload).not.toHaveBeenCalled();
    expect(f.deleteFile).not.toHaveBeenCalled();
    expect(f.readFile).not.toHaveBeenCalled();
  });

  it.each([
    ["too short", { uploadId: "abc" }],
    ["traversal", { uploadId: "../../etc/passwd" }],
    ["slash", { uploadId: "uploads/abcdefgh" }],
    ["missing", { name: "a.png" }],
    ["bad JSON", "{"],
  ])("rejects an invalid uploadId (%s) with 400 before touching storage", async (_label, body) => {
    const f = makeFake();
    fake = f;
    const res = await commit(commitReq(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "corrupt" });
    expect(f.readUpload).not.toHaveBeenCalled();
    expect(f.readFile).not.toHaveBeenCalled();
  });

  it("refuses commits on local storage (no direct uploads there)", async () => {
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "corrupt" });
  });
});
