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

  it("does not touch the object it was given", () => {
    const copy = structuredClone(full);
    toPublicSettings(full);
    expect(full).toEqual(copy);
  });
});
