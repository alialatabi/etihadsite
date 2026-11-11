import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "@/lib/turnstile";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyTurnstile", () => {
  it("returns false for a missing token without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyTurnstile("secret", undefined, "1.2.3.4")).toBe(false);
    expect(await verifyTurnstile("secret", "", "1.2.3.4")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts secret, token and ip to siteverify and returns true on success", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyTurnstile("secret", "token-1", "1.2.3.4")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(URLSearchParams);
    expect(String(init.body)).toBe("secret=secret&response=token-1&remoteip=1.2.3.4");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns false when Cloudflare does not confirm the token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] })));
    expect(await verifyTurnstile("secret", "token-1", "1.2.3.4")).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    expect(await verifyTurnstile("secret", "token-1", "1.2.3.4")).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: "true" })));
    expect(await verifyTurnstile("secret", "token-1", "1.2.3.4")).toBe(false);
  });

  it("returns false on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    expect(await verifyTurnstile("secret", "token-1", "1.2.3.4")).toBe(false);
  });

  it("returns false when the answer is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502</html>", { status: 502 })));
    expect(await verifyTurnstile("secret", "token-1", "1.2.3.4")).toBe(false);
  });
});
