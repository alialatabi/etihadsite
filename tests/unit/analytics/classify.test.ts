import { describe, expect, it } from "vitest";
import { classifyDevice, classifySource, isBot } from "@/lib/analytics/classify";

describe("classifySource", () => {
  const own = "softy.iq";
  it.each([
    ["https://l.instagram.com/?u=x", "instagram"],
    ["https://www.instagram.com/", "instagram"],
    ["https://m.facebook.com/", "facebook"],
    ["https://lm.facebook.com/l.php", "facebook"],
    ["https://fb.me/x", "facebook"],
    ["https://www.tiktok.com/@a", "tiktok"],
    ["https://wa.me/964770", "whatsapp"],
    ["https://api.whatsapp.com/send", "whatsapp"],
    ["https://t.me/chan", "telegram"],
    ["https://www.google.com/", "google"],
    ["https://www.google.iq/", "google"],
    ["https://www.snapchat.com/", "snapchat"],
    ["https://www.youtube.com/watch", "youtube"],
    ["https://example.org/", "other"],
    ["not a url", "other"],
    ["", "direct"],
    ["https://softy.iq/builder", "direct"],
  ])("%s -> %s", (ref, expected) => {
    expect(classifySource(ref, undefined, own)).toBe(expected);
  });
  it("utm_source wins", () => {
    expect(classifySource("", "ig", own)).toBe("instagram");
    expect(classifySource("https://x.com", "TikTok", own)).toBe("tiktok");
    expect(classifySource("", "newsletter", own)).toBe("other");
  });
});

describe("classifyDevice", () => {
  it("detects kinds", () => {
    expect(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148")).toBe("mobile");
    expect(classifyDevice("Mozilla/5.0 (Linux; Android 14; SM-S918B) Mobile Safari")).toBe("mobile");
    expect(classifyDevice("Mozilla/5.0 (Linux; Android 13; SM-X700) Safari")).toBe("tablet");
    expect(classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0)")).toBe("tablet");
    expect(classifyDevice("Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120")).toBe("desktop");
  });
});

describe("isBot", () => {
  it("flags crawlers and empty UA", () => {
    expect(isBot("Googlebot/2.1")).toBe(true);
    expect(isBot("facebookexternalhit/1.1")).toBe(true);
    expect(isBot("")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot("Mozilla/5.0 (iPhone) Mobile Safari")).toBe(false);
  });
});
