import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/purge/route";
import { DAY_MS, shopDayKey } from "@/lib/shop-time";
import { setupEnv } from "./helpers";

const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/monitoring/report", () => ({ reportError }));

const SECRET = "cron-secret-for-tests-0123456789";
const call = (auth?: string, query = "") =>
  GET(new Request(`http://localhost/api/cron/purge${query}`, { headers: auth ? { authorization: auth } : {} }));

describe("GET /api/cron/purge", () => {
  beforeEach(() => {
    reportError.mockReset();
    setupEnv({ CRON_SECRET: SECRET });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("401 without, or with a wrong, bearer secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
  });

  it("401 when CRON_SECRET is unset or too short (never open by default)", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer ")).status).toBe(401);
    process.env.CRON_SECRET = "short";
    expect((await call("Bearer short")).status).toBe(401);
  });

  it("reports a missing or short CRON_SECRET once per call, with a fixed message (still 401)", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer x")).status).toBe(401);
    expect(reportError).toHaveBeenCalledTimes(1);
    process.env.CRON_SECRET = "short-secret-xx";
    expect((await call("Bearer short-secret-xx")).status).toBe(401);
    expect(reportError).toHaveBeenCalledTimes(2);
    const [err, ctx] = reportError.mock.calls[1] as [Error, { where: string }];
    expect(err.message).toBe("CRON_SECRET is missing or too short: the retention purge cannot run");
    expect(ctx.where).toBe("cron.purge.auth");
  });

  it("does not report a wrong bearer when the secret itself is fine", async () => {
    expect((await call("Bearer nope")).status).toBe(401);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("runs the purge with the right secret (dry run reports only)", async () => {
    const res = await call(`Bearer ${SECRET}`, "?dry=1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, dryRun: true, removed: 0 });
  });

  it("purges AI usage counters older than 400 days (dry run keeps them)", async () => {
    const { getStorage } = await import("@/lib/storage");
    const s = getStorage();
    const old = shopDayKey(new Date(Date.now() - 401 * DAY_MS));
    const recent = shopDayKey(new Date(Date.now() - 399 * DAY_MS));
    for (const day of [old, recent]) await s.aiReserve!({ day, ipKey: "k1", ip: "1.2.3.4", kind: "image", perIpLimit: 5, siteLimit: 300 });
    await call(`Bearer ${SECRET}`, "?dry=1");
    expect((await s.aiUsage!("2000-01-01")).map((r) => r.day)).toEqual([old, recent]);
    expect((await call(`Bearer ${SECRET}`)).status).toBe(200);
    expect((await s.aiUsage!("2000-01-01")).map((r) => r.day)).toEqual([recent]);
  });
});
