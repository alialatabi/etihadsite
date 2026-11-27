import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseStorage } from "@/lib/storage/supabase";
import type { StorageAdapter, UploadInfoProbe } from "@/lib/types";
import { setupEnv } from "./helpers";

/**
 * A fresh direct-upload commit on Supabase used to GET the meta object twice (uploadInfo, then readUpload).
 * These tests count the Storage requests the real adapter makes behind the real commit route.
 */
let storage: StorageAdapter;
vi.mock("@/lib/storage", () => ({ getStorage: () => storage }));

import { POST as commit } from "@/app/api/upload/direct/commit/route";

const BASE = "https://proj.supabase.co";
const ID = "abcDEF_123-xyz";
const META_URL = `${BASE}/storage/v1/object/authenticated/etihad/uploads/${ID}.json`;
const BIN_URL = `${BASE}/storage/v1/object/authenticated/etihad/uploads/${ID}.bin`;
const INFO_URL = `${BASE}/storage/v1/object/info/authenticated/etihad/uploads/${ID}.bin`;
const PNG = new Uint8Array(readFileSync(join(__dirname, "..", "..", "fixtures", "padded-400x400.png")));
const META = { mime: "image/png", originalName: "a.png", bytes: PNG.byteLength, createdAt: "2026-11-10T08:00:00.000Z" };

const notFound = () => new Response(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }), { status: 400 });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

type Route = (method: string) => Response | Promise<Response>;
let routes: Record<string, Route>;
let seen: string[];

beforeEach(() => {
  setupEnv();
  routes = {};
  seen = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = url.split("?")[0];
      seen.push(`${method} ${path}`);
      const hit = routes[path];
      if (hit) return hit(method);
      if (path.endsWith("/rest/v1/settings")) return json([]);
      if (method === "POST") return new Response("", { status: 200 });
      throw new Error(`unexpected fetch ${method} ${url}`);
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let ipSeq = 0;
function call() {
  const raw = JSON.stringify({ uploadId: ID });
  return commit(
    new Request("http://localhost/api/upload/direct/commit", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(raw.length), "x-forwarded-for": `9.9.0.${++ipSeq}` },
      body: raw,
    }),
  );
}

const count = (needle: string) => seen.filter((s) => s === `GET ${needle}`).length;

/** The adapter as it behaved before: the probe is never filled, so the commit step asks readUpload. */
function withoutProbe(real: SupabaseStorage): StorageAdapter {
  return new Proxy(real, {
    get(t, p, r) {
      if (p === "uploadInfo") return (id: string) => t.uploadInfo(id);
      const v = Reflect.get(t, p, r);
      return typeof v === "function" ? v.bind(t) : v;
    },
  }) as unknown as StorageAdapter;
}

describe("direct commit on Supabase: Storage GETs of the meta", () => {
  it("a fresh upload GETs the meta once (twice without the probe), and answers the same", async () => {
    routes[META_URL] = () => notFound();
    routes[BIN_URL] = () => new Response(PNG as BodyInit, { status: 200 });

    storage = withoutProbe(new SupabaseStorage(BASE, "k"));
    const before = await call();
    const metaBefore = count(META_URL);
    const allBefore = seen.length;

    seen = [];
    storage = new SupabaseStorage(BASE, "k");
    const after = await call();

    expect(metaBefore).toBe(2);
    expect(count(META_URL)).toBe(1);
    expect(seen.length).toBe(allBefore - 1);
    expect(after.status).toBe(200);
    expect(before.status).toBe(200);
    expect(await after.json()).toEqual(await before.json());
    expect(count(BIN_URL)).toBe(1);
    expect(seen.filter((s) => s.startsWith("POST ") && s.endsWith(`${ID}.json`))).toHaveLength(1);
  });

  it("a plain 404 of the meta counts as missing too, and a missing .bin is still 400 corrupt", async () => {
    routes[META_URL] = () => new Response("", { status: 404 });
    routes[BIN_URL] = () => new Response("", { status: 404 });
    storage = new SupabaseStorage(BASE, "k");
    const res = await call();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "corrupt" });
    expect(count(META_URL)).toBe(1);
    expect(count(BIN_URL)).toBe(1);
  });

  it("already committed: answered from the meta and the object info, nothing else read", async () => {
    routes[META_URL] = () => json(META);
    routes[INFO_URL] = () => json({ size: PNG.byteLength });
    storage = new SupabaseStorage(BASE, "k");
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, uploadId: ID, kind: "png", bytes: PNG.byteLength });
    expect(count(META_URL)).toBe(1);
    expect(count(BIN_URL)).toBe(0);
  });

  it("unknown (a 500 on the meta): readUpload still decides, so the meta is asked again, as before", async () => {
    routes[META_URL] = () => new Response("boom", { status: 500 });
    storage = new SupabaseStorage(BASE, "k");
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, error: "server_error" });
    expect(count(META_URL)).toBe(2);
  });

  it("unknown (meta present, .bin purged): readUpload decides and the answer is 400 corrupt, as before", async () => {
    routes[META_URL] = () => json(META);
    routes[INFO_URL] = () => notFound();
    routes[BIN_URL] = () => new Response("", { status: 404 });
    storage = new SupabaseStorage(BASE, "k");
    const res = await call();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "corrupt" });
    expect(count(META_URL)).toBe(2);
  });

  it("a network error on the meta is 500 server_error, with nothing read after it", async () => {
    routes[META_URL] = () => {
      throw new TypeError("fetch failed");
    };
    storage = new SupabaseStorage(BASE, "k");
    const res = await call();
    expect(res.status).toBe(500);
    expect(count(META_URL)).toBe(1);
    expect(count(BIN_URL)).toBe(0);
  });
});

describe("SupabaseStorage.uploadInfo probe", () => {
  const info = (probe: UploadInfoProbe) => new SupabaseStorage(BASE, "k").uploadInfo(ID, probe);

  it("sets missing only for a clean not-found of the meta", async () => {
    for (const res of [() => new Response("", { status: 404 }), notFound]) {
      routes[META_URL] = res;
      const probe: UploadInfoProbe = {};
      expect(await info(probe)).toBeNull();
      expect(probe.missing).toBe(true);
    }
  });

  it("leaves it unset for a 5xx, any other 4xx, an unreadable meta, a purged .bin and a good answer", async () => {
    const cases: Array<[Route, Route | null]> = [
      [() => new Response("", { status: 500 }), null],
      [() => new Response("", { status: 403 }), null],
      [() => new Response("not json", { status: 200 }), null],
      [() => json(META), () => notFound()],
      [() => json(META), () => json({ size: 3 })],
    ];
    for (const [meta, bin] of cases) {
      routes[META_URL] = meta;
      if (bin) routes[INFO_URL] = bin;
      const probe: UploadInfoProbe = {};
      await info(probe);
      expect(probe.missing).toBeUndefined();
    }
  });

  it("works without a probe (the AI pre-check passes none)", async () => {
    routes[META_URL] = () => notFound();
    expect(await new SupabaseStorage(BASE, "k").uploadInfo(ID)).toBeNull();
  });
});
