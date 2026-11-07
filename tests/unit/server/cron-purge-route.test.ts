import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/purge/route";
import { setupEnv } from "./helpers";

const SECRET = "cron-secret-for-tests-0123456789";
const call = (auth?: string, query = "") =>
  GET(new Request(`http://localhost/api/cron/purge${query}`, { headers: auth ? { authorization: auth } : {} }));

describe("GET /api/cron/purge", () => {
  beforeEach(() => {
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

  it("runs the purge with the right secret (dry run reports only)", async () => {
    const res = await call(`Bearer ${SECRET}`, "?dry=1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, dryRun: true, removed: 0 });
  });
});
