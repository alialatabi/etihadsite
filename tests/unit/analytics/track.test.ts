import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsEvent } from "@/lib/types";
import { setupEnv } from "../server/helpers";

const recordEvent = vi.fn();
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({ recordEvent: (...a: unknown[]) => recordEvent(...a) }),
}));

import { POST } from "@/app/api/track/route";
import { visitorHash } from "@/lib/analytics/server";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148";

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://softy.iq/api/track", {
    method: "POST",
    headers: { "user-agent": UA, "x-forwarded-for": "1.2.3.4", host: "softy.iq", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  setupEnv();
  recordEvent.mockReset().mockResolvedValue(undefined);
});

describe("visitorHash", () => {
  it("is stable within a day and changes across days", () => {
    const r = req({});
    const a = visitorHash(r, new Date("2026-11-10T08:00:00Z"));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(visitorHash(r, new Date("2026-11-10T15:00:00Z"))).toBe(a);
    expect(visitorHash(r, new Date("2026-11-11T08:00:00Z"))).not.toBe(a);
  });
  it("differs per ip", () => {
    const d = new Date("2026-11-10T08:00:00Z");
    expect(visitorHash(req({}), d)).not.toBe(visitorHash(req({}, { "x-forwarded-for": "5.6.7.8" }), d));
  });
  describe("blank SESSION_SECRET", () => {
    afterEach(() => vi.unstubAllEnvs());
    const d = new Date("2026-11-10T08:00:00Z");
    const devHash = createHash("sha256")
      .update(`2026-11-10|1.2.3.4|${UA}|softy-dev-analytics-salt`)
      .digest("hex")
      .slice(0, 16);

    it("does not use the public dev salt in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("SESSION_SECRET", "");
      const r = req({});
      const h = visitorHash(r, d);
      expect(h).toMatch(/^[0-9a-f]{16}$/);
      expect(h).not.toBe(devHash);
      // Stable within one process.
      expect(visitorHash(r, d)).toBe(h);
    });
    it("keeps the dev salt outside production", () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("SESSION_SECRET", "");
      expect(visitorHash(req({}), d)).toBe(devHash);
    });
  });
});

describe("POST /api/track", () => {
  it("rejects a bad type", async () => {
    expect((await POST(req({ type: "order", path: "/" }))).status).toBe(400);
    expect((await POST(req({ type: "pageview", path: "nope" }))).status).toBe(400);
    expect((await POST(req("{bad"))).status).toBe(400);
    expect(recordEvent).not.toHaveBeenCalled();
  });
  it("ignores admin paths and bots", async () => {
    expect((await POST(req({ type: "pageview", path: "/admin/orders" }))).status).toBe(204);
    expect((await POST(req({ type: "pageview", path: "/" }, { "user-agent": "Googlebot/2.1" }))).status).toBe(204);
    expect(recordEvent).not.toHaveBeenCalled();
  });
  it("records a pageview with classified source only", async () => {
    const res = await POST(
      req(
        { type: "pageview", path: "/", referrer: "https://l.instagram.com/?u=secret" },
        { "x-vercel-ip-city": encodeURIComponent("Baghdad"), "x-vercel-ip-country": "IQ" },
      ),
    );
    expect(res.status).toBe(204);
    const ev = recordEvent.mock.calls[0][0] as AnalyticsEvent;
    expect(ev).toMatchObject({ type: "pageview", path: "/", source: "instagram", device: "mobile", city: "Baghdad", country: "IQ" });
    expect(JSON.stringify(ev)).not.toContain("secret");
    expect(JSON.stringify(ev)).not.toContain("1.2.3.4");
  });
  it("never throws when storage fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    recordEvent.mockRejectedValue(new Error("db down"));
    expect((await POST(req({ type: "step", path: "/", step: "size" }))).status).toBe(204);
  });
  it("records exactly 300 of 301 beacons from one visitor in an hour", async () => {
    for (let i = 0; i < 301; i++) {
      expect((await POST(req({ type: "step", path: "/", step: "shape" }))).status).toBe(204);
    }
    expect(recordEvent).toHaveBeenCalledTimes(300);
  });
  it("a script that rotates the User-Agent is still stopped per address: 600 of 650 are recorded, all answer 204", async () => {
    for (let i = 0; i < 650; i++) {
      const res = await POST(req({ type: "step", path: "/", step: "shape" }, { "user-agent": `Mozilla/5.0 (X11; Linux) Chrome/${i}.0 Safari/537.36` }));
      expect(res.status).toBe(204);
    }
    expect(recordEvent).toHaveBeenCalledTimes(600);
    // Another address is not affected.
    await POST(req({ type: "step", path: "/", step: "shape" }, { "x-forwarded-for": "9.9.9.9" }));
    expect(recordEvent).toHaveBeenCalledTimes(601);
  });
  it("an invalid body is still 400 and does not spend the address's allowance", async () => {
    for (let i = 0; i < 700; i++) expect((await POST(req("{bad"))).status).toBe(400);
    expect((await POST(req({ type: "step", path: "/", step: "shape" }))).status).toBe(204);
    expect(recordEvent).toHaveBeenCalledTimes(1);
  });
});
