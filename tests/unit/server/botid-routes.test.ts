import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupEnv } from "./helpers";

const botBlocked = vi.hoisted(() => vi.fn());
vi.mock("@/lib/botid", () => ({ botBlocked }));

import { POST as orders } from "@/app/api/orders/route";
import { POST as upload } from "@/app/api/upload/route";
import { POST as brief } from "@/app/api/design/brief/route";
import { POST as generate } from "@/app/api/design/generate/route";

let n = 0;
const req = (path: string) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.7.0.${++n}` },
    body: "{}",
  });

beforeEach(() => {
  setupEnv();
  botBlocked.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

// POST /api/upload/direct is covered in upload-direct-route.test.ts (it needs a direct-upload storage).
describe("routes refuse with an existing code when botBlocked says so", () => {
  it("POST /api/orders: captcha_failed, 403", async () => {
    botBlocked.mockResolvedValue(true);
    const res = await orders(req("/api/orders"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "captcha_failed" });
    expect(botBlocked).toHaveBeenCalledWith("/api/orders");
  });

  it("POST /api/upload: rate_limited, 429", async () => {
    botBlocked.mockResolvedValue(true);
    const res = await upload(req("/api/upload"));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ ok: false, error: "rate_limited" });
    expect(botBlocked).toHaveBeenCalledWith("/api/upload");
  });

  it("POST /api/design/brief: rate_limited, 429", async () => {
    botBlocked.mockResolvedValue(true);
    const res = await brief(req("/api/design/brief"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: "rate_limited" });
    expect(botBlocked).toHaveBeenCalledWith("/api/design/brief");
  });

  it("POST /api/design/generate: blocked, 403", async () => {
    botBlocked.mockResolvedValue(true);
    const res = await generate(req("/api/design/generate"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "blocked" });
    expect(botBlocked).toHaveBeenCalledWith("/api/design/generate");
  });

  it("a request that is not blocked reaches the normal handling", async () => {
    botBlocked.mockResolvedValue(false);
    const res = await orders(req("/api/orders"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });
});
