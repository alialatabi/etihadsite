import { beforeEach, describe, expect, it, vi } from "vitest";
import { SECRET, setupEnv } from "./helpers";

const jar = new Map<string, string>();
const reqHeaders = new Headers();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => reqHeaders,
}));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Error("NEXT_REDIRECT " + u);
  },
}));

import {
  createStaffSession,
  currentStaff,
  destroyStaffSession,
  requireStaff,
  staffApiGuard,
} from "@/lib/auth/staff-session";
import { signStaffToken } from "@/lib/auth/staff-token";
import { getStorage } from "@/lib/storage";
import { StaffStorageError } from "@/lib/storage/staff-errors";
import type { StaffAccountRecord } from "@/lib/types";

const ID = "st_abcdefgh12";

function rec(over: Partial<StaffAccountRecord> = {}): StaffAccountRecord {
  const now = new Date().toISOString();
  return {
    id: ID,
    name: "أحمد",
    phone: "9647701234567",
    active: true,
    createdAt: now,
    passwordChangedAt: now,
    passwordHash: "scrypt$16384$8$1$AAAA$BBBB",
    ...over,
  };
}

beforeEach(() => {
  setupEnv();
  jar.clear();
});

describe("staff session", () => {
  it("createStaffSession sets sf_staff; currentStaff returns the account without its hash", async () => {
    await getStorage().staffCreate!(rec());
    await createStaffSession({ id: ID });
    expect(jar.has("sf_staff")).toBe(true);
    const s = await currentStaff();
    expect(s).toMatchObject({ id: ID, name: "أحمد", phone: "9647701234567", active: true });
    expect(s).not.toHaveProperty("passwordHash");
  });

  it("a login in the same second as the account's creation is accepted (iat has no milliseconds)", async () => {
    await getStorage().staffCreate!(rec());
    await createStaffSession({ id: ID });
    expect(await currentStaff()).not.toBeNull();
  });

  it("refuses a disabled account", async () => {
    await getStorage().staffCreate!(rec());
    await createStaffSession({ id: ID });
    await getStorage().staffUpdate!(ID, { active: false });
    expect(await currentStaff()).toBeNull();
  });

  it("refuses a token older than passwordChangedAt (a reset logs the account out)", async () => {
    await getStorage().staffCreate!(rec());
    jar.set("sf_staff", await signStaffToken(SECRET, ID, Date.now() - 10_000));
    expect(await currentStaff()).toBeNull();
    // and a token issued after a later reset is fine
    await getStorage().staffUpdate!(ID, { passwordChangedAt: new Date(Date.now() - 20_000).toISOString() });
    expect(await currentStaff()).not.toBeNull();
  });

  it("refuses an unknown account, no cookie, and a bad token", async () => {
    expect(await currentStaff()).toBeNull();
    jar.set("sf_staff", await signStaffToken(SECRET, "st_unknown123"));
    expect(await currentStaff()).toBeNull();
    jar.set("sf_staff", "garbage");
    expect(await currentStaff()).toBeNull();
  });

  it("refuses when the lookup says the staff table is not ready, or fails", async () => {
    await getStorage().staffCreate!(rec());
    await createStaffSession({ id: ID });
    const spy = vi.spyOn(getStorage(), "staffGet").mockRejectedValue(new StaffStorageError("not_ready"));
    expect(await currentStaff()).toBeNull();
    spy.mockRejectedValue(new Error("boom"));
    expect(await currentStaff()).toBeNull();
    spy.mockRestore();
    expect(await currentStaff()).not.toBeNull();
  });

  it("staffApiGuard gives { staff } or a 401", async () => {
    const no = await staffApiGuard();
    expect(no).toBeInstanceOf(Response);
    expect((no as Response).status).toBe(401);
    expect(await (no as Response).json()).toEqual({ ok: false, error: "unauthorized" });
    await getStorage().staffCreate!(rec());
    await createStaffSession({ id: ID });
    const yes = await staffApiGuard();
    expect(yes).not.toBeInstanceOf(Response);
    expect((yes as { staff: { id: string } }).staff.id).toBe(ID);
  });

  it("requireStaff redirects to /team/login without a session and returns the account with one", async () => {
    await expect(requireStaff()).rejects.toThrow("NEXT_REDIRECT /team/login");
    await getStorage().staffCreate!(rec());
    await createStaffSession({ id: ID });
    expect((await requireStaff()).name).toBe("أحمد");
  });

  it("destroyStaffSession clears the cookie", async () => {
    await getStorage().staffCreate!(rec());
    await createStaffSession({ id: ID });
    await destroyStaffSession();
    expect(jar.has("sf_staff")).toBe(false);
    expect(await currentStaff()).toBeNull();
  });
});
