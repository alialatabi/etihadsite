import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as briefRoute } from "@/app/api/design/brief/route";
import { POST as generateRoute } from "@/app/api/design/generate/route";
import { AI_BRIEF_MODEL, AI_OPENAI_TIMEOUT_MS } from "@/lib/ai/config";
import { briefToken, instructionsToken, runGenerate, staffActor } from "@/lib/ai/service";
import { shopDayKey } from "@/lib/shop-time";
import { getStorage } from "@/lib/storage";
import { setupEnv } from "./helpers";
import { OPENAI_BASE, imageResponse, jsonResponse, opaquePng, stubOpenAi } from "./ai-helpers";

type Gen = { ok: true; uploadId: string } | { ok: false; error: string };

let ipSeq = 0;
const nextIp = () => `10.7.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

function call(body: unknown, ip = nextIp()) {
  return generateRoute(
    new Request("http://localhost/api/design/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}
const read = async (res: Response) => (await res.json()) as Gen;

const VD = "A round sticker with red roses and a small cake.";
const I = "ستيكر بيه ورد أحمر";
const EN = "Red roses, the text centred.";

function body(over: Record<string, unknown> = {}) {
  const visualDescription = (over.visualDescription as string | undefined) ?? VD;
  return {
    shape: "circle",
    corners: "sharp",
    widthUm: 50000,
    heightUm: 50000,
    idea: "ستيكر دائري مكتوب عليه اهلا وسهلا وبي ورد",
    visualDescription,
    briefToken: briefToken(visualDescription),
    lines: ["أهلاً وسهلاً"],
    refUploadIds: [],
    ...over,
  };
}

function translateResponse(text: string): Response {
  return jsonResponse({
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ visual_description: text }) }] }],
  });
}

const day = () => shopDayKey(new Date());
async function imageUsage(): Promise<number> {
  const rows = await getStorage().aiUsage!(day());
  return rows.filter((r) => r.kind === "image").reduce((n, r) => n + r.count, 0);
}
async function rows() {
  return (await getStorage().aiListGenerations!({ limit: 10, offset: 0 })).rows;
}

let png: Uint8Array;
/** Answers /responses with the translation and /images/generations with the PNG. */
const handler = (path: string) => (path === "/responses" ? translateResponse(EN) : imageResponse(png));

beforeEach(async () => {
  setupEnv();
  vi.stubEnv("OPENAI_API_KEY", "sk-test-instructions");
  vi.stubEnv("OPENAI_BASE_URL", OPENAI_BASE);
  png = await opaquePng();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("generate: design instructions", () => {
  it("unchanged instructions (valid token) draw the signed description with no translation call", async () => {
    const calls = stubOpenAi(handler);
    const out = await read(await call(body({ instructions: I, instructionsToken: instructionsToken(VD, I) })));
    expect(out.ok).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(["/images/generations"]);
    const prompt = (calls[0].body as { prompt: string }).prompt;
    expect(prompt).toContain(`Artwork: ${VD}`);
    expect(prompt).not.toContain("written by the customer");
    expect((await rows())[0].instructions).toBe(I);
    expect(await imageUsage()).toBe(1);
  });

  it("edited instructions (a token for another text) are translated first, then drawn", async () => {
    const calls = stubOpenAi(handler);
    const out = await read(await call(body({ instructions: I, instructionsToken: instructionsToken(VD, "نص ثاني") })));
    expect(out.ok).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(["/responses", "/images/generations"]);
    const t = calls[0].body as { input: string; instructions: string; model: string; store: boolean };
    expect(t.input).toBe(I);
    expect(t.model).toBe(AI_BRIEF_MODEL);
    expect(t.store).toBe(false);
    expect(t.instructions).not.toContain(I);
    const prompt = (calls[1].body as { prompt: string }).prompt;
    expect(prompt).toContain("written by the customer");
    expect(prompt).toContain(EN);
    expect(prompt).not.toContain(VD);
    expect((await rows())[0].instructions).toBe(I);
    expect(await imageUsage()).toBe(1);
  });

  it("instructions without a token count as edited", async () => {
    const calls = stubOpenAi(handler);
    expect((await read(await call(body({ instructions: I })))).ok).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(["/responses", "/images/generations"]);
  });

  it("hardens what the browser sent before it reaches the translator", async () => {
    const calls = stubOpenAi(handler);
    expect((await read(await call(body({ instructions: " ستيكر «x»\nورد " })))).ok).toBe(true);
    expect((calls[0].body as { input: string }).input).toBe("ستيكر x ورد");
    expect((await rows())[0].instructions).toBe("ستيكر x ورد");
  });

  it("edited text reaches OpenAI only through the translator, never the image call", async () => {
    const SENTINEL = "SENTINEL-INSTR-9x";
    const calls = stubOpenAi(handler);
    expect((await read(await call(body({ instructions: `ورد ${SENTINEL} أحمر` })))).ok).toBe(true);
    expect(calls[0].path).toBe("/responses");
    expect(calls[0].text).toContain(SENTINEL);
    expect(calls[1].path).toBe("/images/generations");
    expect(calls[1].text).not.toContain(SENTINEL);
  });

  it("absent instructions: today's behaviour, one image call, record keeps null", async () => {
    const calls = stubOpenAi(handler);
    expect((await read(await call(body()))).ok).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(["/images/generations"]);
    expect((calls[0].body as { prompt: string }).prompt).toContain(`Artwork: ${VD}`);
    expect((await rows())[0].instructions).toBeNull();
  });

  it("whitespace-only instructions count as absent", async () => {
    const calls = stubOpenAi(handler);
    expect((await read(await call(body({ instructions: "  \n ", instructionsToken: "a".repeat(64) })))).ok).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(["/images/generations"]);
    expect((await rows())[0].instructions).toBeNull();
  });

  it("a token without instructions is ignored", async () => {
    const calls = stubOpenAi(handler);
    expect((await read(await call(body({ instructionsToken: instructionsToken(VD, I) })))).ok).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(["/images/generations"]);
  });

  it("round trip: the brief's hardened instructions come back unchanged and cost no translation", async () => {
    // The brief round trip: its instructions are hardened, signed, and come back unchanged.
    const calls = stubOpenAi((path) =>
      path === "/responses"
        ? jsonResponse({
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      printed_text: ["أهلاً"],
                      visual_description: VD,
                      design_instructions: "ورد\n«أحمر»",
                      spelling_fixes: [],
                    }),
                  },
                ],
              },
            ],
          })
        : imageResponse(png),
    );
    const ip = nextIp();
    const bres = await briefRoute(
      new Request("http://localhost/api/design/brief", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ idea: "ستيكر ورد", shape: "circle", widthUm: 50000, heightUm: 50000 }),
      }),
    );
    const b = (await bres.json()) as { ok: true; visualDescription: string; briefToken: string; instructions: string; instructionsToken: string };
    expect(b.instructions).toBe("ورد أحمر");
    const out = await read(
      await call(
        body({
          visualDescription: b.visualDescription,
          briefToken: b.briefToken,
          instructions: b.instructions,
          instructionsToken: b.instructionsToken,
        }),
        ip,
      ),
    );
    expect(out.ok).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(["/responses", "/images/generations"]);
  });

  describe("translation failures give the use back", () => {
    it("an HTTP error → failed (502), nothing counted, no image call", async () => {
      const calls = stubOpenAi((path) => (path === "/responses" ? jsonResponse({ error: {} }, 500) : imageResponse(png)));
      const res = await call(body({ instructions: I }));
      expect(res.status).toBe(502);
      expect(await read(res)).toEqual({ ok: false, error: "failed" });
      expect(calls.map((c) => c.path)).toEqual(["/responses"]);
      expect(await imageUsage()).toBe(0);
    });

    it("a refusal item → refused (422)", async () => {
      const calls = stubOpenAi((path) =>
        path === "/responses"
          ? jsonResponse({ output: [{ type: "message", content: [{ type: "refusal", refusal: "No." }] }] })
          : imageResponse(png),
      );
      const res = await call(body({ instructions: I }));
      expect(res.status).toBe(422);
      expect(await read(res)).toEqual({ ok: false, error: "refused" });
      expect(calls.map((c) => c.path)).toEqual(["/responses"]);
      expect(await imageUsage()).toBe(0);
    });

    it("a moderation block → refused", async () => {
      stubOpenAi((path) =>
        path === "/responses" ? jsonResponse({ error: { code: "moderation_blocked" } }, 400) : imageResponse(png),
      );
      expect(await read(await call(body({ instructions: I })))).toEqual({ ok: false, error: "refused" });
      expect(await imageUsage()).toBe(0);
    });

    it("an answer that is empty after hardening → failed", async () => {
      const calls = stubOpenAi((path) => (path === "/responses" ? translateResponse(" «» \n") : imageResponse(png)));
      expect(await read(await call(body({ instructions: I })))).toEqual({ ok: false, error: "failed" });
      expect(calls.map((c) => c.path)).toEqual(["/responses"]);
      expect(await imageUsage()).toBe(0);
    });
  });

  describe("schema", () => {
    it("rejects instructions over 600 units without any call", async () => {
      const calls = stubOpenAi(handler);
      const res = await call(body({ instructions: "ا".repeat(601) }));
      expect(res.status).toBe(400);
      expect(await read(res)).toEqual({ ok: false, error: "invalid_request" });
      expect(calls).toHaveLength(0);
    });

    it("rejects a token that is not 64 hex", async () => {
      const calls = stubOpenAi(handler);
      expect(await read(await call(body({ instructions: I, instructionsToken: "zz" })))).toEqual({
        ok: false,
        error: "invalid_request",
      });
      expect(calls).toHaveLength(0);
    });
  });
});

describe("generate: translation time budget", () => {
  const req = (ip = nextIp()) =>
    new Request("http://localhost/api/design/generate", { method: "POST", headers: { "x-forwarded-for": ip } });

  it("a young request: the translation gets 15 s and the image its full timeout", async () => {
    const calls = stubOpenAi(handler);
    const spy = vi.spyOn(AbortSignal, "timeout");
    const times = [0, 0, 0, 0];
    const out = await runGenerate(req(), body({ instructions: I }), () => times.shift() ?? 0);
    expect(out.body.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(spy).toHaveBeenCalledWith(15_000);
    expect(spy).toHaveBeenCalledWith(AI_OPENAI_TIMEOUT_MS);
  });

  it("a slow start shortens the translation to 10 s and leaves the image 20 s", async () => {
    stubOpenAi(handler);
    const spy = vi.spyOn(AbortSignal, "timeout");
    // Translation at 250 s: min(15 s, 300 - 250 - 20 - 20 = 10 s) = 10 s. Image at 260 s: 300 - 260 - 20 = 20 s.
    const times = [0, 0, 250_000, 260_000];
    const out = await runGenerate(req(), body({ instructions: I }), () => times.shift() ?? 260_000);
    expect(out.body.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(10_000);
    expect(spy).toHaveBeenCalledWith(20_000);
    expect(spy).not.toHaveBeenCalledWith(15_000);
  });

  it("with under 5 s for the translation nothing is called and the use is given back", async () => {
    const calls = stubOpenAi(handler);
    const times = [0, 0, 255_001];
    const out = await runGenerate(req(), body({ instructions: I }), () => times.shift() ?? 255_001);
    expect(out.body).toEqual({ ok: false, error: "failed" });
    expect(calls).toHaveLength(0);
    expect(await imageUsage()).toBe(0);
  });

  it("a translation that eats the image budget gives the use back before the image call", async () => {
    const calls = stubOpenAi(handler);
    const times = [0, 0, 250_000, 270_000];
    const out = await runGenerate(req(), body({ instructions: I }), () => times.shift() ?? 270_000);
    expect(out.body).toEqual({ ok: false, error: "failed" });
    expect(calls.map((c) => c.path)).toEqual(["/responses"]);
    expect(await imageUsage()).toBe(0);
  });

  it("the unchanged path reads the clock exactly three times (no translation)", async () => {
    stubOpenAi(handler);
    const clock = vi.fn(() => 0);
    const out = await runGenerate(
      req(),
      body({ instructions: I, instructionsToken: instructionsToken(VD, I) }),
      clock,
    );
    expect(out.body.ok).toBe(true);
    expect(clock).toHaveBeenCalledTimes(3);
  });
});

describe("generate: staff actor", () => {
  it("translates edited instructions too and reserves 'staff_image'", async () => {
    const calls = stubOpenAi(handler);
    const reserve = vi.spyOn(getStorage(), "aiReserve");
    const out = await runGenerate(
      new Request("http://localhost/api/staff/design/generate", { method: "POST" }),
      body({ instructions: I }),
      Date.now,
      undefined,
      staffActor("st9"),
    );
    expect(out.body.ok).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(["/responses", "/images/generations"]);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reserve.mock.calls[0][0]).toMatchObject({ kind: "staff_image", ipKey: "staff:st9" });
    expect((await rows())[0]).toMatchObject({ staffId: "st9", instructions: I });
  });
});
