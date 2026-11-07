import { afterEach, describe, expect, it } from "vitest";
import { getAdminEnv, getOrderEnv } from "@/lib/env";

const KEYS = ["ADMIN_PASSWORD", "SESSION_SECRET", "TRUST_PROXY"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("env", () => {
  it("getOrderEnv needs no admin secrets and defaults TRUST_PROXY to 0", () => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    delete process.env.TRUST_PROXY;
    expect(getOrderEnv().TRUST_PROXY).toBe(0);
    process.env.TRUST_PROXY = "2";
    expect(getOrderEnv().TRUST_PROXY).toBe(2);
    expect(() => getAdminEnv()).toThrow();
  });

  it("rejects placeholder and short admin secrets", () => {
    const good = "k".repeat(40);
    process.env.SESSION_SECRET = good;
    process.env.ADMIN_PASSWORD = "admin1234";
    expect(getAdminEnv().ADMIN_PASSWORD).toBe("admin1234");
    for (const pw of ["change-me", "change-me-please", "short"]) {
      process.env.ADMIN_PASSWORD = pw;
      expect(() => getAdminEnv()).toThrow();
    }
    process.env.ADMIN_PASSWORD = "admin1234";
    process.env.SESSION_SECRET = "change-me-to-a-long-random-string";
    expect(() => getAdminEnv()).toThrow();
  });
});
