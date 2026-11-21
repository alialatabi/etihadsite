import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseStorage } from "@/lib/storage/supabase";
import type { AiGenerationRecord } from "@/lib/types";

const BASE = "https://proj.supabase.co";
const KEY = "test-secret-key-not-real";

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };

let calls: Call[];
let queue: Response[];

const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });
const empty = (status = 200) => new Response(status === 204 ? null : "", { status });

beforeEach(() => {
  calls = [];
  queue = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: Call["init"]) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error(`unexpected fetch ${url}`);
      return next;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const store = () => new SupabaseStorage(`${BASE}/`, KEY);
const body = (c: Call) => JSON.parse(c.init.body as string) as unknown;

function expectAuth(c: Call) {
  expect(c.init.headers.apikey).toBe(KEY);
  expect(c.init.headers.Authorization).toBe(`Bearer ${KEY}`);
  expect(c.init.cache).toBe("no-store");
}

const GEN: AiGenerationRecord = {
  id: "gen_abcdefgh",
  createdAt: "2026-11-21T09:30:00.000Z",
  day: "2026-11-21",
  ip: "185.23.4.5",
  ipKey: "a1b2c3",
  shape: "rect",
  corners: "sharp",
  widthUm: 60_000,
  heightUm: 40_000,
  idea: "قهوة",
  lines: ["كافيه", "بغداد"],
  hasRefs: true,
  model: "gpt-image",
  uploadId: "up_abcdefgh",
  orderId: null,
};

const GEN_ROW = {
  id: GEN.id,
  created_at: "2026-11-21T09:30:00+00:00",
  day: GEN.day,
  ip: GEN.ip,
  ip_key: GEN.ipKey,
  shape: GEN.shape,
  corners: GEN.corners,
  width_um: GEN.widthUm,
  height_um: GEN.heightUm,
  idea: GEN.idea,
  lines: GEN.lines,
  has_refs: GEN.hasRefs,
  model: GEN.model,
  upload_id: GEN.uploadId,
  order_id: null,
};

describe("SupabaseStorage AI usage", () => {
  it("aiReserve calls rpc/reserve_ai with the args and returns its { status, used }", async () => {
    queue.push(json({ status: "ip_limit", used: 5 }));
    const out = await store().aiReserve({ day: "2026-11-21", ipKey: "a1b2", ip: "1.2.3.4", kind: "image", perIpLimit: 5, siteLimit: 300 });
    expect(out).toEqual({ status: "ip_limit", used: 5 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/rest/v1/rpc/reserve_ai`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["content-type"]).toBe("application/json");
    expectAuth(calls[0]);
    expect(body(calls[0])).toEqual({ p_day: "2026-11-21", p_ip_key: "a1b2", p_ip: "1.2.3.4", p_kind: "image", p_per_ip: 5, p_site: 300 });
  });

  it("aiReserve throws on an unexpected answer (outage policy: never silently allow)", async () => {
    queue.push(json({ status: "maybe", used: 1 }));
    await expect(store().aiReserve({ day: "2026-11-21", ipKey: "", ip: "", kind: "brief", perIpLimit: 20, siteLimit: 1500 })).rejects.toThrow(/reserve_ai/);
    queue.push(json(null));
    await expect(store().aiReserve({ day: "2026-11-21", ipKey: "", ip: "", kind: "brief", perIpLimit: 20, siteLimit: 1500 })).rejects.toThrow(/reserve_ai/);
  });

  it("aiRelease calls rpc/release_ai", async () => {
    queue.push(empty(204));
    await store().aiRelease({ day: "2026-11-21", ipKey: "a1b2", kind: "image" });
    expect(calls[0].url).toBe(`${BASE}/rest/v1/rpc/release_ai`);
    expect(calls[0].init.method).toBe("POST");
    expect(body(calls[0])).toEqual({ p_day: "2026-11-21", p_ip_key: "a1b2", p_kind: "image" });
  });

  it("aiUsage selects rows since the day, paged, and maps them", async () => {
    queue.push(json([{ day: "2026-11-21", ip_key: "a1", ip: "1.2.3.4", kind: "image", count: 3, last_at: "2026-11-21T10:42:00+00:00" }]));
    const rows = await store().aiUsage("2026-11-01");
    expect(rows).toEqual([{ day: "2026-11-21", ipKey: "a1", ip: "1.2.3.4", kind: "image", count: 3, lastAt: "2026-11-21T10:42:00+00:00" }]);
    expect(calls[0].url).toBe(`${BASE}/rest/v1/ai_usage?select=day,ip_key,ip,kind,count,last_at&day=gte.2026-11-01&order=day.asc,ip_key.asc,kind.asc`);
    expect(calls[0].init.headers.Range).toBe("0-999");
    await expect(store().aiUsage("bad")).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});

describe("SupabaseStorage AI generations and blocks", () => {
  it("aiRecordGeneration POSTs the row", async () => {
    queue.push(empty(201));
    await store().aiRecordGeneration(GEN);
    expect(calls[0].url).toBe(`${BASE}/rest/v1/ai_generations`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Prefer).toBe("return=minimal");
    expect(body(calls[0])).toEqual({ ...GEN_ROW, created_at: GEN.createdAt });
  });

  it("aiListGenerations uses Range and count=exact", async () => {
    queue.push(json([GEN_ROW], 206, { "Content-Range": "48-48/49" }));
    const out = await store().aiListGenerations({ limit: 48, offset: 48 });
    expect(out).toEqual({ rows: [{ ...GEN, createdAt: GEN_ROW.created_at }], total: 49 });
    expect(calls[0].url).toBe(`${BASE}/rest/v1/ai_generations?select=*&order=created_at.desc,id.desc`);
    expect(calls[0].init.headers.Range).toBe("48-95");
    expect(calls[0].init.headers["Range-Unit"]).toBe("items");
    expect(calls[0].init.headers.Prefer).toBe("count=exact");
    expectAuth(calls[0]);
  });

  it("aiListGenerations filters by ipKey (encoded) and survives a page past the end", async () => {
    queue.push(json([], 200, { "Content-Range": "*/0" }));
    expect(await store().aiListGenerations({ limit: 10, offset: 0, ipKey: "a b&c" })).toEqual({ rows: [], total: 0 });
    expect(calls[0].url).toBe(`${BASE}/rest/v1/ai_generations?select=*&order=created_at.desc,id.desc&ip_key=eq.a%20b%26c`);
    queue.push(json({ code: "PGRST103", message: "Requested range not satisfiable" }, 416, { "Content-Range": "*/7" }));
    expect(await store().aiListGenerations({ limit: 10, offset: 50 })).toEqual({ rows: [], total: 7 });
  });

  it("aiMarkOrdered PATCHes ai_generations?upload_id=eq.<id>", async () => {
    queue.push(empty(204));
    await store().aiMarkOrdered("up_abcdefgh", "ORDER_abcdefgh");
    expect(calls[0].url).toBe(`${BASE}/rest/v1/ai_generations?upload_id=eq.up_abcdefgh`);
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].init.headers.Prefer).toBe("return=minimal");
    expect(body(calls[0])).toEqual({ order_id: "ORDER_abcdefgh" });
    // Invalid ids never reach the network.
    await store().aiMarkOrdered("../x", "ORDER_abcdefgh");
    await store().aiMarkOrdered("up_abcdefgh", "bad id!");
    expect(calls).toHaveLength(1);
  });

  it("aiBlock / aiUnblock / aiListBlocks", async () => {
    queue.push(empty(201), empty(204), json([{ ip_key: "a1", ip: "1.2.3.4", created_at: "2026-11-21T10:00:00+00:00" }]));
    const s = store();
    await s.aiBlock("a1", "1.2.3.4");
    await s.aiUnblock("a1");
    expect(await s.aiListBlocks()).toEqual([{ ipKey: "a1", ip: "1.2.3.4", createdAt: "2026-11-21T10:00:00+00:00" }]);
    expect(calls[0].url).toBe(`${BASE}/rest/v1/ai_blocks?on_conflict=ip_key`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Prefer).toBe("resolution=ignore-duplicates,return=minimal");
    expect(body(calls[0])).toEqual({ ip_key: "a1", ip: "1.2.3.4" });
    expect(calls[1].url).toBe(`${BASE}/rest/v1/ai_blocks?ip_key=eq.a1`);
    expect(calls[1].init.method).toBe("DELETE");
    expect(calls[2].url).toBe(`${BASE}/rest/v1/ai_blocks?select=ip_key,ip,created_at&order=created_at.desc`);
  });
});
