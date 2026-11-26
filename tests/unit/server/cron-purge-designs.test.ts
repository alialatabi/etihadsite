/**
 * GET /api/cron/purge: the 7-day rule for designs no order used (owner 2026-11-26): aiPurgeUnordered, then
 * purgeUnusedUploads, both with cutoff now − UNORDERED_DESIGN_DAYS; `?dry=1` covers both.
 */
import { utimesSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/purge/route";
import { UNORDERED_DESIGN_DAYS } from "@/config/defaults";
import { LocalStorage } from "@/lib/storage/local";
import type { AiGenerationRecord } from "@/lib/types";
import { setupEnv } from "./helpers";

const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/monitoring/report", () => ({ reportError }));

const SECRET = "cron-secret-for-tests-0123456789";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const call = (query = "") =>
  GET(new Request(`http://localhost/api/cron/purge${query}`, { headers: { authorization: `Bearer ${SECRET}` } }));
const meta = { mime: "image/png", originalName: "a.png", bytes: 1, createdAt: "2026-01-01T00:00:00.000Z" };

function gen(id: string, uploadId: string, createdAt: Date, orderId: string | null = null): AiGenerationRecord {
  return {
    id, createdAt: createdAt.toISOString(), day: createdAt.toISOString().slice(0, 10), ip: "1.2.3.4", ipKey: "k1", shape: "rect", corners: "sharp",
    widthUm: 60_000, heightUm: 40_000, idea: "قهوة", lines: [], hasRefs: false, model: "m", uploadId, orderId,
  };
}

let dir: string;
let s: LocalStorage;
async function setup() {
  dir = setupEnv({ CRON_SECRET: SECRET });
  const { getStorage } = await import("@/lib/storage");
  s = getStorage() as LocalStorage;
}
async function upload(id: string, when: Date) {
  await s.saveUpload(id, new Uint8Array([1]), meta);
  for (const ext of ["bin", "json"]) utimesSync(path.join(dir, "uploads", `${id}.${ext}`), when, when);
}
async function addGen(g: AiGenerationRecord) {
  await upload(g.uploadId, new Date(g.createdAt));
  await s.aiRecordGeneration(g);
}
const ids = async () => (await s.aiListGenerations({ limit: 50, offset: 0 })).rows.map((r) => r.id).sort();

describe("cron purge: 7-day rule", () => {
  beforeEach(async () => {
    reportError.mockReset();
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await setup();
    await addGen(gen("gen-old-00001", "up-old-00001", ago(10)));
    await addGen(gen("gen-ordered-01", "up-ordered-01", ago(12), "order-0001-aaaa"));
    await addGen(gen("gen-fresh-001", "up-fresh-0001", ago(2)));
    await upload("up-plain-0001", ago(9)); // a plain upload nobody used
  });

  it("dry run counts what would go and changes nothing", async () => {
    const body = await (await call("?dry=1")).json();
    expect(body).toMatchObject({ ok: true, dryRun: true, removedDesigns: 1, removedUploads: 2 });
    expect(await ids()).toEqual(["gen-fresh-001", "gen-old-00001", "gen-ordered-01"]);
    expect(await s.readFile("uploads/up-old-00001.bin")).not.toBeNull();
    expect(await s.readFile("uploads/up-plain-0001.bin")).not.toBeNull();
  });

  it("removes designs no order used (files + row) and plain unused uploads; keeps ordered and fresh ones", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, dryRun: false, removedDesigns: 1, removedUploads: 2 });
    expect(await ids()).toEqual(["gen-fresh-001", "gen-ordered-01"]);
    expect(await s.readFile("uploads/up-old-00001.bin")).toBeNull();
    expect(await s.readFile("uploads/up-plain-0001.json")).toBeNull();
    expect(await s.readFile("uploads/up-ordered-01.bin")).not.toBeNull();
    expect(await s.readFile("uploads/up-fresh-0001.bin")).not.toBeNull();
    // Nothing left for the next day.
    // Nothing to report: the response is exactly what it was before the 7-day rule (the golden test pins that).
    const again = await (await call()).json();
    expect(again).not.toHaveProperty("removedDesigns");
    expect(again).not.toHaveProperty("removedUploads");
    expect(again).toMatchObject({ ok: true, removed: 0 });
  });

  it("runs aiPurgeUnordered first, then purgeUnusedUploads, both with now − 7 days", async () => {
    const order: string[] = [];
    const cutoffs: number[] = [];
    const a = vi.spyOn(LocalStorage.prototype, "aiPurgeUnordered").mockImplementation(async (c) => {
      order.push("designs");
      cutoffs.push(c.getTime());
      return [];
    });
    const b = vi.spyOn(LocalStorage.prototype, "purgeUnusedUploads").mockImplementation(async (c, dry) => {
      order.push(`uploads:${dry}`);
      cutoffs.push(c.getTime());
      return [];
    });
    const before = Date.now();
    await call("?dry=1");
    expect(order).toEqual(["designs", "uploads:true"]);
    for (const c of cutoffs) {
      expect(c).toBeGreaterThanOrEqual(before - UNORDERED_DESIGN_DAYS * DAY);
      expect(c).toBeLessThanOrEqual(Date.now() - UNORDERED_DESIGN_DAYS * DAY);
    }
    a.mockRestore();
    b.mockRestore();
  });

  it("a failure of the design purge is a 500, goes through reportError, and the unused-upload step does not run", async () => {
    vi.spyOn(LocalStorage.prototype, "aiPurgeUnordered").mockRejectedValue(new Error("orders unreadable"));
    const next = vi.spyOn(LocalStorage.prototype, "purgeUnusedUploads");
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][1]).toMatchObject({ where: "cron.purge" });
    expect(next).not.toHaveBeenCalled();
  });

  it("an adapter without the new methods still purges (optional methods are guarded)", async () => {
    // @ts-expect-error simulate an adapter that has neither method
    vi.spyOn(LocalStorage.prototype, "aiPurgeUnordered", "get").mockReturnValue(undefined);
    // @ts-expect-error simulate an adapter that has neither method
    vi.spyOn(LocalStorage.prototype, "purgeUnusedUploads", "get").mockReturnValue(undefined);
    const body = await (await call("?dry=1")).json();
    expect(body).toMatchObject({ ok: true });
    expect(body).not.toHaveProperty("removedDesigns");
  });
});
