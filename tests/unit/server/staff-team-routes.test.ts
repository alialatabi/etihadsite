import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupEnv } from "./helpers";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Error("NEXT_REDIRECT " + u);
  },
}));
vi.mock("@/lib/ai/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/service")>();
  return {
    ...actual,
    runBrief: vi.fn(async () => ({ body: { ok: false, error: "unavailable" } })),
    runGenerate: vi.fn(async () => ({ body: { ok: false, error: "unavailable" } })),
  };
});

import { POST as briefRoute, maxDuration as briefMax } from "@/app/api/team/design/brief/route";
import { POST as generateRoute, maxDuration as generateMax } from "@/app/api/team/design/generate/route";
import { runBrief, runGenerate, type AiActor } from "@/lib/ai/service";
import { createStaffSession } from "@/lib/auth/staff-session";
import { getStorage } from "@/lib/storage";

const ID = "st_abcdefgh12";

async function makeStaff(active = true) {
  const now = new Date().toISOString();
  await getStorage().staffCreate!({
    id: ID,
    name: "أحمد",
    phone: "9647701234567",
    active,
    createdAt: now,
    passwordChangedAt: now,
    passwordHash: "scrypt$16384$8$1$AAAA$BBBB",
  });
}

const post = (route: typeof briefRoute, path: string) =>
  route(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
      body: JSON.stringify({ any: "thing" }),
    }),
  );

const ROUTES = [
  ["brief", briefRoute, "/api/team/design/brief"],
  ["generate", generateRoute, "/api/team/design/generate"],
] as const;

beforeEach(() => {
  setupEnv();
  jar.clear();
  vi.mocked(runBrief).mockClear();
  vi.mocked(runGenerate).mockClear();
});

describe("/api/team/design/*", () => {
  it("keeps the literal maxDuration of the customer routes", () => {
    expect(briefMax).toBe(60);
    expect(generateMax).toBe(300);
  });

  it.each(ROUTES)("%s answers 401 without a session and never runs the AI", async (_n, route, path) => {
    const res = await post(route, path);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(runBrief).not.toHaveBeenCalled();
    expect(runGenerate).not.toHaveBeenCalled();
  });

  it("brief runs with the staff actor of the logged-in account", async () => {
    await makeStaff();
    await createStaffSession({ id: ID });
    const res = await post(briefRoute, "/api/team/design/brief");
    // The stubbed service answers 'unavailable'; the route maps it like the customer route does (not a 401).
    expect(res.status).not.toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unavailable" });
    expect(runBrief).toHaveBeenCalledTimes(1);
    const actor = vi.mocked(runBrief).mock.calls[0][2] as AiActor & { staffId?: string; guard?: string };
    expect(actor.staffId).toBe(ID);
    expect(actor.guard).toBe("staff");
    expect(actor.identify(new Request("http://localhost/x"))).toEqual({ ip: "", ipKey: `staff:${ID}` });
  });

  it("generate runs with the same actor as its 5th argument and a number as its 4th", async () => {
    await makeStaff();
    await createStaffSession({ id: ID });
    await post(generateRoute, "/api/team/design/generate");
    expect(runGenerate).toHaveBeenCalledTimes(1);
    const args = vi.mocked(runGenerate).mock.calls[0];
    expect(typeof args[3]).toBe("number");
    const actor = args[4] as AiActor & { staffId?: string; guard?: string };
    expect(actor.staffId).toBe(ID);
    expect(actor.guard).toBe("staff");
    expect(actor.identify(new Request("http://localhost/x"))).toEqual({ ip: "", ipKey: `staff:${ID}` });
  });

  it.each(ROUTES)("%s answers 401 for a disabled account", async (_n, route, path) => {
    await makeStaff();
    await createStaffSession({ id: ID });
    await getStorage().staffUpdate!(ID, { active: false });
    const res = await post(route, path);
    expect(res.status).toBe(401);
    expect(runBrief).not.toHaveBeenCalled();
    expect(runGenerate).not.toHaveBeenCalled();
  });
});
