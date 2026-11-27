import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import type {
  DirectUploadStart,
  ShopSettings,
  StorageAdapter,
  StoredFileMeta,
  UploadResponse,
} from "@/lib/types";
import { pngWithDeclaredSize } from "../png-header";
import { pdfWithOpenActionJs, pdfWithRichMedia } from "../unsafe-pdf";
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
/** Real, decodable files: commit now reads the image header, so magic bytes alone are refused. */
const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, "..", "..", "fixtures", n)));

type FakeAdapter = StorageAdapter & {
  files: Map<string, Uint8Array>;
  metas: Map<string, StoredFileMeta>;
  createDirectUpload: ReturnType<typeof vi.fn>;
  saveUploadMeta: ReturnType<typeof vi.fn>;
  saveUpload: ReturnType<typeof vi.fn>;
  deleteFile: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  readUpload: ReturnType<typeof vi.fn>;
  getSettings: ReturnType<typeof vi.fn>;
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
    const bytes = fx("padded-400x400.png");
    f.files.set(`uploads/${ID}.bin`, bytes);
    fake = f;
    const res = await commit(commitReq({ uploadId: ID, name: "photo\u0001.jpg" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as UploadResponse).toEqual({ ok: true, uploadId: ID, kind: "png", bytes: bytes.byteLength });
    expect(f.saveUploadMeta).toHaveBeenCalledTimes(1);
    const [id, meta] = f.saveUploadMeta.mock.calls[0] as [string, StoredFileMeta];
    expect(id).toBe(ID);
    expect(meta).toMatchObject({ mime: "image/png", originalName: "photo.jpg", bytes: bytes.byteLength });
    expect(Number.isNaN(Date.parse(meta.createdAt))).toBe(false);
    expect(f.deleteFile).not.toHaveBeenCalled();
    expect(f.saveUpload).not.toHaveBeenCalled();
  });

  it("sniffs JPEG and defaults the name to 'design'", async () => {
    const f = makeFake();
    f.files.set(`uploads/${ID}.bin`, fx("exif6-600x400.jpg"));
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(200);
    expect(f.saveUploadMeta).toHaveBeenCalledWith(ID, expect.objectContaining({ mime: "image/jpeg", originalName: "design" }));
  });

  it.each([
    ["PNG that is only magic bytes", new Uint8Array([...PNG, 1, 2, 3])],
    ["JPEG that is only magic bytes", new Uint8Array([...JPEG, 0, 0])],
    ["PNG header over the pixel cap (16000 x 16000)", pngWithDeclaredSize(16_000, 16_000)],
  ])("rejects a %s with 400 corrupt and deletes it", async (_label, bytes) => {
    const f = makeFake();
    f.files.set(`uploads/${ID}.bin`, bytes);
    fake = f;
    const res = await commit(commitReq({ uploadId: ID, name: "a.png" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "corrupt" });
    expect(f.deleteFile).toHaveBeenCalledWith(`uploads/${ID}.bin`);
    expect(f.saveUploadMeta).not.toHaveBeenCalled();
    expect(f.files.has(`uploads/${ID}.bin`)).toBe(false);
  });

  it.each([
    ["a JavaScript OpenAction", pdfWithOpenActionJs],
    ["a RichMedia annotation", pdfWithRichMedia],
  ])("rejects a PDF with %s with 422 unsafe and deletes it", async (_label, make) => {
    const f = makeFake();
    f.files.set(`uploads/${ID}.bin`, await make());
    fake = f;
    const res = await commit(commitReq({ uploadId: ID, name: "a.pdf" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: "unsafe", message: "الملف فيه محتوى غير مسموح. صدّره من جديد كـPNG أو PDF عادي." });
    expect(f.deleteFile).toHaveBeenCalledWith(`uploads/${ID}.bin`);
    expect(f.saveUploadMeta).not.toHaveBeenCalled();
    expect(f.files.has(`uploads/${ID}.bin`)).toBe(false);
  });

  it("rejects a PNG cut in the middle with 400 corrupt and deletes it", async () => {
    const f = makeFake();
    f.files.set(`uploads/${ID}.bin`, fx("padded-400x400.png").slice(0, 600));
    fake = f;
    const res = await commit(commitReq({ uploadId: ID, name: "a.png" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "corrupt" });
    expect(f.deleteFile).toHaveBeenCalledWith(`uploads/${ID}.bin`);
  });

  it("without saveUploadMeta, a real PNG is committed through saveUpload (bytes + meta)", async () => {
    const f = makeFake();
    const png = fx("padded-400x400.png");
    const saved: { id: string; bytes: number; meta: StoredFileMeta }[] = [];
    (f as StorageAdapter).saveUploadMeta = undefined;
    f.saveUpload.mockImplementation(async (id: string, bytes: Uint8Array, meta: StoredFileMeta) => {
      saved.push({ id, bytes: bytes.byteLength, meta });
      return `uploads/${id}.bin`;
    });
    f.files.set(`uploads/${ID}.bin`, png);
    fake = f;
    const res = await commit(commitReq({ uploadId: ID, name: "logo.png" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, uploadId: ID, kind: "png", bytes: png.byteLength });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: ID, bytes: png.byteLength, meta: { mime: "image/png", originalName: "logo.png", bytes: png.byteLength } });
  });

  it("commits a PNG header at 139.2 MP (full A4 at 1200 DPI)", async () => {
    const f = makeFake();
    f.files.set(`uploads/${ID}.bin`, pngWithDeclaredSize(9921, 14031));
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(200);
    expect(f.saveUploadMeta).toHaveBeenCalledTimes(1);
  });

  it("never judges a PDF: a real PDF and a magic-bytes-only PDF are both committed", async () => {
    for (const bytes of [fx("two-page.pdf"), new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3])]) {
      const f = makeFake();
      f.files.set(`uploads/${ID}.bin`, bytes);
      fake = f;
      const res = await commit(commitReq({ uploadId: ID, name: "a.pdf" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, kind: "pdf", bytes: bytes.byteLength });
      expect(f.deleteFile).not.toHaveBeenCalled();
    }
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

  it("with uploadInfo, answers an already-committed id from the meta alone: no download of the bytes", async () => {
    const f = makeFake();
    const info = vi.fn(async () => ({
      meta: { mime: "application/pdf", originalName: "a.pdf", bytes: 5000, createdAt: new Date().toISOString() },
      size: 5000,
    }));
    (f as StorageAdapter).uploadInfo = info;
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, uploadId: ID, kind: "pdf", bytes: 5000 });
    expect(info).toHaveBeenCalledTimes(1);
    expect(f.readUpload).not.toHaveBeenCalled();
    expect(f.readFile).not.toHaveBeenCalled();
    expect(f.saveUploadMeta).not.toHaveBeenCalled();
    expect(f.deleteFile).not.toHaveBeenCalled();
  });

  it("with uploadInfo, a meta whose mime is not a design type answers 415 unsupported_type", async () => {
    const f = makeFake();
    (f as StorageAdapter).uploadInfo = vi.fn(async () => ({
      meta: { mime: "image/gif", originalName: "a.gif", bytes: 9, createdAt: new Date().toISOString() },
      size: 9,
    }));
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ ok: false, error: "unsupported_type" });
  });

  it("with uploadInfo returning null (no meta, or the .bin was purged) readUpload is asked, then the fresh path: a missing .bin is still 400 corrupt", async () => {
    const f = makeFake();
    (f as StorageAdapter).uploadInfo = vi.fn(async () => null);
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "corrupt" });
    expect(f.readUpload).toHaveBeenCalledWith(ID);
    expect(f.readFile).toHaveBeenCalledWith(`uploads/${ID}.bin`);
  });

  it("with uploadInfo returning null for an already-committed id (the info call was inconclusive), it falls back to readUpload and answers 200, not 500", async () => {
    const f = makeFake();
    f.files.set(`uploads/${ID}.bin`, new Uint8Array([...PNG, 9]));
    f.metas.set(ID, { mime: "image/png", originalName: "a.png", bytes: 9, createdAt: new Date().toISOString() });
    (f as StorageAdapter).uploadInfo = vi.fn(async () => null);
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, uploadId: ID, kind: "png", bytes: 9 });
    expect(f.readUpload).toHaveBeenCalledTimes(1);
    expect(f.readFile).not.toHaveBeenCalled();
    expect(f.saveUploadMeta).not.toHaveBeenCalled();
  });

  it("with uploadInfo throwing (a network error), the answer is 500 server_error as before, and readUpload is not tried", async () => {
    const f = makeFake();
    (f as StorageAdapter).uploadInfo = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    fake = f;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, error: "server_error" });
    expect(f.readUpload).not.toHaveBeenCalled();
  });

  it("with uploadInfo returning null and fresh bytes in place, commits them normally", async () => {
    const f = makeFake();
    (f as StorageAdapter).uploadInfo = vi.fn(async () => null);
    f.files.set(`uploads/${ID}.bin`, fx("padded-400x400.png"));
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(200);
    expect(f.saveUploadMeta).toHaveBeenCalledTimes(1);
  });

  it("rate limits commits per IP with its own limiter (40 per hour): 429 + Retry-After, and the start limiter is not touched", async () => {
    const f = makeFake();
    fake = f;
    const ip = "6.6.6.6";
    for (let i = 0; i < 40; i++) {
      const r = await commit(commitReq({ uploadId: ID }, ip));
      expect(r.status).toBe(400); // nothing uploaded: corrupt, but it was not rate limited
    }
    const limited = await commit(commitReq({ uploadId: ID }, ip));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(await limited.json()).toMatchObject({ ok: false, error: "rate_limited" });
    // Refused before the body is read and before any storage call.
    const readsBefore = f.readFile.mock.calls.length;
    await commit(commitReq({ uploadId: ID }, ip));
    expect(f.readFile.mock.calls.length).toBe(readsBefore);
    // The same address can still start uploads, and another address can still commit.
    expect((await start(startReq({ size: 10 }, ip))).status).toBe(200);
    expect((await commit(commitReq({ uploadId: ID }, "6.6.6.7"))).status).toBe(400);
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

describe("POST /api/upload/direct/commit: the settings read starts before the download", () => {
  it("getSettings is called while readFile is still pending", async () => {
    const f = makeFake();
    const png = fx("padded-400x400.png");
    let release!: (b: Uint8Array) => void;
    const download = new Promise<Uint8Array>((r) => (release = r));
    f.readFile.mockImplementation(() => download);
    fake = f;
    const pending = commit(commitReq({ uploadId: ID }));
    await vi.waitFor(() => expect(f.readFile).toHaveBeenCalledTimes(1));
    expect(f.getSettings).toHaveBeenCalledTimes(1);
    release(png);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(f.getSettings).toHaveBeenCalledTimes(1);
    expect(f.saveUploadMeta).toHaveBeenCalledTimes(1);
  });

  it("a missing .bin is still 400 corrupt when the settings read fails (no unhandled rejection)", async () => {
    const f = makeFake();
    f.getSettings.mockRejectedValue(new Error("storage down (getSettings)"));
    fake = f;
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "corrupt" });
    expect(f.getSettings).toHaveBeenCalledTimes(1);
  });

  it("a failed download answers 500 server_error and leaves no unhandled rejection from the settings read", async () => {
    const f = makeFake();
    f.getSettings.mockRejectedValue(new Error("storage down (getSettings)"));
    f.readFile.mockRejectedValue(new Error("storage down (readFile)"));
    fake = f;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, error: "server_error" });
    expect(String(errors.mock.calls[0]?.[1])).toContain("readFile");
  });

  it("with the bytes present, a settings failure is still 500 server_error and nothing is written", async () => {
    const f = makeFake();
    f.files.set(`uploads/${ID}.bin`, fx("padded-400x400.png"));
    f.getSettings.mockRejectedValue(new Error("storage down (getSettings)"));
    fake = f;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await commit(commitReq({ uploadId: ID }));
    expect(res.status).toBe(500);
    expect(f.saveUploadMeta).not.toHaveBeenCalled();
    expect(f.deleteFile).not.toHaveBeenCalled();
  });
});
