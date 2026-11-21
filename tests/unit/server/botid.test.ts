import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkBotId = vi.hoisted(() => vi.fn());
const reportError = vi.hoisted(() => vi.fn());
vi.mock("botid/server", () => ({ checkBotId }));
vi.mock("@/lib/monitoring/report", () => ({ reportError }));

import { BOTID_TIMEOUT_MS, botBlocked } from "@/lib/botid";

const verdict = (isBot: boolean) => ({ isHuman: !isBot, isBot, isVerifiedBot: false, bypassed: false });

let clock = Date.now();

beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("BOTID_ENFORCE", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.useFakeTimers();
  // Past the once-a-minute report throttle of the previous test.
  clock += 10 * 60_000;
  vi.setSystemTime(clock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  checkBotId.mockReset();
  reportError.mockReset();
});

describe("botBlocked", () => {
  it("is a no-op outside Vercel: BotID is never called", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("BOTID_ENFORCE", "1");
    checkBotId.mockResolvedValue(verdict(true));
    expect(await botBlocked("/api/orders")).toBe(false);
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("lets a human through, with or without enforcement", async () => {
    checkBotId.mockResolvedValue(verdict(false));
    expect(await botBlocked("/api/orders")).toBe(false);
    vi.stubEnv("BOTID_ENFORCE", "1");
    expect(await botBlocked("/api/orders")).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("log-only by default: a bot is let through and one fixed line is logged", async () => {
    checkBotId.mockResolvedValue(verdict(true));
    expect(await botBlocked("/api/upload")).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith("[botid] would block /api/upload");
  });

  it("only BOTID_ENFORCE=1 enforces (0, true and empty do not)", async () => {
    checkBotId.mockResolvedValue(verdict(true));
    for (const v of ["", "0", "true", "yes"]) {
      vi.stubEnv("BOTID_ENFORCE", v);
      expect(await botBlocked("/api/orders")).toBe(false);
    }
    vi.stubEnv("BOTID_ENFORCE", "1");
    expect(await botBlocked("/api/orders")).toBe(true);
    expect(console.warn).toHaveBeenCalledTimes(4);
  });

  it("fails open when BotID throws, and reports a fixed message without the error text", async () => {
    vi.stubEnv("BOTID_ENFORCE", "1");
    checkBotId.mockRejectedValue(new Error("secret detail 203.0.113.9"));
    expect(await botBlocked("/api/orders")).toBe(false);
    expect(reportError).toHaveBeenCalledTimes(1);
    const [err, ctx] = reportError.mock.calls[0];
    expect((err as Error).message).toBe("botid check failed");
    expect(ctx).toMatchObject({ where: "botid.check", route: "/api/orders" });
    expect(JSON.stringify(reportError.mock.calls)).not.toContain("203.0.113.9");
  });

  it("fails open on a check slower than the timeout", async () => {
    vi.stubEnv("BOTID_ENFORCE", "1");
    checkBotId.mockReturnValue(new Promise(() => {}));
    const pending = botBlocked("/api/design/brief");
    await vi.advanceTimersByTimeAsync(BOTID_TIMEOUT_MS + 1);
    expect(await pending).toBe(false);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("reports a broken check at most once a minute", async () => {
    checkBotId.mockRejectedValue(new Error("x"));
    await botBlocked("/api/orders");
    await botBlocked("/api/orders");
    expect(reportError).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 61_000);
    await botBlocked("/api/orders");
    expect(reportError).toHaveBeenCalledTimes(2);
  });
});
