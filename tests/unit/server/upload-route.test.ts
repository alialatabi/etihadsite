import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import type { UploadResponse } from "@/lib/types";
import { pngWithDeclaredSize } from "../png-header";
import { setupEnv } from "./helpers";

/** Default = the real after() (throws outside a request, like a script); a test swaps it to queue callbacks. */
let afterImpl: ((cb: () => unknown) => void) | null = null;
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => (afterImpl ?? actual.after)(cb as never) };
});

import { POST } from "@/app/api/upload/route";
import { getStorage } from "@/lib/storage";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Real, decodable files: the upload routes now read the image header, so magic bytes alone are refused. */
const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, "..", "..", "fixtures", n)));

/** Builds a multipart request with a real Content-Length (as curl/browsers send). */
async function multipart(form: FormData, ip: string, withLength = true) {
  const encoded = new Response(form);
  const raw = new Uint8Array(await encoded.arrayBuffer());
  const headers: Record<string, string> = {
    "x-forwarded-for": ip,
    "content-type": encoded.headers.get("content-type")!,
  };
  if (withLength) headers["content-length"] = String(raw.byteLength);
  return new Request("http://localhost/api/upload", {
    method: "POST",
    body: raw,
    headers,
  });
}

async function upload(
  bytes: Uint8Array,
  name = "a.png",
  type = "image/png",
  ip = "8.8.8.8",
) {
  const form = new FormData();
  form.set("file", new File([bytes as BlobPart], name, { type }));
  return POST(await multipart(form, ip));
}

const json = async (r: Response) => (await r.json()) as UploadResponse;

beforeEach(() => {
  setupEnv();
});

afterEach(() => {
  afterImpl = null;
  vi.restoreAllMocks();
});

describe("POST /api/upload: the analytics event is queued with after()", () => {
  it("inside a request the event is written when after() fires, not before the answer", async () => {
    const recordEvent = vi.spyOn(getStorage(), "recordEvent");
    const queued: Array<() => unknown> = [];
    afterImpl = (cb) => void queued.push(cb);
    const res = await upload(fx("padded-400x400.png"));
    expect(res.status).toBe(200);
    expect(queued).toHaveLength(1);
    expect(recordEvent).not.toHaveBeenCalled();
    await queued[0]();
    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(recordEvent.mock.calls[0][0]).toMatchObject({ type: "upload", meta: { kind: "png" } });
  });

  it("outside a request (after() throws) the event is awaited before the answer, as before", async () => {
    const recordEvent = vi.spyOn(getStorage(), "recordEvent");
    afterImpl = () => {
      throw new Error("after() outside a request scope");
    };
    expect((await upload(fx("padded-400x400.png"))).status).toBe(200);
    expect(recordEvent).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/upload", () => {
  it("stores a PNG and returns an uploadId", async () => {
    const png = fx("padded-400x400.png");
    const res = await upload(png);
    expect(res.status).toBe(200);
    const r = await json(res);
    if (!r.ok) throw new Error("expected ok");
    expect(r.kind).toBe("png");
    expect(r.bytes).toBe(png.byteLength);
    const stored = await getStorage().readUpload(r.uploadId);
    expect(stored?.meta.originalName).toBe("a.png");
    expect(stored?.meta.mime).toBe("image/png");
  });

  it("cleans the stored file name: control characters removed, at most 200 characters", async () => {
    const ctl = String.fromCharCode(0, 31, 10); // NUL, unit separator, newline
    const res = await upload(fx("padded-400x400.png"), `a${ctl[0]}b${ctl[1]}c${ctl[2]}${"x".repeat(300)}.png`);
    expect(res.status).toBe(200);
    const r = await json(res);
    if (!r.ok) throw new Error("expected ok");
    const name = (await getStorage().readUpload(r.uploadId))?.meta.originalName ?? "";
    expect(name).toHaveLength(200);
    expect(name.startsWith("abcxxx")).toBe(true);
    expect([...name].some((ch) => ch.charCodeAt(0) < 32)).toBe(false);
  });

  it("refuses a PNG that is only magic bytes (header unreadable) as 400 corrupt and stores nothing", async () => {
    const res = await upload(new Uint8Array([...PNG, 1, 2, 3]));
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ ok: false, error: "corrupt" });
  });

  it("refuses a JPEG that is only magic bytes as 400 corrupt", async () => {
    const res = await upload(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), "a.jpg", "image/jpeg");
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ ok: false, error: "corrupt" });
  });

  it("refuses a header over the pixel cap (16000 x 16000) as 400 corrupt, and accepts 139.2 MP", async () => {
    const over = await upload(pngWithDeclaredSize(16_000, 16_000));
    expect(over.status).toBe(400);
    expect(await json(over)).toMatchObject({ ok: false, error: "corrupt" });
    const a4 = await upload(pngWithDeclaredSize(9921, 14031));
    expect(a4.status).toBe(200);
  });

  it("never judges a PDF: a real PDF and one that is only the magic bytes are both stored", async () => {
    const real = await upload(fx("two-page.pdf"), "a.pdf", "application/pdf");
    expect(real.status).toBe(200);
    const bare = await upload(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]), "b.pdf", "application/pdf");
    expect(bare.status).toBe(200);
    const r = await json(bare);
    if (!r.ok) throw new Error("expected ok");
    expect(r.kind).toBe("pdf");
  });

  it("rejects a GIF by magic bytes even when labelled image/png", async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
    const res = await upload(gif, "a.png", "image/png");
    expect(res.status).toBe(415);
    expect(await json(res)).toMatchObject({
      ok: false,
      error: "unsupported_type",
    });
  });

  it("rejects oversize files", async () => {
    const big = new Uint8Array(DEFAULT_SETTINGS.maxUploadBytes + 1);
    big.set(PNG);
    const res = await upload(big);
    expect(res.status).toBe(413);
    expect(await json(res)).toMatchObject({ ok: false, error: "too_large" });
  });

  it("rejects a missing file field and rate limits", async () => {
    const empty = await POST(await multipart(new FormData(), "5.5.5.5"));
    expect(empty.status).toBe(400);
    for (let i = 0; i < 20; i++)
      await upload(
        new Uint8Array([...PNG, i]),
        "a.png",
        "image/png",
        "6.6.6.6",
      );
    const limited = await upload(
      new Uint8Array([...PNG, 99]),
      "a.png",
      "image/png",
      "6.6.6.6",
    );
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({
      ok: false,
      error: "rate_limited",
    });
  });

  it("rejects a request without Content-Length (code corrupt)", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([...PNG, 1])], "a.png", { type: "image/png" }),
    );
    const res = await POST(await multipart(form, "4.4.4.4", false));
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ ok: false, error: "corrupt" });
  });

  it("rejects a declared length over max + 64 KiB before reading the body", async () => {
    const req = new Request("http://localhost/api/upload", {
      method: "POST",
      headers: {
        "content-length": String(
          DEFAULT_SETTINGS.maxUploadBytes + 64 * 1024 + 1,
        ),
        "content-type": "multipart/form-data; boundary=x",
      },
      body: "x",
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it("aborts a body that lies about its Content-Length by streaming past the cap", async () => {
    const cap = DEFAULT_SETTINGS.maxUploadBytes + 64 * 1024;
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1024 * 1024;
        c.enqueue(new Uint8Array(1024 * 1024));
        if (pulled > cap * 3) c.close();
      },
    });
    const req = new Request("http://localhost/api/upload", {
      method: "POST",
      headers: {
        "content-length": "1000",
        "content-type": "multipart/form-data; boundary=x",
      },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(cap * 2);
  });

  it("uses one global bucket (x20 limits) when TRUST_PROXY=0", async () => {
    setupEnv({ TRUST_PROXY: "0" });
    for (let i = 0; i < 400; i++)
      await upload(
        new Uint8Array([...PNG, i % 250]),
        "a.png",
        "image/png",
        `1.1.${i % 200}.1`,
      );
    const limited = await upload(
      new Uint8Array([...PNG, 7]),
      "a.png",
      "image/png",
      "9.9.9.9",
    );
    expect(limited.status).toBe(429);
  }, 20_000); // 400 sharp uploads: 1.5 s alone, over 5 s under full parallel load
});
