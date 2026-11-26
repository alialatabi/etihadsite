/**
 * /api/team/upload*: the staff twins of the customer upload routes (reference images on /team). Behind the staff
 * login, limited per ACCOUNT: the shop's IP bucket (limiters().upload / commit) is never used and never spent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupEnv } from "./helpers";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Error("NEXT_REDIRECT " + u);
  },
}));

const trackServer = vi.fn(async () => {});
vi.mock("@/lib/analytics/server", () => ({ trackServer: (...a: unknown[]) => (trackServer as (...x: unknown[]) => unknown)(...a) }));

import { POST as customerCommit } from "@/app/api/upload/direct/commit/route";
import { POST as customerStart } from "@/app/api/upload/direct/route";
import { POST as customerServer } from "@/app/api/upload/route";
import { POST as staffCommit } from "@/app/api/team/upload/direct/commit/route";
import { POST as staffStart } from "@/app/api/team/upload/direct/route";
import { POST as staffServer } from "@/app/api/team/upload/route";
import { createStaffSession } from "@/lib/auth/staff-session";
import { limiters } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import type { UploadResponse } from "@/lib/types";

const ID = "st_abcdefgh12";
const SHOP_IP = "8.8.8.8";
const png = new Uint8Array(readFileSync(join(__dirname, "..", "..", "fixtures", "padded-400x400.png")));

async function makeStaff() {
  const now = new Date().toISOString();
  await getStorage().staffCreate!({
    id: ID,
    name: "أحمد",
    phone: "9647701234567",
    active: true,
    createdAt: now,
    passwordChangedAt: now,
    passwordHash: "scrypt$16384$8$1$AAAA$BBBB",
  });
  await createStaffSession({ id: ID });
}

const jsonReq = (url: string, body: unknown) => {
  const raw = JSON.stringify(body);
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(raw.length), "x-forwarded-for": SHOP_IP },
    body: raw,
  });
};

async function multipartReq(url: string): Promise<Request> {
  const form = new FormData();
  form.set("file", new File([png as BlobPart], "ref.png", { type: "image/png" }));
  const encoded = new Response(form);
  const raw = new Uint8Array(await encoded.arrayBuffer());
  return new Request(url, {
    method: "POST",
    body: raw,
    headers: {
      "x-forwarded-for": SHOP_IP,
      "content-type": encoded.headers.get("content-type")!,
      "content-length": String(raw.byteLength),
    },
  });
}

/** Spends the whole allowance of `key`. */
function exhaust(limiter: { check(k: string): { ok: boolean } }, key: string) {
  while (limiter.check(key).ok);
}

beforeEach(() => {
  setupEnv();
  delete process.env.STORAGE;
  jar.clear();
  trackServer.mockClear();
});

describe("/api/team/upload*", () => {
  it("answers 401 without a session on all three routes and stores nothing", async () => {
    const saveUpload = vi.spyOn(getStorage(), "saveUpload");
    for (const res of [
      await staffStart(jsonReq("http://localhost/api/team/upload/direct", { size: 1000 })),
      await staffCommit(jsonReq("http://localhost/api/team/upload/direct/commit", { uploadId: "abcDEF_123-xyz" })),
      await staffServer(await multipartReq("http://localhost/api/team/upload")),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    }
    expect(saveUpload).not.toHaveBeenCalled();
  });

  it("a logged-in account uploads a reference through the server mode (same checks as the customer route)", async () => {
    await makeStaff();
    const start = await staffStart(jsonReq("http://localhost/api/team/upload/direct", { size: png.byteLength }));
    expect(await start.json()).toEqual({ ok: true, mode: "server" });
    const res = await staffServer(await multipartReq("http://localhost/api/team/upload"));
    const body = (await res.json()) as UploadResponse;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, kind: "png" });
  });

  it("staff uploads stay out of the site analytics; customer uploads are still tracked", async () => {
    await makeStaff();
    expect((await staffServer(await multipartReq("http://localhost/api/team/upload"))).status).toBe(200);
    expect(trackServer).not.toHaveBeenCalled();
    expect((await customerServer(await multipartReq("http://localhost/api/upload"))).status).toBe(200);
    expect(trackServer).toHaveBeenCalledTimes(1);
  });

  it("never touches the per-IP buckets: a spent shop IP does not stop staff, and staff do not spend it", async () => {
    await makeStaff();
    const l = limiters();
    exhaust(l.upload, SHOP_IP);
    exhaust(l.commit, SHOP_IP);
    // The customer routes are refused for the shop IP ...
    expect((await customerServer(await multipartReq("http://localhost/api/upload"))).status).toBe(429);
    expect((await customerCommit(jsonReq("http://localhost/api/upload/direct/commit", { uploadId: "abcDEF_123-xyz" }))).status).toBe(429);
    // ... the staff ones still work.
    expect((await staffServer(await multipartReq("http://localhost/api/team/upload"))).status).toBe(200);
    // and the other way round: spending the account's allowance leaves a fresh IP's customer allowance alone.
    exhaust(l.staffUpload, `staff:${ID}`);
    const refused = await staffServer(await multipartReq("http://localhost/api/team/upload"));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ ok: false, error: "rate_limited" });
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(l.upload.check("1.2.3.4").ok).toBe(true);
  });

  it("the commit has its own per-account allowance, apart from the start's", async () => {
    await makeStaff();
    const l = limiters();
    exhaust(l.staffCommit, `staff:${ID}`);
    const res = await staffCommit(jsonReq("http://localhost/api/team/upload/direct/commit", { uploadId: "abcDEF_123-xyz" }));
    expect(res.status).toBe(429);
    // the start (direct or server answer) is unaffected
    expect((await staffStart(jsonReq("http://localhost/api/team/upload/direct", { size: 1000 }))).status).toBe(200);
  });

  it("the customer start still answers per IP only (no staff cookie needed)", async () => {
    const res = await customerStart(jsonReq("http://localhost/api/upload/direct", { size: 1000 }));
    expect(res.status).toBe(200);
  });
});
