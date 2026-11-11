import { describe, expect, it } from "vitest";
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

  it("keeps a complete limiter set and adds the track limiter to one that predates it", () => {
    const slot = globalThis as { __epLimiters?: unknown };
    const prev = process.env.TRUST_PROXY;
    try {
      slot.__epLimiters = undefined;
      process.env.TRUST_PROXY = "1";
      const fresh = limiters();
      expect(limiters()).toBe(fresh);
      // What a dev server that was started before `track` existed still holds after a hot reload.
      const upload = createRateLimiter({ limit: 20, windowMs: 1000 });
      const order = createRateLimiter({ limit: 5, windowMs: 1000 });
      const log = createRateLimiter({ limit: 60, windowMs: 1000 });
      const login = createRateLimiter({ limit: 10, windowMs: 1000 });
      const stale: Record<string, unknown> = { mode: fresh.mode, upload, order, log, login };
      slot.__epLimiters = stale;
      const patched = limiters();
      expect(patched).toBe(stale);
      expect(patched.upload).toBe(upload);
      expect(patched.order).toBe(order);
      expect(patched.log).toBe(log);
      expect(patched.login).toBe(login);
      expect(patched.mode).toBe(fresh.mode);
      expect(patched.track).toBeDefined();
      expect(patched.track).not.toBe(fresh.track);
      expect(patched.track.check("visitor").ok).toBe(true);
      expect(limiters()).toBe(patched);
      expect(limiters().track).toBe(patched.track);
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prev;
      slot.__epLimiters = undefined;
    }
  });

  it("keeps the same track limiter across a TRUST_PROXY mode change", () => {
    const slot = globalThis as { __epLimiters?: unknown };
    const prev = process.env.TRUST_PROXY;
    try {
      slot.__epLimiters = undefined;
      process.env.TRUST_PROXY = "1";
      const before = limiters();
      for (let i = 0; i < 300; i++) expect(before.track.check("visitor").ok).toBe(true);
      expect(before.track.check("visitor").ok).toBe(false);
      process.env.TRUST_PROXY = "0";
      const after = limiters();
      expect(after).not.toBe(before);
      expect(after.mode).toBe(0);
      expect(after.order).not.toBe(before.order);
      expect(after.track).toBe(before.track);
      // The 300 hits from before the change still count.
      expect(after.track.check("visitor").ok).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prev;
      slot.__epLimiters = undefined;
    }
  });
});
