import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import { POST as briefRoute } from "@/app/api/design/brief/route";
import { AI_BRIEF_PER_IP } from "@/lib/ai/config";
import { briefToken } from "@/lib/ai/service";
import { shopDayKey } from "@/lib/shop-time";
import { getStorage } from "@/lib/storage";
import { setupEnv } from "./helpers";
import { OPENAI_BASE, briefResponse, jsonResponse, stubOpenAi } from "./ai-helpers";

type Brief =
  | { ok: true; lines: string[]; fixes: { from: string; to: string }[]; visualDescription: string; briefToken: string }
  | { ok: false; error: string };

let ipSeq = 0;
const nextIp = () => `10.1.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

function call(body: unknown, ip = nextIp()) {
  return briefRoute(
    new Request("http://localhost/api/design/brief", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}
const read = async (res: Response) => (await res.json()) as Brief;

const BODY = { idea: "ستيكر دائري مكتوب عليه اهلا وسهلا وبي ورد", shape: "circle", widthUm: 50000, heightUm: 50000 };

async function briefUsage(): Promise<number> {
  const rows = await getStorage().aiUsage!(shopDayKey(new Date()));
  return rows.filter((r) => r.kind === "brief").reduce((n, r) => n + r.count, 0);
}

beforeEach(() => {
  setupEnv();
  vi.stubEnv("OPENAI_API_KEY", "sk-test-brief");
  vi.stubEnv("OPENAI_BASE_URL", OPENAI_BASE);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/design/brief", () => {
  it("brief returns lines, fixes and visualDescription", async () => {
    const calls = stubOpenAi(() =>
      briefResponse({
        printed_text: ["أهلاً وسهلاً"],
        visual_description: "A round sticker with roses.",
        spelling_fixes: [{ from: "اهلا", to: "أهلاً" }],
      }),
    );
    const res = await call(BODY);
    expect(res.status).toBe(200);
    const out = await read(res);
    expect(out).toEqual({
      ok: true,
      lines: ["أهلاً وسهلاً"],
      fixes: [{ from: "اهلا", to: "أهلاً" }],
      visualDescription: "A round sticker with roses.",
      briefToken: briefToken("A round sticker with roses."),
    });
    expect(calls.map((c) => c.path)).toEqual(["/responses"]);
    // The idea is sent as data (input), never inside the instructions.
    const sent = calls[0].body as { input: string; instructions: string };
    expect(sent.input).toBe(BODY.idea);
    expect(sent.instructions).not.toContain(BODY.idea);
    expect(await briefUsage()).toBe(1);
  });

  it("brief rejects idea over 1000 chars", async () => {
    const calls = stubOpenAi(() => jsonResponse({}));
    const res = await call({ ...BODY, idea: "ا".repeat(1001) });
    expect(res.status).toBe(400);
    expect(await read(res)).toEqual({ ok: false, error: "invalid_request" });
    expect(calls).toHaveLength(0);
  });

  it("brief rejects a malformed body", async () => {
    stubOpenAi(() => jsonResponse({}));
    for (const bad of [{ ...BODY, idea: "   " }, { ...BODY, shape: "star" }, { ...BODY, widthUm: 1.5 }, {}]) {
      expect(await read(await call(bad))).toEqual({ ok: false, error: "invalid_request" });
    }
    const res = await briefRoute(
      new Request("http://localhost/api/design/brief", { method: "POST", body: "{not json" }),
    );
    expect(await read(res)).toEqual({ ok: false, error: "invalid_request" });
  });

  it("brief unavailable without key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const calls = stubOpenAi(() => jsonResponse({}));
    const res = await call(BODY);
    expect(res.status).toBe(503);
    expect(await read(res)).toEqual({ ok: false, error: "unavailable" });
    expect(calls).toHaveLength(0);
  });

  it("brief unavailable when settings.ai.enabled is false", async () => {
    await getStorage().saveSettings({ ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, enabled: false } });
    const calls = stubOpenAi(() => jsonResponse({}));
    expect(await read(await call(BODY))).toEqual({ ok: false, error: "unavailable" });
    expect(calls).toHaveLength(0);
  });

  it("brief drops fixes outside printed lines", async () => {
    stubOpenAi(() =>
      briefResponse({
        printed_text: ["كافيه گلبهار"],
        visual_description: "A café sticker.",
        spelling_fixes: [
          { from: "كافية", to: "كافيه" },
          { from: "جاي", to: "چاي" },
          { from: "x", to: "" },
        ],
      }),
    );
    const out = await read(await call(BODY));
    expect(out.ok && out.fixes).toEqual([{ from: "كافية", to: "كافيه" }]);
  });

  it("brief cleans lines and the visual description, and signs the cleaned description", async () => {
    stubOpenAi(() =>
      briefResponse({
        printed_text: ["«أهلاً»\nوسهلاً", "   ", "ب".repeat(80)],
        visual_description: "  Roses «and»\n\n a\u0007 cake. " + "x".repeat(700),
        spelling_fixes: [],
      }),
    );
    const out = await read(await call(BODY));
    if (!out.ok) throw new Error(out.error);
    expect(out.lines).toEqual(["أهلاً وسهلاً", "ب".repeat(60)]);
    expect(out.visualDescription.startsWith("Roses and a cake. xxx")).toBe(true);
    expect(out.visualDescription.length).toBe(600);
    expect(out.briefToken).toBe(briefToken(out.visualDescription));
  });

  it("brief answers failed and releases the use when OpenAI fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubOpenAi(() => jsonResponse({ error: { code: "server_error" } }, 500));
    const res = await call(BODY);
    expect(res.status).toBe(502);
    expect(await read(res)).toEqual({ ok: false, error: "failed" });
    expect(await briefUsage()).toBe(0);
  });

  it("brief answers failed (and releases) when the description is empty", async () => {
    stubOpenAi(() => briefResponse({ printed_text: ["x"], visual_description: " «» \n", spelling_fixes: [] }));
    expect(await read(await call(BODY))).toEqual({ ok: false, error: "failed" });
    expect(await briefUsage()).toBe(0);
  });

  it("brief answers rate_limited past the stored per-IP daily count", async () => {
    stubOpenAi(() => briefResponse({ printed_text: [], visual_description: "Stars.", spelling_fixes: [] }));
    const ip = "10.9.9.9";
    for (let i = 0; i < AI_BRIEF_PER_IP; i++) expect((await read(await call(BODY, ip))).ok).toBe(true);
    const res = await call(BODY, ip);
    expect(res.status).toBe(429);
    expect(await read(res)).toEqual({ ok: false, error: "rate_limited" });
  });

  it("brief answers rate_limited for a blocked ip", async () => {
    const { aiIpKey } = await import("@/lib/ai/ip");
    const calls = stubOpenAi(() => jsonResponse({}));
    await getStorage().aiBlock!(aiIpKey("10.8.8.8"), "10.8.8.8");
    expect(await read(await call(BODY, "10.8.8.8"))).toEqual({ ok: false, error: "rate_limited" });
    expect(calls).toHaveLength(0);
  });

  it("brief: the in-memory limiter stops a burst before the stored counter", async () => {
    stubOpenAi(() => briefResponse({ printed_text: [], visual_description: "Stars.", spelling_fixes: [] }));
    // Fill the in-memory limiter (30/h per ip) without touching the stored counter.
    const { limiters } = await import("@/lib/rate-limit");
    for (let i = 0; i < 30; i++) limiters().brief.check("10.7.7.7");
    const res = await call(BODY, "10.7.7.7");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(await briefUsage()).toBe(0);
  });
});
