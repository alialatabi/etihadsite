import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupEnv } from "./helpers";

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
vi.mock("@/lib/auth/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/password")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

import { staffLoginAction, staffLogoutAction } from "@/app/team/actions";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { limiters } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { StaffStorageError } from "@/lib/storage/staff-errors";

const ID = "st_abcdefgh12";
const PHONE = "9647701234567";
const PASSWORD = "secret-pass-1";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

/** Runs the action and returns where it redirected to. */
async function login(o: Record<string, string>, ip = "10.0.0.1"): Promise<string> {
  reqHeaders.set("x-forwarded-for", ip);
  try {
    await staffLoginAction(form(o));
  } catch (e) {
    const m = /^NEXT_REDIRECT (.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  throw new Error("no redirect");
}

async function makeStaff(over: { active?: boolean } = {}) {
  const now = new Date().toISOString();
  await getStorage().staffCreate!({
    id: ID,
    name: "أحمد",
    phone: PHONE,
    active: over.active ?? true,
    createdAt: now,
    passwordChangedAt: now,
    passwordHash: await hashPassword(PASSWORD),
  });
}

beforeEach(() => {
  setupEnv();
  jar.clear();
  vi.mocked(verifyPassword).mockClear();
});

describe("staffLoginAction", () => {
  it("logs in: redirects to /team, sets the session cookie and the last login time", async () => {
    await makeStaff();
    expect(await login({ phone: PHONE, password: PASSWORD })).toBe("/team");
    expect(jar.has("sf_staff")).toBe(true);
    expect((await getStorage().staffGet!(ID))?.lastLoginAt).toBeTruthy();
  });

  it("accepts the phone written differently and Arabic-Indic digits in the password", async () => {
    await makeStaff();
    expect(await login({ phone: "0770 123 4567", password: PASSWORD })).toBe("/team");
    jar.clear();
    expect(await login({ phone: "+964 770 123 4567", password: "secret-pass-١" })).toBe("/team");
  });

  it.each([
    ["a wrong password", { phone: PHONE, password: "nope-nope-1" }, true],
    ["an unknown phone", { phone: "07709999999", password: PASSWORD }, true],
    ["a disabled account", { phone: PHONE, password: PASSWORD }, false],
    ["a phone that is not a phone", { phone: "abc", password: PASSWORD }, true],
    ["a missing password", { phone: PHONE }, true],
    ["a missing phone", { password: PASSWORD }, true],
  ])("%s gives the one generic error and sets no cookie", async (_n, body, active) => {
    await makeStaff({ active });
    expect(await login(body)).toBe("/team/login?error=1");
    expect(jar.has("sf_staff")).toBe(false);
  });

  it("verifies a password even for an unknown phone (flat timing)", async () => {
    await makeStaff();
    await login({ phone: "07709999999", password: PASSWORD });
    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });

  it("the 11th try from one IP is rate limited", async () => {
    await makeStaff();
    for (let i = 0; i < 10; i++) expect(await login({ phone: PHONE, password: "wrong-one-1" }, "10.9.9.9")).not.toContain("rate");
    expect(await login({ phone: PHONE, password: PASSWORD }, "10.9.9.9")).toBe("/team/login?error=rate");
  });

  it("the 11th try for one phone is rate limited even from different IPs", async () => {
    await makeStaff();
    for (let i = 0; i < 10; i++) expect(await login({ phone: PHONE, password: "wrong-one-1" }, `10.8.8.${i + 1}`)).toBe("/team/login?error=1");
    expect(await login({ phone: PHONE, password: PASSWORD }, "10.8.8.200")).toBe("/team/login?error=rate");
  });

  it("a staff login flood never touches the admin login limiter", async () => {
    await makeStaff();
    for (let i = 0; i < 12; i++) await login({ phone: PHONE, password: "wrong-one-1" }, "10.7.7.7");
    expect(limiters().login.check("10.7.7.7").ok).toBe(true);
  });

  it("answers 'unavailable' when the staff table is not ready", async () => {
    vi.spyOn(getStorage(), "staffByPhone").mockRejectedValue(new StaffStorageError("not_ready"));
    expect(await login({ phone: PHONE, password: PASSWORD })).toBe("/team/login?error=unavailable");
    vi.restoreAllMocks();
  });

  it("rethrows an unexpected storage error (nothing is hidden behind the generic message)", async () => {
    vi.spyOn(getStorage(), "staffByPhone").mockRejectedValue(new Error("db down"));
    await expect(staffLoginAction(form({ phone: PHONE, password: PASSWORD }))).rejects.toThrow("db down");
    vi.restoreAllMocks();
  });

  it("never puts the phone or the password into the redirect URL", async () => {
    await makeStaff();
    const to = await login({ phone: PHONE, password: "wrong-one-1" });
    expect(to).not.toContain(PHONE);
    expect(to).not.toContain("wrong-one-1");
  });
});

describe("staffLogoutAction", () => {
  it("clears the cookie and redirects to the login page", async () => {
    jar.set("sf_staff", "x");
    await expect(staffLogoutAction()).rejects.toThrow("NEXT_REDIRECT /team/login");
    expect(jar.has("sf_staff")).toBe(false);
  });
});
