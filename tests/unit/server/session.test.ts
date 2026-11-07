import { describe, expect, it, vi } from "vitest";
import { SECRET, setupEnv } from "./helpers";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) =>
      jar.has(k) ? { name: k, value: jar.get(k)! } : undefined,
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(),
}));

import {
  checkPassword,
  createSession,
  destroySession,
  verifySession,
} from "@/lib/auth/session";
import { signToken, verifyToken } from "@/lib/auth/token";

describe("admin session", () => {
  it("signs and verifies tokens, rejects expired / wrong-secret / garbage", async () => {
    const now = Date.now();
    const token = await signToken(SECRET, now);
    expect(await verifyToken(token, SECRET, now + 1000)).toBe(true);
    expect(await verifyToken(token, SECRET, now + 8 * 24 * 3600 * 1000)).toBe(
      false,
    );
    expect(await verifyToken(token, "y".repeat(40), now)).toBe(false);
    expect(await verifyToken("garbage", SECRET)).toBe(false);
    expect(await verifyToken(undefined, SECRET)).toBe(false);
  });

  it("createSession / verifySession / destroySession via cookie", async () => {
    setupEnv();
    expect(await verifySession()).toBe(false);
    await createSession();
    expect(jar.has("ep_admin")).toBe(true);
    expect(await verifySession()).toBe(true);
    await destroySession();
    expect(await verifySession()).toBe(false);
  });

  it("compares passwords", () => {
    expect(checkPassword("abc", "abc")).toBe(true);
    expect(checkPassword("abd", "abc")).toBe(false);
    expect(checkPassword("", "abc")).toBe(false);
  });
});
