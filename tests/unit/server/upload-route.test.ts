import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import type { UploadResponse } from "@/lib/types";
import { setupEnv } from "./helpers";

import { POST } from "@/app/api/upload/route";
import { getStorage } from "@/lib/storage";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

describe("POST /api/upload", () => {
  it("stores a PNG and returns an uploadId", async () => {
    const res = await upload(new Uint8Array([...PNG, 1, 2, 3]));
    expect(res.status).toBe(200);
    const r = await json(res);
    if (!r.ok) throw new Error("expected ok");
    expect(r.kind).toBe("png");
    expect(r.bytes).toBe(11);
    const stored = await getStorage().readUpload(r.uploadId);
    expect(stored?.meta.originalName).toBe("a.png");
    expect(stored?.meta.mime).toBe("image/png");
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
  });
});
