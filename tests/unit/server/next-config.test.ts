import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";
import config, { securityHeaders } from "../../../next.config";

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
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    expect(rules[0].headers).toEqual(securityHeaders);
  });
});
