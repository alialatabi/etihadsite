import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseStorage } from "@/lib/storage/supabase";
import { isStaffNotReady, isStaffPhoneTaken } from "@/lib/storage/staff-errors";
import type { AiGenerationRecord, StaffAccountRecord } from "@/lib/types";

const BASE = "https://proj.supabase.co";
const KEY = "test-secret-key-not-real";

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };

let calls: Call[];
let queue: Response[];

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const empty = (status = 201) => new Response(status === 204 ? null : "", { status });

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
const body = (c: Call) => JSON.parse(c.init.body as string) as Record<string, unknown>;

const GEN: AiGenerationRecord = {
  id: "gen_abcdefgh",
  createdAt: "2026-11-26T09:30:00.000Z",
  day: "2026-11-26",
  ip: "185.23.4.5",
  ipKey: "a1b2c3",
  shape: "rect",
  corners: "sharp",
  widthUm: 60_000,
  heightUm: 40_000,
  idea: "قهوة",
  lines: [],
  hasRefs: false,
  model: "gpt-image",
  uploadId: "up_abcdefgh",
  orderId: null,
};
const STAFF_GEN: AiGenerationRecord = { ...GEN, staffId: "st_abcdefgh", instructions: "خط عريض" };

describe("aiRecordGeneration with the v2 columns", () => {
  it("a customer row has no staff_id / instructions key", async () => {
    queue.push(empty());
    await store().aiRecordGeneration(GEN);
    expect(calls).toHaveLength(1);
    expect(Object.keys(body(calls[0]))).not.toContain("staff_id");
    expect(Object.keys(body(calls[0]))).not.toContain("instructions");
  });

  it("explicit nulls (staffId / instructions) add no key either", async () => {
    queue.push(empty());
    await store().aiRecordGeneration({ ...GEN, staffId: null, instructions: null });
    expect(Object.keys(body(calls[0]))).not.toContain("staff_id");
    expect(Object.keys(body(calls[0]))).not.toContain("instructions");
  });

  it("a staff row POSTs both columns", async () => {
    queue.push(empty());
    await store().aiRecordGeneration(STAFF_GEN);
    expect(body(calls[0])).toMatchObject({ staff_id: "st_abcdefgh", instructions: "خط عريض" });
  });

  it.each(["PGRST204", "42703"])("retries ONCE without the new columns on %s", async (code) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    queue.push(json({ code, message: "column does not exist" }, 400), empty());
    await store().aiRecordGeneration(STAFF_GEN);
    expect(calls).toHaveLength(2);
    // the retried body is exactly the old (pre-migration) row
    queue.push(empty());
    await store().aiRecordGeneration(GEN);
    expect(body(calls[1])).toEqual(body(calls[2]));
    expect(Object.keys(body(calls[1]))).not.toContain("staff_id");
    expect(Object.keys(body(calls[1]))).not.toContain("instructions");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns once per instance but retries every time", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const s = store();
    queue.push(json({ code: "PGRST204" }, 400), empty(), json({ code: "PGRST204" }, 400), empty());
    await s.aiRecordGeneration(STAFF_GEN);
    await s.aiRecordGeneration({ ...STAFF_GEN, id: "gen_bbbbbbbb", uploadId: "up_bbbbbbbb" });
    expect(calls).toHaveLength(4);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("another 400 code throws and does not retry", async () => {
    queue.push(json({ code: "23505", message: "duplicate" }, 400));
    await expect(store().aiRecordGeneration(STAFF_GEN)).rejects.toThrow(/ai_generations -> 400/);
    expect(calls).toHaveLength(1);
  });

  it("an unknown column on a customer row (no new columns in the body) is not retried", async () => {
    queue.push(json({ code: "PGRST204" }, 400));
    await expect(store().aiRecordGeneration(GEN)).rejects.toThrow(/400/);
    expect(calls).toHaveLength(1);
  });
});

describe("aiListGenerations mapping of the v2 columns", () => {
  const row = (extra: Record<string, unknown>) => ({
    id: "gen_abcdefgh", created_at: "2026-11-26T09:30:00+00:00", day: "2026-11-26", ip: "", ip_key: "k", shape: "rect",
    corners: "sharp", width_um: 1, height_um: 1, idea: "", lines: [], has_refs: false, model: "m", upload_id: "up_abcdefgh",
    order_id: null, ...extra,
  });
  it("adds staffId / instructions only for string columns", async () => {
    queue.push(
      new Response(JSON.stringify([row({ instructions: "x", staff_id: "st_abcdefgh" }), row({ instructions: null, staff_id: null })]), {
        status: 200,
        headers: { "content-type": "application/json", "content-range": "0-1/2" },
      }),
    );
    const { rows } = await store().aiListGenerations({ limit: 10, offset: 0 });
    expect(rows[0]).toMatchObject({ staffId: "st_abcdefgh", instructions: "x" });
    expect(Object.keys(rows[1])).not.toContain("staffId");
    expect(Object.keys(rows[1])).not.toContain("instructions");
  });
});

describe("aiUsage with staff kinds", () => {
  it("builds the kind filter for staff_image", async () => {
    queue.push(json([{ day: "2026-11-26", ip_key: "staff:st_abcdefgh", ip: "", kind: "staff_image", count: 3, last_at: "2026-11-26T10:00:00Z" }]));
    const rows = await store().aiUsage("2026-11-26", "staff_image");
    expect(calls[0].url).toContain("&kind=eq.staff_image");
    expect(rows[0]).toMatchObject({ ipKey: "staff:st_abcdefgh", kind: "staff_image", count: 3 });
  });
  it("still rejects an unknown kind", async () => {
    await expect(store().aiUsage("2026-11-26", "x" as never)).rejects.toThrow("Invalid kind");
  });
});

const REC: StaffAccountRecord = {
  id: "st_abcdefgh",
  name: "أحمد",
  phone: "9647701234567",
  active: true,
  createdAt: "2026-11-26T08:00:00.000Z",
  passwordChangedAt: "2026-11-26T08:00:00.000Z",
  passwordHash: "scrypt$16384$8$1$AAAA$BBBB",
};
const ROW = {
  id: REC.id, name: REC.name, phone: REC.phone, password_hash: REC.passwordHash, active: true,
  created_at: "2026-11-26T08:00:00+00:00", last_login_at: null, password_changed_at: "2026-11-26T08:00:00+00:00",
};

describe("staff methods", () => {
  it("staffList: one GET, ordered, rows mapped", async () => {
    queue.push(json([ROW, { ...ROW, id: "st_bbbbbbbb", active: false, last_login_at: "2026-11-26T09:00:00+00:00" }]));
    const out = await store().staffList();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/rest/v1/staff_accounts?select=*&order=created_at.asc,id.asc`);
    expect(out[0]).toEqual({
      id: REC.id, name: REC.name, phone: REC.phone, active: true, createdAt: "2026-11-26T08:00:00+00:00",
      passwordChangedAt: "2026-11-26T08:00:00+00:00", passwordHash: REC.passwordHash,
    });
    expect(out[1]).toMatchObject({ active: false, lastLoginAt: "2026-11-26T09:00:00+00:00" });
  });

  it("staffGet / staffByPhone: exact URLs; null when there is no row", async () => {
    queue.push(json([ROW]), json([]), json([ROW]));
    expect((await store().staffGet("st_abcdefgh"))?.id).toBe("st_abcdefgh");
    expect(calls[0].url).toBe(`${BASE}/rest/v1/staff_accounts?select=*&id=eq.st_abcdefgh&limit=1`);
    expect(await store().staffGet("st_zzzzzzzz")).toBeNull();
    expect((await store().staffByPhone("9647701234567"))?.phone).toBe("9647701234567");
    expect(calls[2].url).toBe(`${BASE}/rest/v1/staff_accounts?select=*&phone=eq.9647701234567&limit=1`);
  });

  it("an invalid id or phone makes no request", async () => {
    const s = store();
    expect(await s.staffGet("../x")).toBeNull();
    expect(await s.staffByPhone("0770 1234567")).toBeNull();
    expect(await s.staffUpdate("bad id", { active: false })).toBeNull();
    await s.staffTouchLogin("bad id", "2026-11-26T10:00:00.000Z");
    await expect(s.staffCreate({ ...REC, phone: "0770" })).rejects.toThrow("Invalid staff account");
    await expect(s.staffCreate({ ...REC, id: "x" })).rejects.toThrow("Invalid staff account");
    expect(calls).toHaveLength(0);
  });

  it("staffCreate POSTs the row with return=minimal", async () => {
    queue.push(empty());
    await store().staffCreate(REC);
    expect(calls[0].url).toBe(`${BASE}/rest/v1/staff_accounts`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Prefer).toBe("return=minimal");
    expect(body(calls[0])).toEqual({
      id: REC.id, name: REC.name, phone: REC.phone, password_hash: REC.passwordHash, active: true,
      created_at: REC.createdAt, last_login_at: null, password_changed_at: REC.passwordChangedAt,
    });
  });

  it("staffUpdate PATCHes only the defined keys, return=representation", async () => {
    queue.push(json([{ ...ROW, active: false }]), json([]));
    const out = await store().staffUpdate("st_abcdefgh", { active: false, passwordChangedAt: "2026-11-27T00:00:00.000Z" });
    expect(calls[0].url).toBe(`${BASE}/rest/v1/staff_accounts?id=eq.st_abcdefgh`);
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].init.headers.Prefer).toBe("return=representation");
    expect(body(calls[0])).toEqual({ active: false, password_changed_at: "2026-11-27T00:00:00.000Z" });
    expect(out?.active).toBe(false);
    expect(await store().staffUpdate("st_abcdefgh", { name: "x" })).toBeNull();
  });

  it("staffUpdate with an empty patch reads the row instead", async () => {
    queue.push(json([ROW]));
    expect((await store().staffUpdate("st_abcdefgh", {}))?.id).toBe("st_abcdefgh");
    expect(calls[0].init.method ?? "GET").toBe("GET");
  });

  it("staffTouchLogin PATCHes last_login_at with return=minimal", async () => {
    queue.push(empty(204));
    await store().staffTouchLogin("st_abcdefgh", "2026-11-26T10:00:00.000Z");
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].init.headers.Prefer).toBe("return=minimal");
    expect(body(calls[0])).toEqual({ last_login_at: "2026-11-26T10:00:00.000Z" });
  });

  it.each([
    ["404", () => new Response("", { status: 404 })],
    ["PGRST205", () => json({ code: "PGRST205", message: "no table" }, 404)],
    ["42P01", () => json({ code: "42P01" }, 400)],
    ["42703", () => json({ code: "42703" }, 400)],
  ])("a missing table (%s) is 'not ready'", async (_n, make) => {
    queue.push(make());
    const err = await store().staffList().catch((e) => e);
    expect(isStaffNotReady(err)).toBe(true);
    expect(isStaffPhoneTaken(err)).toBe(false);
  });

  it("a unique violation is 'phone taken' and the message never carries the phone", async () => {
    queue.push(json({ code: "23505", details: `Key (phone)=(${REC.phone}) already exists.` }, 409));
    const err = await store().staffCreate(REC).catch((e) => e);
    expect(isStaffPhoneTaken(err)).toBe(true);
    expect(String((err as Error).message)).not.toContain(REC.phone);
    queue.push(json({ code: "23505", details: `Key (phone)=(${REC.phone})` }, 400));
    expect(isStaffPhoneTaken(await store().staffCreate(REC).catch((e) => e))).toBe(true);
  });

  it("any other failure throws a plain error without the body text", async () => {
    queue.push(new Response(`secret ${REC.phone}`, { status: 500 }));
    const err = (await store().staffByPhone(REC.phone).catch((e) => e)) as Error;
    expect(err.message).toBe("[supabase] GET /rest/v1/staff_accounts -> 500");
    expect(isStaffNotReady(err)).toBe(false);
  });
});
