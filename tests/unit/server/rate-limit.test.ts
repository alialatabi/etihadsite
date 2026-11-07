import { describe, expect, it } from "vitest";
import { DISPLAY_NO_ALPHABET } from "@/config/defaults";
import { makeDisplayNo, pdfFileNameFor } from "@/lib/display-no";
import { clientIp, createRateLimiter, limiters } from "@/lib/rate-limit";

describe("rate limiter", () => {
  it("blocks after the limit and recovers when the window slides", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
    expect(rl.check("a").ok).toBe(true);
    t = 100;
    expect(rl.check("a").ok).toBe(true);
    t = 200;
    expect(rl.check("a").ok).toBe(true);
    t = 300;
    const blocked = rl.check("a");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(1);
    expect(rl.check("b").ok).toBe(true);
    t = 1001;
    expect(rl.check("a").ok).toBe(true); // the hit at t=0 slid out
    expect(rl.check("a").ok).toBe(false);
  });

  it("ignores x-forwarded-for entirely when TRUST_PROXY=0", () => {
    const a = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    const b = new Request("http://x", {
      headers: { "x-forwarded-for": "5.6.7.8" },
    });
    expect(clientIp(a, 0)).toBe(clientIp(b, 0));
    expect(clientIp(a, 0)).toBe("global");
  });

  it("takes the n-th value from the END of x-forwarded-for when trusting n hops", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "spoofed, 1.2.3.4, 10.0.0.1" },
    });
    expect(clientIp(req, 1)).toBe("10.0.0.1");
    expect(clientIp(req, 2)).toBe("1.2.3.4");
    expect(clientIp(req, 3)).toBe("spoofed");
    expect(clientIp(req, 9)).toBe("global");
    expect(clientIp(new Request("http://x"), 1)).toBe("global");
  });

  it("scales limits x20 without a trusted proxy", () => {
    const prev = process.env.TRUST_PROXY;
    try {
      (globalThis as { __epLimiters?: unknown }).__epLimiters = undefined;
      process.env.TRUST_PROXY = "0";
      const l0 = limiters();
      for (let i = 0; i < 100; i++)
        expect(l0.order.check("global").ok).toBe(true);
      expect(l0.order.check("global").ok).toBe(false);
      process.env.TRUST_PROXY = "1";
      const l1 = limiters();
      for (let i = 0; i < 5; i++) expect(l1.order.check("ip").ok).toBe(true);
      expect(l1.order.check("ip").ok).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prev;
      (globalThis as { __epLimiters?: unknown }).__epLimiters = undefined;
    }
  });
});

describe("displayNo", () => {
  it("has EP-YYMMDD-XXXX shape with the Baghdad date and safe alphabet", () => {
    const no = makeDisplayNo(new Date("2025-11-07T21:30:00Z")); // 00:30 on the 8th in Baghdad (UTC+3)
    expect(no).toMatch(/^EP-\d{6}-[A-Z2-9]{4}$/);
    expect(no.startsWith("EP-251108-")).toBe(true);
    for (const ch of no.slice(-4)) expect(DISPLAY_NO_ALPHABET).toContain(ch);
    expect(makeDisplayNo(new Date("2025-11-07T10:00:00Z"), () => 0)).toBe(
      "EP-251107-2222",
    );
  });

  it("builds an ASCII pdf file name", () => {
    const n = pdfFileNameFor(
      "EP-251107-ABCD",
      { shape: "rect", widthUm: 42400, heightUm: 30000 },
      20,
    );
    expect(n).toBe("EP-251107-ABCD_rect-42.4x30mm_x20.pdf");
    expect(n).toMatch(/^[\x20-\x7e]+$/);
  });
});
