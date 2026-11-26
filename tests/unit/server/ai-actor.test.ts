/**
 * Pins the AI actor seam (service.ts): the customer actor is today's behaviour, the staff actor counts per
 * account under its own usage kinds, and the brief answer carries the two v2 keys last.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/config/defaults";
import {
  AI_BRIEF_PER_IP,
  AI_BRIEF_SITE,
  STAFF_BRIEF_DAILY_LIMIT,
  STAFF_IMAGE_DAILY_LIMIT,
  STAFF_SITE_CAP,
} from "@/lib/ai/config";
import { aiIpKey } from "@/lib/ai/ip";
import { briefToken, customerActor, instructionsToken, runBrief, runGenerate, staffActor } from "@/lib/ai/service";
import { shopDayKey } from "@/lib/shop-time";
import { GENERATE_STATUS } from "@/lib/ai/service";
import { limiters } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { setupEnv } from "./helpers";
import { OPENAI_BASE, briefResponse, imageResponse, opaquePng, stubOpenAi } from "./ai-helpers";

function req(ip: string): Request {
  return new Request("http://localhost/api/x", { method: "POST", headers: { "x-forwarded-for": ip } });
}

const BRIEF_BODY = { idea: "ستيكر دائري مكتوب عليه اهلا وسهلا وبي ورد", shape: "circle", widthUm: 50000, heightUm: 50000 };
const VD = "A round sticker with red roses.";
function genBody() {
  return {
    shape: "circle",
    corners: "sharp",
    widthUm: 50000,
    heightUm: 50000,
    idea: BRIEF_BODY.idea,
    visualDescription: VD,
    briefToken: briefToken(VD),
    lines: ["أهلاً وسهلاً"],
    refUploadIds: [],
  };
}

beforeEach(() => {
  setupEnv();
  vi.stubEnv("OPENAI_API_KEY", "sk-test-actor");
  vi.stubEnv("OPENAI_BASE_URL", OPENAI_BASE);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("customerActor (today's behaviour)", () => {
  it("uses the customer kinds, the settings limits and the IP key", () => {
    expect(customerActor.briefKind).toBe("brief");
    expect(customerActor.imageKind).toBe("image");
    expect(customerActor.staffId).toBeNull();
    expect(customerActor.limits(DEFAULT_SETTINGS)).toEqual({
      briefPerKey: AI_BRIEF_PER_IP,
      briefSite: AI_BRIEF_SITE,
      imagePerKey: DEFAULT_SETTINGS.ai.perIpDailyLimit,
      imageSite: DEFAULT_SETTINGS.ai.siteDailyLimit,
    });
    const custom = { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, perIpDailyLimit: 3, siteDailyLimit: 77 } };
    expect(customerActor.limits(custom)).toMatchObject({ imagePerKey: 3, imageSite: 77 });
  });

  it("identifies by the hashed IP and keeps the in-memory key as the IP (or 'global')", () => {
    expect(customerActor.identify(req("10.9.0.1"))).toEqual({ ip: "10.9.0.1", ipKey: aiIpKey("10.9.0.1") });
    expect(customerActor.limiterKey("10.9.0.1")).toBe("10.9.0.1");
    expect(customerActor.limiterKey("")).toBe("global");
  });

  it("groups an IPv6 client by its /64 (key and in-memory guard) but keeps IPv4 per address", () => {
    const a = customerActor.identify(req("2001:db8:1:2::1"));
    const b = customerActor.identify(req("2001:db8:1:2:ffff::abcd"));
    expect(a.ipKey).toBe(b.ipKey);
    // the stored address stays the full one
    expect(a.ip).toBe("2001:db8:1:2::1");
    expect(b.ip).toBe("2001:db8:1:2:ffff::abcd");
    expect(customerActor.limiterKey(a.ip)).toBe(customerActor.limiterKey(b.ip));
    // another /64 and two IPv4 addresses stay separate
    expect(customerActor.identify(req("2001:db8:1:3::1")).ipKey).not.toBe(a.ipKey);
    expect(customerActor.identify(req("10.9.0.1")).ipKey).not.toBe(customerActor.identify(req("10.9.0.2")).ipKey);
    expect(customerActor.limiterKey("10.9.0.1")).not.toBe(customerActor.limiterKey("10.9.0.2"));
  });

  it("a default runGenerate counts the 'image' kind and writes no staffId", async () => {
    const png = await opaquePng();
    stubOpenAi(() => imageResponse(png));
    const out = await runGenerate(req("10.9.0.2"), genBody());
    expect(out.body.ok).toBe(true);
    const rows = await getStorage().aiUsage!(shopDayKey(new Date()));
    expect(rows.map((r) => r.kind)).toEqual(["image"]);
    const { rows: gens } = await getStorage().aiListGenerations!({ limit: 5, offset: 0 });
    expect(gens).toHaveLength(1);
    expect("staffId" in gens[0]).toBe(false);
  });
});

describe("staffActor", () => {
  it("keys the usage by the account and uses the staff kinds and limits", () => {
    const a = staffActor("st1");
    expect(a.briefKind).toBe("staff_brief");
    expect(a.imageKind).toBe("staff_image");
    expect(a.staffId).toBe("st1");
    expect(a.limiterKey("1.2.3.4")).toBe("staff:st1");
    expect(a.limiterKey("")).toBe("staff:st1");
    expect(a.limits(DEFAULT_SETTINGS)).toEqual({
      briefPerKey: STAFF_BRIEF_DAILY_LIMIT,
      briefSite: STAFF_SITE_CAP,
      imagePerKey: STAFF_IMAGE_DAILY_LIMIT,
      imageSite: STAFF_SITE_CAP,
    });
    expect(STAFF_IMAGE_DAILY_LIMIT).toBe(50);
    expect(a.identify(req("10.9.0.3"))).toEqual({ ip: "", ipKey: "staff:st1" });
    expect(a.guard).toBe("staff");
    expect(customerActor.guard).toBe("customer");
  });

  it("a staff reservation uses kind 'staff_image' with 50 per account, and the record carries the staff id", async () => {
    const png = await opaquePng();
    stubOpenAi(() => imageResponse(png));
    const storage = getStorage();
    const reserve = vi.spyOn(storage, "aiReserve");
    const out = await runGenerate(req("10.9.0.4"), genBody(), Date.now, undefined, staffActor("st1"));
    expect(out.body.ok).toBe(true);
    if (!out.body.ok) return;
    expect(out.body.remainingToday).toBe(STAFF_IMAGE_DAILY_LIMIT - 1);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reserve.mock.calls[0][0]).toMatchObject({
      kind: "staff_image",
      ipKey: "staff:st1",
      perIpLimit: 50,
      siteLimit: STAFF_SITE_CAP,
    });
    // Staff use never touches the customer kinds.
    const rows = await storage.aiUsage!(shopDayKey(new Date()));
    expect(rows.map((r) => [r.kind, r.ipKey, r.count])).toEqual([["staff_image", "staff:st1", 1]]);
    const { rows: gens } = await storage.aiListGenerations!({ limit: 5, offset: 0 });
    expect(gens[0]).toMatchObject({ staffId: "st1", ipKey: "staff:st1" });
  });

  it("a staff brief reserves 'staff_brief' with 300 per account", async () => {
    stubOpenAi(() => briefResponse({ printed_text: ["أهلاً"], visual_description: VD, spelling_fixes: [] }));
    const reserve = vi.spyOn(getStorage(), "aiReserve");
    const out = await runBrief(req("10.9.0.5"), BRIEF_BODY, staffActor("st2"));
    expect(out.body.ok).toBe(true);
    expect(reserve.mock.calls[0][0]).toMatchObject({
      kind: "staff_brief",
      ipKey: "staff:st2",
      perIpLimit: 300,
      siteLimit: STAFF_SITE_CAP,
    });
  });

  it("the 51st image of a day is refused with ip_limit and leaves the customer counters alone", async () => {
    const png = await opaquePng();
    stubOpenAi(() => imageResponse(png));
    const storage = getStorage();
    const day = shopDayKey(new Date());
    for (let i = 0; i < STAFF_IMAGE_DAILY_LIMIT; i++) {
      await storage.aiReserve!({ day, ipKey: "staff:st3", ip: "", kind: "staff_image", perIpLimit: 50, siteLimit: STAFF_SITE_CAP });
    }
    const out = await runGenerate(req("10.9.0.6"), genBody(), Date.now, undefined, staffActor("st3"));
    expect(out.body).toEqual({ ok: false, error: "ip_limit" });
    const rows = await storage.aiUsage!(day);
    expect(rows.every((r) => r.kind === "staff_image")).toBe(true);
  });
});

describe("staff hourly guard", () => {
  it("a full staffGenerate limiter answers rate_limited (429), not ip_limit, and reserves nothing", async () => {
    const guard = limiters().staffGenerate;
    let r = guard.check("staff:st9");
    while (r.ok) r = guard.check("staff:st9");
    const out = await runGenerate(req("10.9.0.9"), genBody(), Date.now, undefined, staffActor("st9"));
    expect(out.body).toEqual({ ok: false, error: "rate_limited" });
    expect(GENERATE_STATUS.rate_limited).toBe(429);
    expect(await getStorage().aiUsage!(shopDayKey(new Date()))).toEqual([]);
  });

  it("the customer guard keeps answering ip_limit", async () => {
    const guard = limiters().generate;
    let r = guard.check("10.9.0.10");
    while (r.ok) r = guard.check("10.9.0.10");
    const out = await runGenerate(req("10.9.0.10"), genBody());
    expect(out.body).toEqual({ ok: false, error: "ip_limit" });
  });
});

describe("brief response contract", () => {
  it("keeps the old keys in order and appends instructions and instructionsToken last", async () => {
    stubOpenAi(() => briefResponse({ printed_text: ["أهلاً وسهلاً"], visual_description: VD, spelling_fixes: [] }));
    const { body } = await runBrief(req("10.9.0.7"), BRIEF_BODY);
    expect(Object.keys(body)).toEqual(["ok", "lines", "fixes", "visualDescription", "briefToken", "instructions", "instructionsToken"]);
    if (!body.ok) return;
    expect(body.instructions).toBe("");
    expect(body.instructionsToken).toMatch(/^[0-9a-f]{64}$/);
    expect(body.instructionsToken).toBe(instructionsToken(VD, ""));
    expect(body.instructionsToken).not.toBe(instructionsToken(VD, "x"));
    expect(body.briefToken).toBe(briefToken(VD));
  });
});
