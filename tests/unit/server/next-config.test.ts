import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";
import config, { securityHeaders } from "../../../next.config";

const BOTID_PREFIX = /^\/[0-9a-f-]{36}\/[0-9a-f-]{36}/;

describe("next.config security headers", () => {
  it("lists exactly the three site-wide headers, with frame-ancestors as the only CSP directive", () => {
    const map = Object.fromEntries(securityHeaders.map((h) => [h.key, h.value]));
    expect(map).toEqual({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
    });
    // proxy.ts owns the staff page's no-referrer; this file must not set it.
    expect(securityHeaders.some((h) => h.key.toLowerCase() === "referrer-policy")).toBe(false);
  });

  it("applies one rule to every path (no /staff-scoped rule) and drops X-Powered-By", async () => {
    const resolved = config as NextConfig;
    expect(resolved.poweredByHeader).toBe(false);
    const rules = await resolved.headers!();
    const everyPath = rules.filter((r) => r.source === "/:path*");
    expect(everyPath).toHaveLength(1);
    expect(everyPath[0].headers).toEqual(securityHeaders);
    // The only other rule is BotID's, under its own random prefix.
    for (const r of rules.filter((r) => r.source !== "/:path*")) expect(r.source).toMatch(BOTID_PREFIX);
  });

  it("BotID adds only rewrites under its own prefix, none that can touch /staff or any real route", async () => {
    const resolved = config as NextConfig;
    const rw = await resolved.rewrites!();
    const list = Array.isArray(rw) ? rw : [...(rw.beforeFiles ?? []), ...(rw.afterFiles ?? []), ...(rw.fallback ?? [])];
    const botid = list.filter((r) => BOTID_PREFIX.test(r.source));
    expect(botid).toHaveLength(2);
    expect(list.filter((r) => /staff|admin|api/.test(r.source))).toEqual([]);
    for (const r of botid) expect(r.destination).toMatch(/^https:\/\/api\.vercel\.com\/bot-protection\//);
  });
});
