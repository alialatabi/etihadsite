import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/purge/route";
import { KEEP_DESIGNS_FROM } from "@/config/defaults";
import { LocalStorage } from "@/lib/storage/local";
import { SupabaseStorage } from "@/lib/storage/supabase";
import type { AnalyticsEvent, OrderRecord } from "@/lib/types";
import { setupEnv } from "./helpers";

const tmp = () => mkdtempSync(path.join(tmpdir(), "ep-an-"));

function order(id: string, createdAt: string, over: Partial<OrderRecord["customer"]> = {}, total: number | null = 10000): OrderRecord {
  return {
    orderId: id,
    displayNo: `EP-${id}`,
    createdAt,
    status: "new",
    price: { totalIqd: total },
    customer: { phone: "9647701234567", governorate: "بغداد", district: "الكرادة", landmark: "قرب الجسر", name: "علي", ...over },
    files: { designPath: `uploads/${id}.bin`, pdfPath: `orders/${id}.pdf` },
  } as unknown as OrderRecord;
}

const ev = (ts: string, type: AnalyticsEvent["type"] = "pageview"): AnalyticsEvent => ({ ts, type, visitor: "v1", path: "/" });

describe("LocalStorage analytics", () => {
  it("round-trips events across a month boundary and filters by since", async () => {
    const s = new LocalStorage(tmp());
    await s.recordEvent(ev("2026-11-02T09:00:00.000Z"));
    await s.recordEvent(ev("2026-10-31T23:59:59.000Z"));
    await s.recordEvent(ev("2026-10-15T00:00:00.000Z"));
    await s.recordEvent({ ...ev("2026-11-03T00:00:00.000Z", "order"), meta: { totalIqd: 5, material: "paper" } });
    expect(readdirSync(path.join(s.root, "analytics")).sort()).toEqual(["events-2026-10.jsonl", "events-2026-11.jsonl"]);

    const all = await s.listEvents(new Date("2026-01-01T00:00:00Z"));
    expect(all.map((e) => e.ts)).toEqual([
      "2026-10-15T00:00:00.000Z",
      "2026-10-31T23:59:59.000Z",
      "2026-11-02T09:00:00.000Z",
      "2026-11-03T00:00:00.000Z",
    ]);
    const some = await s.listEvents(new Date("2026-10-31T12:00:00Z"));
    expect(some).toHaveLength(3);
    expect(some[2].meta).toEqual({ totalIqd: 5, material: "paper" });
    expect(await s.listEvents(new Date("2027-01-01T00:00:00Z"))).toEqual([]);
  });

  it("returns [] with no analytics dir and skips corrupt lines", async () => {
    const s = new LocalStorage(tmp());
    expect(await s.listEvents(new Date(0))).toEqual([]);
    await s.recordEvent(ev("2026-11-02T09:00:00.000Z"));
    const { appendFileSync } = await import("node:fs");
    appendFileSync(path.join(s.root, "analytics", "events-2026-11.jsonl"), "{torn\n");
    await s.recordEvent(ev("2026-11-02T10:00:00.000Z"));
    expect(await s.listEvents(new Date(0))).toHaveLength(2);
  });

  it("upserts customers: increments, refreshes address, orders by lastOrderAt", async () => {
    const s = new LocalStorage(tmp());
    await s.upsertCustomerFromOrder(order("order-0001", "2026-11-01T10:00:00.000Z"));
    await s.upsertCustomerFromOrder(order("order-0002", "2026-11-02T10:00:00.000Z", { phone: "9647801112222", name: undefined }, null));
    await s.upsertCustomerFromOrder(order("order-0003", "2026-11-03T10:00:00.000Z", { district: "المنصور", landmark: "جنب المول", name: undefined }, 2500));
    const list = await s.listCustomers();
    expect(list.map((c) => c.phone)).toEqual(["9647701234567", "9647801112222"]);
    const a = list[0];
    expect(a).toMatchObject({
      name: "علي",
      district: "المنصور",
      landmark: "جنب المول",
      ordersCount: 2,
      totalIqd: 12500,
      firstOrderAt: "2026-11-01T10:00:00.000Z",
      lastOrderAt: "2026-11-03T10:00:00.000Z",
      lastOrderId: "order-0003",
    });
    expect(list[1]).toMatchObject({ ordersCount: 1, totalIqd: 0 });
    expect(list[1].name).toBeUndefined();
  });

  it("opt-in: the latest order's explicit choice wins; an unticked order withdraws; no keys for a customer who never opted in", async () => {
    const s = new LocalStorage(tmp());
    const yes = (id: string, at: string, phone = "9647701234567") =>
      order(id, at, { phone, marketingOptIn: true, marketingOptInAt: at });
    // Never opted in: the stored record has no opt-in keys at all.
    await s.upsertCustomerFromOrder(order("order-0001", "2026-11-01T10:00:00.000Z", { phone: "9647801112222" }));
    await s.upsertCustomerFromOrder(order("order-0002", "2026-11-02T10:00:00.000Z", { phone: "9647801112222" }));
    // Opt in, stay in on a second ticked order (date moves), then withdraw by an unticked order.
    await s.upsertCustomerFromOrder(yes("order-0003", "2026-11-03T10:00:00.000Z"));
    let a = (await s.listCustomers()).find((c) => c.phone === "9647701234567")!;
    expect(a).toMatchObject({ marketingOptIn: true, marketingOptInAt: "2026-11-03T10:00:00.000Z" });
    await s.upsertCustomerFromOrder(yes("order-0004", "2026-11-04T10:00:00.000Z"));
    a = (await s.listCustomers()).find((c) => c.phone === "9647701234567")!;
    expect(a.marketingOptInAt).toBe("2026-11-04T10:00:00.000Z");
    await s.upsertCustomerFromOrder(order("order-0005", "2026-11-05T10:00:00.000Z"));
    a = (await s.listCustomers()).find((c) => c.phone === "9647701234567")!;
    expect(a).toMatchObject({ marketingOptIn: false, marketingOptInAt: null, ordersCount: 3 });
    // An older order arriving late does not override the newer choice.
    await s.upsertCustomerFromOrder(yes("order-0006", "2026-11-02T10:00:00.000Z"));
    a = (await s.listCustomers()).find((c) => c.phone === "9647701234567")!;
    expect(a).toMatchObject({ marketingOptIn: false, marketingOptInAt: null });
    const never = (await s.listCustomers()).find((c) => c.phone === "9647801112222")!;
    expect(never).not.toHaveProperty("marketingOptIn");
    expect(never).not.toHaveProperty("marketingOptInAt");
  });

  it("opt-in on the very first order is stored with that order's time", async () => {
    const s = new LocalStorage(tmp());
    await s.upsertCustomerFromOrder(order("order-0001", "2026-11-01T10:00:00.000Z", { marketingOptIn: true, marketingOptInAt: "2026-11-01T10:00:00.000Z" }));
    const [c] = await s.listCustomers();
    expect(c).toMatchObject({ marketingOptIn: true, marketingOptInAt: "2026-11-01T10:00:00.000Z" });
  });

  it("does not lose concurrent upserts", async () => {
    const s = new LocalStorage(tmp());
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => s.upsertCustomerFromOrder(order(`order-${1000 + i}`, `2026-11-0${(i % 9) + 1}T10:00:00.000Z`))),
    );
    const [c] = await s.listCustomers();
    expect(c.ordersCount).toBe(10);
    expect(c.totalIqd).toBe(100000);
  });

  it("purgeEventsOlderThan drops only whole old months and never customers", async () => {
    const s = new LocalStorage(tmp());
    await s.recordEvent(ev("2025-01-10T00:00:00.000Z"));
    await s.recordEvent(ev("2026-11-02T00:00:00.000Z"));
    await s.upsertCustomerFromOrder(order("order-0001", "2025-01-10T00:00:00.000Z"));
    const cutoff = new Date("2026-06-01T00:00:00Z");
    expect(await s.purgeEventsOlderThan(cutoff, true)).toEqual(["analytics/events-2025-01.jsonl"]);
    expect(existsSync(path.join(s.root, "analytics", "events-2025-01.jsonl"))).toBe(true);
    await s.purgeEventsOlderThan(cutoff, false);
    expect(await s.listEvents(new Date(0))).toHaveLength(1);
    // orders purge (30 days) leaves customers alone too (an old-rule order inside the 30-day window)
    await s.saveOrder(order("order-0001", "2026-09-15T00:00:00.000Z"));
    await s.purgeOlderThan(new Date("2026-10-01T00:00:00Z"), false);
    expect(await s.getOrder("order-0001")).toBeNull();
    expect(await s.listCustomers()).toHaveLength(1);
  });
});

describe("cron purge keeps customers", () => {
  const SECRET = "cron-secret-for-tests-0123456789";
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("GET deletes old events and orders but not customers", async () => {
    const dir = setupEnv({ CRON_SECRET: SECRET });
    const s = new LocalStorage(dir);
    // The clock sits 10 days after KEEP_DESIGNS_FROM; the order is an old-rule one inside the purge window.
    const keep = new Date(KEEP_DESIGNS_FROM).getTime();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(keep + 10 * 86_400_000);
    const orderAt = new Date(keep - 30 * 86_400_000).toISOString();
    await s.recordEvent(ev("2020-01-01T00:00:00.000Z"));
    await s.saveOrder(order("order-0001", orderAt));
    await s.upsertCustomerFromOrder(order("order-0001", orderAt));
    const res = await GET(new Request("http://localhost/api/cron/purge", { headers: { authorization: `Bearer ${SECRET}` } }));
    vi.useRealTimers();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, removedEvents: 1 });
    expect(await s.listEvents(new Date(0))).toEqual([]);
    expect(await s.getOrder("order-0001")).toBeNull();
    expect(await s.listCustomers()).toHaveLength(1);
  });
});

describe("SupabaseStorage analytics (request shape)", () => {
  const BASE = "https://proj.supabase.co";
  const KEY = "test-secret-key-not-real";
  type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };
  let calls: Call[];
  let queue: Response[];
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  const empty = () => new Response(null, { status: 204 });

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
  afterEach(() => vi.unstubAllGlobals());
  const store = () => new SupabaseStorage(BASE, KEY);

  it("recordEvent POSTs one row to /rest/v1/events", async () => {
    queue.push(empty());
    await store().recordEvent({ ...ev("2026-11-02T09:00:00.000Z", "step"), step: "size", device: "mobile" });
    expect(calls[0].url).toBe(`${BASE}/rest/v1/events`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.apikey).toBe(KEY);
    expect(calls[0].init.headers.Prefer).toBe("return=minimal");
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ type: "step", step: "size", device: "mobile", visitor: "v1", city: null, meta: null });
  });

  it("listEvents pages with Range headers until a short page, dropping nulls", async () => {
    const row = (i: number) => ({ ts: "2026-11-02T09:00:00Z", type: "pageview", visitor: `v${i}`, path: "/", step: null, meta: null });
    queue.push(json(Array.from({ length: 1000 }, (_, i) => row(i))), json(Array.from({ length: 1000 }, (_, i) => row(i))), json([row(1)]));
    const out = await store().listEvents(new Date("2026-10-01T00:00:00.000Z"));
    expect(out).toHaveLength(2001);
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toContain("ts=gte.2026-10-01T00%3A00%3A00.000Z");
    expect(calls[0].url).toContain("order=ts.asc");
    expect(calls.map((c) => c.init.headers.Range)).toEqual(["0-999", "1000-1999", "2000-2999"]);
    expect(out[0]).not.toHaveProperty("step");
    expect(out[0]).not.toHaveProperty("meta");
  });

  it("upsertCustomerFromOrder calls rpc upsert_customer_v2 with 0 for unknown totals", async () => {
    queue.push(empty(), empty());
    await store().upsertCustomerFromOrder(order("order-0001", "2026-11-01T10:00:00.000Z"));
    await store().upsertCustomerFromOrder(order("order-0002", "2026-11-01T10:00:00.000Z", { name: undefined }, null));
    expect(calls[0].url).toBe(`${BASE}/rest/v1/rpc/upsert_customer_v2`);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      p_phone: "9647701234567",
      p_name: "علي",
      p_governorate: "بغداد",
      p_district: "الكرادة",
      p_landmark: "قرب الجسر",
      p_at: "2026-11-01T10:00:00.000Z",
      p_order_id: "order-0001",
      p_display_no: "EP-order-0001",
      p_total_iqd: 10000,
      p_marketing_opt_in: false,
    });
    expect(JSON.parse(calls[1].init.body as string)).toMatchObject({ p_name: null, p_total_iqd: 0 });
  });

  it("upsertCustomerFromOrder sends the opt-in only when the order ticked it", async () => {
    queue.push(empty(), empty());
    await store().upsertCustomerFromOrder(order("order-0001", "2026-11-01T10:00:00.000Z", { marketingOptIn: true, marketingOptInAt: "2026-11-01T10:00:00.000Z" }));
    await store().upsertCustomerFromOrder(order("order-0002", "2026-11-02T10:00:00.000Z"));
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ p_marketing_opt_in: true });
    expect(JSON.parse(calls[1].init.body as string)).toMatchObject({ p_marketing_opt_in: false });
  });

  it("falls back to upsert_customer when upsert_customer_v2 does not exist yet (migration not applied)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missing = () =>
      new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function public.upsert_customer_v2" }), { status: 404, headers: { "content-type": "application/json" } });
    queue.push(missing(), empty(), missing(), empty());
    const s = store();
    await s.upsertCustomerFromOrder(order("order-0001", "2026-11-01T10:00:00.000Z", { marketingOptIn: true }));
    await s.upsertCustomerFromOrder(order("order-0002", "2026-11-02T10:00:00.000Z"));
    expect(calls.map((c) => c.url.replace(BASE, ""))).toEqual([
      "/rest/v1/rpc/upsert_customer_v2",
      "/rest/v1/rpc/upsert_customer",
      "/rest/v1/rpc/upsert_customer_v2",
      "/rest/v1/rpc/upsert_customer",
    ]);
    // The v1 call carries exactly the old arguments (no opt-in parameter, which v1 does not have).
    expect(Object.keys(JSON.parse(calls[1].init.body as string))).toEqual([
      "p_phone", "p_name", "p_governorate", "p_district", "p_landmark", "p_at", "p_order_id", "p_display_no", "p_total_iqd",
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("does not hide a real v2 failure behind the v1 fallback", async () => {
    queue.push(new Response("boom", { status: 500 }));
    await expect(store().upsertCustomerFromOrder(order("order-0001", "2026-11-01T10:00:00.000Z"))).rejects.toThrow(/upsert_customer_v2 -> 500/);
    expect(calls).toHaveLength(1);
  });

  it("listCustomers maps the opt-in columns when present and leaves them out when absent", async () => {
    const base = { name: "x", governorate: "g", district: "d", landmark: "l", first_order_at: "a", last_order_at: "b", orders_count: 1, total_iqd: 0, last_order_id: "o", last_display_no: "n" };
    queue.push(
      json([
        { ...base, phone: "9647701234567", marketing_opt_in: true, marketing_opt_in_at: "2026-11-01T10:00:00+00:00" },
        { ...base, phone: "9647701234568", marketing_opt_in: false, marketing_opt_in_at: null },
        { ...base, phone: "9647701234569" },
      ]),
    );
    const [a, b, c] = await store().listCustomers();
    expect(a).toMatchObject({ marketingOptIn: true, marketingOptInAt: "2026-11-01T10:00:00+00:00" });
    expect(b).toMatchObject({ marketingOptIn: false, marketingOptInAt: null });
    expect(c).not.toHaveProperty("marketingOptIn");
    expect(c).not.toHaveProperty("marketingOptInAt");
  });

  it("listCustomers maps rows, newest first, and never issues a DELETE", async () => {
    queue.push(
      json([
        { phone: "9647701234567", name: null, governorate: "بغداد", district: "d", landmark: "l", first_order_at: "a", last_order_at: "b", orders_count: 2, total_iqd: "12500", last_order_id: "o", last_display_no: "n" },
      ]),
    );
    const [c] = await store().listCustomers();
    expect(calls[0].url).toContain("/rest/v1/customers?");
    expect(calls[0].url).toContain("order=last_order_at.desc");
    expect(c).toMatchObject({ ordersCount: 2, totalIqd: 12500, firstOrderAt: "a", lastOrderAt: "b" });
    expect(c.name).toBeUndefined();
  });

  it("purgeEventsOlderThan deletes only from events", async () => {
    queue.push(json([{ id: 1 }, { id: 2 }]));
    expect(await store().purgeEventsOlderThan(new Date("2025-01-01T00:00:00.000Z"), false)).toEqual(["events:2"]);
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].url).toContain("/rest/v1/events?");
    expect(calls[0].url).not.toContain("customers");
  });
});
