/**
 * SupabaseStorage: gallery filters (the exact PostgREST URLs, hostile text included), aiGetGeneration,
 * aiDeleteGeneration, orderUsingUpload and the 7-day purges (owner 2026-11-26), with a routed fetch mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PURGE_WINDOW_DAYS, UNORDERED_DESIGN_DAYS } from "@/config/defaults";
import { SupabaseStorage } from "@/lib/storage/supabase";

const BASE = "https://proj.supabase.co";
const KEY = "test-secret-key-not-real";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const cutoff = () => ago(UNORDERED_DESIGN_DAYS);

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[];
let route: (c: Call) => Response | undefined;

const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });

beforeEach(() => {
  calls = [];
  route = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit & { headers: Record<string, string> }) => {
      const c: Call = { url, method: init.method ?? "GET", headers: init.headers, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined };
      calls.push(c);
      const r = route(c);
      if (!r) throw new Error(`unexpected fetch ${c.method} ${url}`);
      return r;
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const store = () => new SupabaseStorage(`${BASE}/`, KEY);
const q = (c: Call) => new URL(c.url);
const rest = (c: Call) => c.url.slice(BASE.length);

/** A paged PostgREST answer: honours the Range header, so an until-empty read ends with an empty page. */
function paged(rows: unknown[], c: Call): Response {
  const m = /^(\d+)-(\d+)$/.exec(c.headers.Range ?? "");
  const from = m ? Number(m[1]) : 0;
  return json(rows.slice(from, from + 1000));
}

/* ───────────────────────── filter URLs ───────────────────────── */

describe("aiListGenerations filters (exact URLs)", () => {
  const page = () => {
    route = () => json([], 200, { "content-range": "*/0" });
  };
  const list = async (f: Record<string, unknown>) => {
    page();
    calls = [];
    await store().aiListGenerations({ limit: 10, offset: 0, ...f } as never);
    return calls;
  };

  it("no filter and the ipKey filter keep their existing URL", async () => {
    expect(rest((await list({}))[0])).toBe("/rest/v1/ai_generations?select=*&order=created_at.desc,id.desc");
    expect(rest((await list({ ipKey: "a1b2c3" }))[0])).toBe("/rest/v1/ai_generations?select=*&order=created_at.desc,id.desc&ip_key=eq.a1b2c3");
  });

  it("ordered, maker, shape and date filters", async () => {
    expect(rest((await list({ ordered: true }))[0])).toBe("/rest/v1/ai_generations?select=*&order=created_at.desc,id.desc&order_id=not.is.null");
    expect(rest((await list({ ordered: false }))[0])).toContain("&order_id=is.null");
    expect(rest((await list({ maker: "customer" }))[0])).toContain("&staff_id=is.null");
    expect(rest((await list({ maker: "staff" }))[0])).toContain("&staff_id=not.is.null");
    expect(rest((await list({ maker: { staffId: "staff-0001-aaaa" } }))[0])).toContain("&staff_id=eq.staff-0001-aaaa");
    expect(rest((await list({ shape: "rect" }))[0])).toContain("&shape=eq.rect");
    // Re-serialised, so a `+03:00` offset can never turn into a space.
    const dated = rest((await list({ since: "2026-11-01T00:00:00+03:00", until: "2026-11-30T00:00:00Z" }))[0]);
    expect(dated).toContain("&created_at=gte.2026-10-31T21%3A00%3A00.000Z");
    expect(dated).toContain("&created_at=lt.2026-11-30T00%3A00%3A00.000Z");
  });

  it("invalid values send NO request and answer an empty page", async () => {
    for (const f of [
      { maker: { staffId: "x" } },
      { maker: { staffId: 'abc"def,ghijkl' } },
      { maker: "everyone" },
      { shape: "tri;angle" },
      { shape: "rect&x=1" },
      { since: "yesterday" },
      { until: "2026-13-45" },
      { ordered: "yes" },
      { search: { text: "", orderIds: [] } },
      { search: { text: "   ", orderIds: ["short", 'bad"id,xx'] } },
    ]) {
      calls = [];
      route = () => {
        throw new Error("no request expected");
      };
      await expect(store().aiListGenerations({ limit: 10, offset: 0, ...f } as never)).resolves.toEqual({ rows: [], total: 0 });
      expect(calls).toHaveLength(0);
    }
  });

  it("a search is ONE or=() parameter: values double-quoted, the whole value percent-encoded", async () => {
    const c = (await list({ search: { text: "قهوة", orderIds: ["order-0001-aaaa", "order-0002-bbbb"] } }))[0];
    const params = q(c).searchParams;
    expect(params.getAll("or")).toEqual([
      '(idea.ilike."*قهوة*",instructions.ilike."*قهوة*",order_id.in.("order-0001-aaaa","order-0002-bbbb"))',
    ]);
    // On the wire nothing but the encoded value follows `or=`.
    expect(rest(c)).toContain(`&or=${encodeURIComponent('(idea.ilike."*قهوة*",instructions.ilike."*قهوة*",order_id.in.("order-0001-aaaa","order-0002-bbbb"))')}`);
  });

  it("text only / ids only never produce an empty clause", async () => {
    expect(q((await list({ search: { text: "abc", orderIds: [] } }))[0]).searchParams.get("or")).toBe('(idea.ilike."*abc*",instructions.ilike."*abc*")');
    expect(q((await list({ search: { text: "", orderIds: ["order-0001-aaaa"] } }))[0]).searchParams.get("or")).toBe('(order_id.in.("order-0001-aaaa"))');
    for (const call of [...(await list({ search: { text: "abc", orderIds: [] } })), ...(await list({ search: { text: "", orderIds: ["order-0001-aaaa"] } }))]) {
      expect(decodeURIComponent(call.url)).not.toContain("in.()");
    }
  });

  it("hostile text cannot leave its quoted pattern or add parameters", async () => {
    const hostile = 'a,b(c)d"e\\f*g%h_i:j.k&l#m+n=o)),id.neq.0,(x';
    const c = (await list({ search: { text: hostile, orderIds: [] } }))[0];
    const u = q(c);
    // \ " * % become the one-character wildcard `_`: no escape, quote or wildcard of the pattern can be forged.
    const pat = '*a,b(c)d_e_f_g_h_i:j.k&l#m+n=o)),id.neq.0,(x*';
    expect(u.searchParams.getAll("or")).toEqual([`(idea.ilike."${pat}",instructions.ilike."${pat}")`]);
    // The only parameters are the fixed ones plus `or`: `&l#m+n=o` stayed inside the encoded value.
    expect([...u.searchParams.keys()].sort()).toEqual(["or", "order", "select"]);
    expect(u.hash).toBe("");
    // No raw reserved character of the text is on the wire.
    const wire = rest(c).split("&or=")[1];
    expect(wire).not.toMatch(/[&#+=,"\\ ]/);
  });

  it("each of , ( ) \" \\ * % _ : . & # + = and spaces stays inside the quoted pattern", async () => {
    for (const ch of [",", "(", ")", '"', "\\", "*", "%", "_", ":", ".", "&", "#", "+", "=", " ", "'", "\n"]) {
      const c = (await list({ search: { text: `x${ch}y`, orderIds: [] } }))[0];
      const u = q(c);
      const or = u.searchParams.getAll("or");
      expect(or).toHaveLength(1);
      expect(or[0]).toMatch(/^\(idea\.ilike\."\*x[\s\S]y\*",instructions\.ilike\."\*x[\s\S]y\*"\)$/);
      expect([...u.searchParams.keys()].sort()).toEqual(["or", "order", "select"]);
    }
  });

  it("text is cut to 100 characters; order ids are ID_RE only, unique and capped at 200", async () => {
    const long = "ب".repeat(150);
    const t = q((await list({ search: { text: long, orderIds: [] } }))[0]).searchParams.get("or") ?? "";
    expect(t).toBe(`(idea.ilike."*${"ب".repeat(100)}*",instructions.ilike."*${"ب".repeat(100)}*")`);
    const ids = Array.from({ length: 230 }, (_, i) => `order-${String(i).padStart(6, "0")}`);
    const many = q((await list({ search: { text: "", orderIds: ["bad id", 'q"uote-12345', ...ids, ids[0]] } }))[0]).searchParams.get("or") ?? "";
    const inList = /order_id\.in\.\((.*)\)\)$/.exec(many)?.[1].split(",") ?? [];
    expect(inList).toHaveLength(200);
    expect(inList[0]).toBe('"order-000000"');
    expect(many).not.toContain("bad id");
    expect(many).not.toContain("q\\");
  });

  it("filters combine; the count request (limit 0) carries them too", async () => {
    const c = (await list({ limit: 0, ordered: false, maker: "staff", shape: "custom" }))[0];
    expect(rest(c)).toBe("/rest/v1/ai_generations?select=id&limit=0&order_id=is.null&staff_id=not.is.null&shape=eq.custom");
    expect(c.headers.Prefer).toBe("count=exact");
  });
});

/* ───────────────────────── get / delete / orderUsingUpload ───────────────────────── */

describe("aiGetGeneration / aiDeleteGeneration / orderUsingUpload", () => {
  const ROW = {
    id: "gen_abcdefgh", created_at: "2026-11-21T09:30:00+00:00", day: "2026-11-21", ip: "1.2.3.4", ip_key: "k", shape: "rect", corners: "sharp",
    width_um: 60000, height_um: 40000, idea: "قهوة", lines: [], has_refs: false, model: "m", upload_id: "up_abcdefgh", order_id: null,
  };

  it("aiGetGeneration: one row by upload id; invalid id = null without a request; errors throw", async () => {
    route = () => json([ROW]);
    expect((await store().aiGetGeneration("up_abcdefgh"))?.id).toBe("gen_abcdefgh");
    expect(rest(calls[0])).toBe("/rest/v1/ai_generations?select=*&upload_id=eq.up_abcdefgh&limit=1");
    calls = [];
    expect(await store().aiGetGeneration('x"/../y')).toBeNull();
    expect(calls).toHaveLength(0);
    route = () => new Response("boom", { status: 500 });
    await expect(store().aiGetGeneration("up_abcdefgh")).rejects.toThrow(/500/);
    route = () => json([]);
    expect(await store().aiGetGeneration("up_abcdefgh")).toBeNull();
  });

  it("aiDeleteGeneration: DELETE ?id=eq.<id> with return=representation, nothing else", async () => {
    route = () => json([ROW]);
    expect((await store().aiDeleteGeneration("gen_abcdefgh"))?.uploadId).toBe("up_abcdefgh");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("DELETE");
    expect(rest(calls[0])).toBe("/rest/v1/ai_generations?id=eq.gen_abcdefgh");
    expect(calls[0].headers.Prefer).toBe("return=representation");
    route = () => json([]);
    expect(await store().aiDeleteGeneration("gen_abcdefgh")).toBeNull();
  });

  it("aiDeleteGeneration: an invalid or empty id NEVER produces a DELETE", async () => {
    route = () => {
      throw new Error("no request expected");
    };
    for (const bad of ["", " ", "short", "a=b&id=neq.x00", "gen_abcdefgh,gen_abcdefgh", "gen_abcdefgh)", "../../etc/passwd", "x".repeat(65), undefined as never, null as never, 12345678 as never]) {
      expect(await store().aiDeleteGeneration(bad)).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });

  it("orderUsingUpload: designPath first, then designPaths (jsonb containment); both URLs encoded like purgeOlderThan", async () => {
    route = (c) => (c.url.includes("designPath=eq.") ? json([]) : json([{ order_id: "order-0002-bbbb" }]));
    expect(await store().orderUsingUpload("up_abcdefgh")).toBe("order-0002-bbbb");
    expect(calls.map(rest)).toEqual([
      "/rest/v1/orders?select=order_id&record->files->>designPath=eq.uploads%2Fup_abcdefgh.bin&order=created_at.asc,order_id.asc&limit=1",
      `/rest/v1/orders?select=order_id&record->files->designPaths=cs.${encodeURIComponent('["uploads/up_abcdefgh.bin"]')}&order=created_at.asc,order_id.asc&limit=1`,
    ]);
    // No created_at bound anywhere.
    expect(calls.some((c) => c.url.includes("created_at=gte") || c.url.includes("created_at=lt"))).toBe(false);
  });

  it("orderUsingUpload: stops at the first hit; null when none; invalid id = null without a request; errors throw", async () => {
    route = () => json([{ order_id: "order-0001-aaaa" }]);
    expect(await store().orderUsingUpload("up_abcdefgh")).toBe("order-0001-aaaa");
    expect(calls).toHaveLength(1);
    route = () => json([]);
    expect(await store().orderUsingUpload("up_abcdefgh")).toBeNull();
    calls = [];
    expect(await store().orderUsingUpload("bad id")).toBeNull();
    expect(calls).toHaveLength(0);
    route = () => new Response("down", { status: 503 });
    await expect(store().orderUsingUpload("up_abcdefgh")).rejects.toThrow(/503/);
    route = (c) => (c.url.includes("designPath=eq.") ? json([]) : new Response("down", { status: 503 }));
    await expect(store().orderUsingUpload("up_abcdefgh")).rejects.toThrow(/503/);
  });
});

/* ───────────────────────── aiPurgeUnordered ───────────────────────── */

describe("aiPurgeUnordered", () => {
  const genRow = (id: string, uploadId: string, createdAt: Date, orderId: string | null = null) => ({
    id, upload_id: uploadId, created_at: createdAt.toISOString(), order_id: orderId,
  });
  type Order = { order_id: string; created_at: string; files: { designPath: string; designPaths?: string[]; pdfPath: string } | null };
  const ord = (id: string, createdAt: Date, designPath: string, designPaths?: string[]): Order => ({
    order_id: id, created_at: createdAt.toISOString(), files: { designPath, ...(designPaths ? { designPaths } : {}), pdfPath: `orders/${id}.pdf` },
  });

  /** Routes the purge's requests; `deleted` collects what the server was asked to remove. */
  function serve(opts: { gens: unknown[]; orders?: Order[]; failStorageDelete?: boolean; failOrders?: boolean }) {
    route = (c) => {
      const u = c.url;
      if (c.method === "GET" && u.includes("/rest/v1/ai_generations?select=id,upload_id,created_at,order_id")) return paged(opts.gens, c);
      if (c.method === "GET" && u.includes("/rest/v1/orders?select=order_id,created_at,files:record->files")) {
        if (opts.failOrders) return new Response("down", { status: 503 });
        return paged(opts.orders ?? [], c);
      }
      if (c.method === "PATCH" && u.includes("/rest/v1/ai_generations?upload_id=eq.")) return new Response(null, { status: 204 });
      if (c.method === "DELETE" && u.includes("/storage/v1/object/etihad")) {
        return opts.failStorageDelete ? new Response("nope", { status: 500 }) : json([]);
      }
      if (c.method === "DELETE" && u.includes("/rest/v1/ai_generations?")) {
        const ids = /id=in\.\(([^)]*)\)/.exec(u)?.[1].split(",") ?? [];
        return json(ids.map((id) => ({ id })));
      }
      return undefined;
    };
  }
  const methods = () => calls.map((c) => c.method);

  it("guards the cutoff before any request", async () => {
    route = () => {
      throw new Error("no request expected");
    };
    for (const bad of [new Date("x"), ago(0), ago(6), new Date(Date.now() + DAY)]) await expect(store().aiPurgeUnordered(bad, false)).rejects.toThrow();
    for (const bad of [new Date("x"), ago(0), ago(6)]) await expect(store().purgeUnusedUploads(bad, false)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("reads candidates (order_id null, before the cutoff, NO lower bound), then deletes files first and rows by explicit ids", async () => {
    const oldest = ago(30);
    serve({ gens: [genRow("gen_00000001", "up_00000001", oldest), genRow("gen_00000002", "up_00000002", ago(9))] });
    const c = cutoff();
    const removed = await store().aiPurgeUnordered(c, false);
    expect(removed).toEqual([
      "uploads/up_00000001.bin", "uploads/up_00000001.json", "uploads/up_00000002.bin", "uploads/up_00000002.json",
      "ai_generation:gen_00000001", "ai_generation:gen_00000002",
    ]);
    const cutoffQ = encodeURIComponent(c.toISOString());
    expect(rest(calls[0])).toBe(`/rest/v1/ai_generations?select=id,upload_id,created_at,order_id&order_id=is.null&created_at=lt.${cutoffQ}&order=created_at.asc,id.asc`);
    expect(calls[0].url).not.toContain("created_at=gte");
    // Orders are read (from one day before the oldest candidate) BEFORE any delete.
    const firstDelete = calls.findIndex((x) => x.method === "DELETE");
    const orderReads = calls.map((x, i) => (x.url.includes("/rest/v1/orders?") ? i : -1)).filter((i) => i >= 0);
    expect(orderReads.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...orderReads)).toBeLessThan(firstDelete);
    const oldestMinusDay = encodeURIComponent(new Date(oldest.getTime() - DAY).toISOString());
    expect(rest(calls[orderReads[0]])).toContain(`&created_at=gte.${oldestMinusDay}&`);
    expect(calls[orderReads[0]].url).not.toContain("created_at=lt");
    // Files (explicit paths) then rows (explicit ids + backstops).
    const del = calls.filter((x) => x.method === "DELETE");
    expect(del[0].url).toBe(`${BASE}/storage/v1/object/etihad`);
    expect(del[0].body).toEqual({ prefixes: ["uploads/up_00000001.bin", "uploads/up_00000001.json", "uploads/up_00000002.bin", "uploads/up_00000002.json"] });
    expect(rest(del[1])).toBe(`/rest/v1/ai_generations?select=id&id=in.(gen_00000001,gen_00000002)&order_id=is.null&created_at=lt.${cutoffQ}`);
    expect(del[1].headers.Prefer).toBe("return=representation");
    expect(del).toHaveLength(2);
  });

  it("dry run: same answer, only reads (no PATCH, no DELETE)", async () => {
    serve({
      gens: [genRow("gen_00000001", "up_00000001", ago(30)), genRow("gen_00000002", "up_00000002", ago(9))],
      orders: [ord("order-0001-aaaa", ago(8), "uploads/up_00000002.bin")],
    });
    const removed = await store().aiPurgeUnordered(cutoff(), true);
    expect(removed).toEqual(["uploads/up_00000001.bin", "uploads/up_00000001.json", "ai_generation:gen_00000001"]);
    expect(methods().every((m) => m === "GET")).toBe(true);
  });

  it("heals a design an order uses (designPath or designPaths) and does not delete it", async () => {
    serve({
      gens: [genRow("gen_00000001", "up_00000001", ago(30)), genRow("gen_00000002", "up_00000002", ago(20)), genRow("gen_00000003", "up_00000003", ago(15))],
      orders: [
        ord("order-0001-aaaa", ago(29), "uploads/up_00000001.bin"),
        // designPath is another upload: the used one is ONLY in designPaths.
        ord("order-0002-bbbb", ago(19), "uploads/up_other_0001.bin", ["uploads/up_other_0001.bin", "uploads/up_00000002.bin"]),
      ],
    });
    const removed = await store().aiPurgeUnordered(cutoff(), false);
    expect(removed).toEqual(["uploads/up_00000003.bin", "uploads/up_00000003.json", "ai_generation:gen_00000003"]);
    const patches = calls.filter((x) => x.method === "PATCH");
    expect(patches.map((p) => [rest(p), p.body])).toEqual([
      ["/rest/v1/ai_generations?upload_id=eq.up_00000001", { order_id: "order-0001-aaaa" }],
      ["/rest/v1/ai_generations?upload_id=eq.up_00000002", { order_id: "order-0002-bbbb" }],
    ]);
    const del = calls.filter((x) => x.method === "DELETE");
    expect(del[0].body).toEqual({ prefixes: ["uploads/up_00000003.bin", "uploads/up_00000003.json"] });
    expect(rest(del[1])).toContain("id=in.(gen_00000003)&");
  });

  it("an order whose id cannot be healed still keeps its design (used decides, not the heal)", async () => {
    serve({ gens: [genRow("gen_00000001", "up_00000001", ago(10))], orders: [ord("o", ago(9), "uploads/up_00000001.bin")] });
    expect(await store().aiPurgeUnordered(cutoff(), false)).toEqual([]);
    expect(methods()).not.toContain("DELETE");
  });

  it("an order placed while the run was reading is seen by the second read and its design kept", async () => {
    let orderReads = 0;
    serve({ gens: [genRow("gen_00000001", "up_00000001", ago(10))] });
    const inner = route;
    route = (c) => {
      if (c.url.includes("/rest/v1/orders?select=order_id,created_at,files:record->files")) {
        orderReads++;
        // The first read is empty; the re-read right before the deletes finds the new order.
        if (orderReads >= 2 && c.headers.Range?.startsWith("0-")) return json([ord("order-new-0001", ago(0), "uploads/up_00000001.bin")]);
        return json([]);
      }
      return inner(c);
    };
    expect(await store().aiPurgeUnordered(cutoff(), false)).toEqual([]);
    expect(orderReads).toBeGreaterThanOrEqual(3); // first read: page + empty page; re-read: page + empty page
    expect(methods()).not.toContain("DELETE");
    expect(calls.find((x) => x.method === "PATCH")?.body).toEqual({ order_id: "order-new-0001" });
  });

  it("fails closed: a failing order read throws and NOTHING is deleted or healed", async () => {
    serve({ gens: [genRow("gen_00000001", "up_00000001", ago(10))], failOrders: true });
    await expect(store().aiPurgeUnordered(cutoff(), false)).rejects.toThrow(/503/);
    expect(methods().every((m) => m === "GET")).toBe(true);
  });

  it("re-verifies every candidate itself: a server that ignores the filters causes no delete", async () => {
    serve({
      gens: [
        genRow("gen_ordered_01", "up_ordered_01", ago(10), "order-0001-aaaa"), // order_id not null
        genRow("gen_fresh_0001", "up_fresh_0001", ago(1)), // newer than the cutoff
        { id: "short", upload_id: "up_00000009", created_at: ago(10).toISOString(), order_id: null }, // bad id
        { id: "gen_00000009", upload_id: "../x", created_at: ago(10).toISOString(), order_id: null }, // bad upload id
        { id: "gen_00000008", upload_id: "up_00000008", created_at: "garbage", order_id: null }, // bad date
        { id: "gen_00000007", upload_id: "up_00000007", created_at: ago(10).toISOString() }, // order_id missing
      ],
    });
    expect(await store().aiPurgeUnordered(cutoff(), false)).toEqual([]);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]); // candidate read (page + empty page), then nothing
    expect(methods()).not.toContain("DELETE");
  });

  it("a failed file delete keeps the rows of that chunk and throws (retried next day)", async () => {
    serve({ gens: [genRow("gen_00000001", "up_00000001", ago(10))], failStorageDelete: true });
    await expect(store().aiPurgeUnordered(cutoff(), false)).rejects.toThrow(/500/);
    expect(calls.filter((x) => x.method === "DELETE").every((x) => x.url.includes("/storage/v1/"))).toBe(true);
  });

  it("deletes in chunks of 100 ids; an earlier chunk stays deleted when a later one fails", async () => {
    const gens = Array.from({ length: 230 }, (_, i) => genRow(`gen_${String(i).padStart(8, "0")}`, `up_${String(i).padStart(8, "0")}`, ago(10)));
    serve({ gens });
    expect((await store().aiPurgeUnordered(cutoff(), false)).filter((x) => x.startsWith("ai_generation:"))).toHaveLength(230);
    const rowDeletes = calls.filter((x) => x.method === "DELETE" && x.url.includes("/rest/v1/ai_generations?"));
    expect(rowDeletes).toHaveLength(3);
    expect(rowDeletes.map((x) => /id=in\.\(([^)]*)\)/.exec(x.url)![1].split(",").length)).toEqual([100, 100, 30]);
    for (const x of rowDeletes) expect(x.url).toContain("&order_id=is.null&created_at=lt.");
  });

  it("nothing to do = no further request after the candidate read", async () => {
    serve({ gens: [] });
    expect(await store().aiPurgeUnordered(cutoff(), false)).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

/* ───────────────────────── purgeUnusedUploads ───────────────────────── */

describe("purgeUnusedUploads", () => {
  const obj = (name: string, createdAt: Date) => ({ name, created_at: createdAt.toISOString() });
  function serve(opts: { uploads: { name: string; created_at: string }[]; orders?: unknown[]; gens?: unknown[]; failOrders?: boolean }) {
    route = (c) => {
      if (c.url.includes("/rest/v1/orders?")) return opts.failOrders ? new Response("down", { status: 503 }) : paged(opts.orders ?? [], c);
      if (c.url.includes("/rest/v1/ai_generations?select=upload_id")) return paged(opts.gens ?? [], c);
      if (c.url.endsWith("/storage/v1/object/list/etihad")) {
        const { offset } = c.body as { offset: number };
        return json(offset === 0 ? opts.uploads : []);
      }
      if (c.method === "DELETE" && c.url.endsWith("/storage/v1/object/etihad")) return json([]);
      return undefined;
    };
  }

  it("removes unused uploads in [cutoff − 30 d, cutoff) (.bin + .json); keeps used, fresh and out-of-window ones", async () => {
    serve({
      uploads: [
        obj("up_fresh_01.bin", ago(2)), obj("up_fresh_01.json", ago(2)),
        obj("up_unused1.bin", ago(10)), obj("up_unused1.json", ago(10)),
        obj("up_byorder.bin", ago(12)), obj("up_byorder.json", ago(12)),
        obj("up_bymulti.bin", ago(12)), obj("up_bymulti.json", ago(12)),
        obj("up_bygen01.bin", ago(12)), obj("up_bygen01.json", ago(12)),
        obj("up_orphan1.json", ago(15)),
        obj("up_ancient.bin", ago(UNORDERED_DESIGN_DAYS + PURGE_WINDOW_DAYS + 3)),
      ],
      orders: [
        { order_id: "order-0001-aaaa", created_at: ago(11).toISOString(), files: { designPath: "uploads/up_byorder.bin", pdfPath: "orders/x.pdf" } },
        { order_id: "order-0002-bbbb", created_at: ago(11).toISOString(), files: { designPath: "uploads/up_x.bin", designPaths: ["uploads/up_bymulti.bin"], pdfPath: "orders/y.pdf" } },
      ],
      gens: [{ upload_id: "up_bygen01" }],
    });
    const removed = await store().purgeUnusedUploads(cutoff(), false);
    expect(removed.sort()).toEqual(["uploads/up_orphan1.json", "uploads/up_unused1.bin", "uploads/up_unused1.json"]);
    const del = calls.filter((c) => c.method === "DELETE");
    expect(del).toHaveLength(1);
    expect((del[0].body as { prefixes: string[] }).prefixes.sort()).toEqual(removed.sort());
  });

  it("dry run: same list, no DELETE", async () => {
    serve({ uploads: [obj("up_unused1.bin", ago(10)), obj("up_unused1.json", ago(10))] });
    expect(await store().purgeUnusedUploads(cutoff(), true)).toEqual(["uploads/up_unused1.bin", "uploads/up_unused1.json"]);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("reads references with no upper bound from a day before the window; a failing read deletes nothing", async () => {
    serve({ uploads: [obj("up_unused1.bin", ago(10))], failOrders: true });
    await expect(store().purgeUnusedUploads(cutoff(), false)).rejects.toThrow(/503/);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    const refFrom = new Date(cutoff().getTime() - (PURGE_WINDOW_DAYS + 1) * DAY).toISOString().slice(0, 13); // to the hour: the test and the call differ by a few ms
    expect(decodeURIComponent(calls[0].url)).toContain(`created_at=gte.${refFrom}`);
    expect(calls[0].url).not.toContain("created_at=lt");
  });

  it("an upload with no creation date is never removed", async () => {
    serve({ uploads: [{ name: "up_nodate1.bin", created_at: undefined as never }] });
    expect(await store().purgeUnusedUploads(cutoff(), false)).toEqual([]);
  });
});
