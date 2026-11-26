import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/config/defaults";

vi.mock("server-only", () => ({}));
import { toPublicSettings } from "@/lib/settings";

describe("toPublicSettings", () => {
  const full = {
    ...DEFAULT_SETTINGS,
    telegramChatId: "@softyprint",
    ai: { enabled: true, perIpDailyLimit: 5, siteDailyLimit: 300 },
  };

  it("blanks the Telegram chat id and the AI limits, keeps every key and the rest unchanged", () => {
    const pub = toPublicSettings(full);
    expect(pub.telegramChatId).toBe("");
    expect(pub.ai).toEqual({ enabled: true, perIpDailyLimit: 0, siteDailyLimit: 0 });
    expect(Object.keys(pub)).toEqual(Object.keys(full));
    expect({ ...pub, telegramChatId: full.telegramChatId, ai: full.ai }).toEqual(full);
  });

  it("zeroes the per-sheet prices when prices are not published, keeps everything else in pricing", () => {
    const hidden = { ...full, pricesPublished: false };
    const copy = structuredClone(hidden);
    const pub = toPublicSettings(hidden);
    expect(pub.pricing.materials.paper.pricePerSheetIqd).toBe(0);
    expect(pub.pricing.materials.plastic.pricePerSheetIqd).toBe(0);
    expect(pub.pricing.materials.paper.enabled).toBe(hidden.pricing.materials.paper.enabled);
    expect(pub.pricing.materials.plastic.enabled).toBe(hidden.pricing.materials.plastic.enabled);
    expect({ ...pub.pricing, materials: hidden.pricing.materials }).toEqual(hidden.pricing);
    expect(pub.deliveryFeeIqd).toBe(hidden.deliveryFeeIqd);
    expect(Object.keys(pub)).toEqual(Object.keys(hidden));
    expect(hidden).toEqual(copy);
  });

  it("leaves the pricing unchanged when prices are published", () => {
    expect(full.pricesPublished).toBe(true);
    expect(toPublicSettings(full).pricing).toEqual(full.pricing);
  });

  it("does not touch the object it was given", () => {
    const copy = structuredClone(full);
    toPublicSettings(full);
    expect(full).toEqual(copy);
  });
});
