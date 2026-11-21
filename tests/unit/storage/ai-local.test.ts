import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStorage } from "@/lib/storage/local";
import type { AiGenerationRecord, AiUsageRow } from "@/lib/types";

const tmp = () => mkdtempSync(path.join(tmpdir(), "ep-ai-"));
const DAY = "2026-11-21";

const reserve = (s: LocalStorage, ipKey: string, over: Partial<Parameters<NonNullable<LocalStorage["aiReserve"]>>[0]> = {}) =>
  s.aiReserve({ day: DAY, ipKey, ip: ipKey ? `10.0.0.${ipKey.length}` : "", kind: "image", perIpLimit: 5, siteLimit: 300, ...over });

function gen(id: string, createdAt: string, ipKey = "k1"): AiGenerationRecord {
  return {
    id,
    createdAt,
    day: createdAt.slice(0, 10),
    ip: "185.23.4.5",
    ipKey,
    shape: "circle",
    corners: "rounded",
    widthUm: 50_000,
    heightUm: 50_000,
    idea: "قطة",
    lines: ["مطبعة"],
    hasRefs: false,
    model: "gpt-image",
    uploadId: `up_${id}_xxxxx`,
    orderId: null,
  };
}

describe("LocalStorage AI usage", () => {
  it("reserve allows 5 then ip_limit", async () => {
    const s = new LocalStorage(tmp());
    for (let i = 1; i <= 5; i++) expect(await reserve(s, "k1")).toEqual({ status: "ok", used: i });
    expect(await reserve(s, "k1")).toEqual({ status: "ip_limit", used: 5 });
    const rows = JSON.parse(readFileSync(path.join(s.root, "ai", "usage.json"), "utf8")) as AiUsageRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: DAY, ipKey: "k1", ip: "10.0.0.2", kind: "image", count: 5 });
    expect(typeof rows[0].lastAt).toBe("string");
  });

  it("site cap 300 → site_limit for a new ip", async () => {
    const root = tmp();
    // 300 used today, spread over 60 IPs (seeded: 300 real writes would be slow on Windows).
    const seeded: AiUsageRow[] = Array.from({ length: 60 }, (_, i) => ({
      day: DAY, ipKey: `ip${i}`, ip: `1.1.1.${i}`, kind: "image", count: 5, lastAt: "2026-11-21T08:00:00.000Z",
    }));
    mkdirSync(path.join(root, "ai"), { recursive: true });
    writeFileSync(path.join(root, "ai", "usage.json"), JSON.stringify(seeded));
    const s = new LocalStorage(root);
    expect(await reserve(s, "fresh")).toEqual({ status: "site_limit", used: 0 });
    // Another day and another kind are not affected.
    expect(await reserve(s, "fresh", { day: "2026-11-22" })).toEqual({ status: "ok", used: 1 });
    expect(await reserve(s, "fresh", { kind: "brief" })).toEqual({ status: "ok", used: 1 });
  });

  it("site cap counts through real reservations too", async () => {
    const s = new LocalStorage(tmp());
    expect(await reserve(s, "a", { siteLimit: 2 })).toEqual({ status: "ok", used: 1 });
    expect(await reserve(s, "b", { siteLimit: 2 })).toEqual({ status: "ok", used: 1 });
    expect(await reserve(s, "c", { siteLimit: 2 })).toEqual({ status: "site_limit", used: 0 });
  });

  it("blocked ip → blocked", async () => {
    const s = new LocalStorage(tmp());
    await s.aiBlock("bad", "6.6.6.6");
    expect(await reserve(s, "bad")).toEqual({ status: "blocked", used: 0 });
    expect(await s.aiUsage(DAY)).toEqual([]);
  });

  it("release frees one slot and never goes below zero", async () => {
    const s = new LocalStorage(tmp());
    for (let i = 0; i < 5; i++) await reserve(s, "k1");
    expect((await reserve(s, "k1")).status).toBe("ip_limit");
    await s.aiRelease({ day: DAY, ipKey: "k1", kind: "image" });
    expect(await reserve(s, "k1")).toEqual({ status: "ok", used: 5 });
    await s.aiRelease({ day: DAY, ipKey: "nobody", kind: "image" });
    const s2 = new LocalStorage(tmp());
    await reserve(s2, "z");
    await s2.aiRelease({ day: DAY, ipKey: "z", kind: "image" });
    await s2.aiRelease({ day: DAY, ipKey: "z", kind: "image" });
    expect((await s2.aiUsage(DAY))[0].count).toBe(0);
  });

  it("empty ipKey skips per-ip check (site cap still applies)", async () => {
    const s = new LocalStorage(tmp());
    for (let i = 1; i <= 7; i++) expect(await reserve(s, "", { perIpLimit: 5, siteLimit: 8 })).toEqual({ status: "ok", used: i });
    expect(await reserve(s, "", { perIpLimit: 5, siteLimit: 8 })).toEqual({ status: "ok", used: 8 });
    expect(await reserve(s, "", { perIpLimit: 5, siteLimit: 8 })).toEqual({ status: "site_limit", used: 8 });
  });

  it("kinds count separately", async () => {
    const s = new LocalStorage(tmp());
    for (let i = 0; i < 5; i++) await reserve(s, "k1");
    expect((await reserve(s, "k1")).status).toBe("ip_limit");
    expect(await reserve(s, "k1", { kind: "brief", perIpLimit: 20 })).toEqual({ status: "ok", used: 1 });
    const usage = await s.aiUsage(DAY);
    expect(usage.map((u) => [u.kind, u.count])).toEqual([["brief", 1], ["image", 5]]);
  });

  it("concurrent reservations never over-admit", async () => {
    const s = new LocalStorage(tmp());
    const out = await Promise.all(Array.from({ length: 8 }, () => reserve(s, "k1")));
    expect(out.filter((r) => r.status === "ok")).toHaveLength(5);
    expect(out.filter((r) => r.status === "ip_limit")).toHaveLength(3);
  });

  it("aiUsage returns rows from sinceDay on", async () => {
    const s = new LocalStorage(tmp());
    await reserve(s, "k1", { day: "2026-11-19" });
    await reserve(s, "k1", { day: "2026-11-20" });
    await reserve(s, "k2", { day: "2026-11-20" });
    const rows = await s.aiUsage("2026-11-20");
    expect(rows.map((r) => [r.day, r.ipKey, r.count])).toEqual([["2026-11-20", "k1", 1], ["2026-11-20", "k2", 1]]);
  });
});

describe("LocalStorage AI generations and blocks", () => {
  it("list generations newest first with total and ipKey filter", async () => {
    const s = new LocalStorage(tmp());
    expect(await s.aiListGenerations({ limit: 10, offset: 0 })).toEqual({ rows: [], total: 0 });
    await s.aiRecordGeneration(gen("g1", "2026-11-20T10:00:00.000Z", "k1"));
    await s.aiRecordGeneration(gen("g3", "2026-11-21T12:00:00.000Z", "k2"));
    await s.aiRecordGeneration(gen("g2", "2026-11-21T09:00:00.000Z", "k1"));
    const all = await s.aiListGenerations({ limit: 2, offset: 0 });
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => r.id)).toEqual(["g3", "g2"]);
    expect((await s.aiListGenerations({ limit: 2, offset: 2 })).rows.map((r) => r.id)).toEqual(["g1"]);
    const k1 = await s.aiListGenerations({ limit: 10, offset: 0, ipKey: "k1" });
    expect(k1).toEqual({ rows: [gen("g2", "2026-11-21T09:00:00.000Z", "k1"), gen("g1", "2026-11-20T10:00:00.000Z", "k1")], total: 2 });
  });

  it("markOrdered sets orderId by uploadId", async () => {
    const s = new LocalStorage(tmp());
    await s.aiRecordGeneration(gen("g1", "2026-11-20T10:00:00.000Z"));
    await s.aiRecordGeneration(gen("g2", "2026-11-21T10:00:00.000Z"));
    await s.aiMarkOrdered("up_g1_xxxxx", "ORDER_abcdefgh");
    await s.aiMarkOrdered("up_unknown_xx", "ORDER_zzzzzzzz"); // no match: silent no-op
    const { rows } = await s.aiListGenerations({ limit: 10, offset: 0 });
    expect(rows.map((r) => [r.id, r.orderId])).toEqual([["g2", null], ["g1", "ORDER_abcdefgh"]]);
  });

  it("block/unblock/listBlocks", async () => {
    const s = new LocalStorage(tmp());
    expect(await s.aiListBlocks()).toEqual([]);
    await s.aiBlock("k1", "1.2.3.4");
    await s.aiBlock("k2", "5.6.7.8");
    await s.aiBlock("k1", "1.2.3.4"); // already blocked: kept once
    const blocks = await s.aiListBlocks();
    expect(blocks.map((b) => [b.ipKey, b.ip]).sort()).toEqual([["k1", "1.2.3.4"], ["k2", "5.6.7.8"]]);
    expect(blocks.every((b) => !Number.isNaN(Date.parse(b.createdAt)))).toBe(true);
    await s.aiUnblock("k1");
    expect((await s.aiListBlocks()).map((b) => b.ipKey)).toEqual(["k2"]);
    expect((await reserve(s, "k1")).status).toBe("ok");
    expect((await reserve(s, "k2")).status).toBe("blocked");
  });

  it("an unreadable AI file is never overwritten", async () => {
    const root = tmp();
    mkdirSync(path.join(root, "ai"), { recursive: true });
    writeFileSync(path.join(root, "ai", "generations.json"), "{not json");
    const s = new LocalStorage(root);
    await expect(s.aiRecordGeneration(gen("g1", "2026-11-20T10:00:00.000Z"))).rejects.toThrow(/unreadable/);
    expect(readFileSync(path.join(root, "ai", "generations.json"), "utf8")).toBe("{not json");
  });
});
