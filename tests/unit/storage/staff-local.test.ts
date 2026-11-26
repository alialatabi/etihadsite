import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStorage } from "@/lib/storage/local";
import { isStaffNotReady, isStaffPhoneTaken } from "@/lib/storage/staff-errors";
import type { AiGenerationRecord, StaffAccountRecord } from "@/lib/types";

const tmp = () => mkdtempSync(path.join(tmpdir(), "ep-staff-"));

function acct(id: string, phone: string, createdAt: string): StaffAccountRecord {
  return {
    id,
    name: `name ${id}`,
    phone,
    active: true,
    createdAt,
    passwordChangedAt: createdAt,
    passwordHash: "scrypt$16384$8$1$AAAA$BBBB",
  };
}

describe("LocalStorage staff accounts", () => {
  it("creates no ai/staff.json until the first staff write", async () => {
    const s = new LocalStorage(tmp());
    expect(await s.staffList()).toEqual([]);
    expect(await s.staffGet("st_abcdefgh")).toBeNull();
    expect(await s.staffByPhone("9647701234567")).toBeNull();
    expect(existsSync(path.join(s.root, "ai", "staff.json"))).toBe(false);
    await s.staffCreate(acct("st_abcdefgh", "9647701234567", "2026-11-26T08:00:00.000Z"));
    expect(existsSync(path.join(s.root, "ai", "staff.json"))).toBe(true);
  });

  it("create, get, byPhone and list (oldest first, then id)", async () => {
    const s = new LocalStorage(tmp());
    await s.staffCreate(acct("st_bbbbbbbb", "9647702222222", "2026-11-26T09:00:00.000Z"));
    await s.staffCreate(acct("st_aaaaaaaa", "9647701111111", "2026-11-26T09:00:00.000Z"));
    await s.staffCreate(acct("st_cccccccc", "9647703333333", "2026-11-26T08:00:00.000Z"));
    expect((await s.staffList()).map((r) => r.id)).toEqual(["st_cccccccc", "st_aaaaaaaa", "st_bbbbbbbb"]);
    expect((await s.staffGet("st_bbbbbbbb"))?.phone).toBe("9647702222222");
    expect((await s.staffByPhone("9647701111111"))?.id).toBe("st_aaaaaaaa");
    expect(await s.staffGet("st_zzzzzzzz")).toBeNull();
  });

  it("refuses a duplicate phone (typed) and a duplicate id", async () => {
    const s = new LocalStorage(tmp());
    await s.staffCreate(acct("st_aaaaaaaa", "9647701111111", "2026-11-26T08:00:00.000Z"));
    const dupPhone = await s.staffCreate(acct("st_bbbbbbbb", "9647701111111", "2026-11-26T09:00:00.000Z")).catch((e) => e);
    expect(isStaffPhoneTaken(dupPhone)).toBe(true);
    expect(isStaffNotReady(dupPhone)).toBe(false);
    await expect(s.staffCreate(acct("st_aaaaaaaa", "9647702222222", "2026-11-26T09:00:00.000Z"))).rejects.toThrow(/Duplicate/);
    expect(await s.staffList()).toHaveLength(1);
  });

  it("staffUpdate patches only the allowed keys and returns null for an unknown id", async () => {
    const s = new LocalStorage(tmp());
    await s.staffCreate(acct("st_aaaaaaaa", "9647701111111", "2026-11-26T08:00:00.000Z"));
    const out = await s.staffUpdate("st_aaaaaaaa", {
      active: false,
      name: "جديد",
      passwordHash: "scrypt$16384$8$1$CCCC$DDDD",
      passwordChangedAt: "2026-11-27T00:00:00.000Z",
      // an unexpected key must be ignored
      ...({ phone: "9647709999999", id: "st_hacked00" } as object),
    });
    expect(out).toMatchObject({
      id: "st_aaaaaaaa",
      phone: "9647701111111",
      active: false,
      name: "جديد",
      passwordHash: "scrypt$16384$8$1$CCCC$DDDD",
      passwordChangedAt: "2026-11-27T00:00:00.000Z",
    });
    // an undefined key leaves the field alone
    const same = await s.staffUpdate("st_aaaaaaaa", { name: undefined });
    expect(same?.name).toBe("جديد");
    expect(await s.staffUpdate("st_zzzzzzzz", { active: true })).toBeNull();
  });

  it("staffTouchLogin sets lastLoginAt; an unknown id is a no-op", async () => {
    const s = new LocalStorage(tmp());
    await s.staffCreate(acct("st_aaaaaaaa", "9647701111111", "2026-11-26T08:00:00.000Z"));
    await s.staffTouchLogin("st_aaaaaaaa", "2026-11-26T10:00:00.000Z");
    await s.staffTouchLogin("st_zzzzzzzz", "2026-11-26T10:00:00.000Z");
    expect((await s.staffGet("st_aaaaaaaa"))?.lastLoginAt).toBe("2026-11-26T10:00:00.000Z");
    expect(await s.staffList()).toHaveLength(1);
  });

  it("returns copies, never the stored objects", async () => {
    const s = new LocalStorage(tmp());
    const rec = acct("st_aaaaaaaa", "9647701111111", "2026-11-26T08:00:00.000Z");
    await s.staffCreate(rec);
    rec.name = "mutated input";
    const a = await s.staffGet("st_aaaaaaaa");
    a!.name = "mutated output";
    (await s.staffList())[0].name = "mutated list";
    expect((await s.staffGet("st_aaaaaaaa"))?.name).toBe("name st_aaaaaaaa");
  });

  it("a generation keeps staffId and instructions through aiRecordGeneration / aiListGenerations", async () => {
    const s = new LocalStorage(tmp());
    const g: AiGenerationRecord = {
      id: "gen_abcdefgh",
      createdAt: "2026-11-26T09:00:00.000Z",
      day: "2026-11-26",
      ip: "",
      ipKey: "staff:st_abcdefgh",
      shape: "circle",
      corners: "rounded",
      widthUm: 50_000,
      heightUm: 50_000,
      idea: "قطة",
      lines: [],
      hasRefs: false,
      model: "gpt-image",
      uploadId: "up_abcdefgh",
      orderId: null,
      staffId: "st_abcdefgh",
      instructions: "خلفية سودة وخط عريض",
    };
    await s.aiRecordGeneration(g);
    const { rows } = await s.aiListGenerations({ limit: 10, offset: 0 });
    expect(rows[0]).toMatchObject({ staffId: "st_abcdefgh", instructions: "خلفية سودة وخط عريض" });
  });
});
