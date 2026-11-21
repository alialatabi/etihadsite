import { describe, expect, it, vi } from "vitest";
import { BOTID_PROTECTED_PATHS, startBotId, type BotIdWindow } from "@/lib/botid-client";

const failedScript = () => new Event("error"); // what BotID's script loader rejects with (not an Error)

function fakeWindow() {
  const plainFetch = vi.fn(async () => new Response("plain"));
  const plainSend = vi.fn();
  const win = { fetch: plainFetch, XMLHttpRequest: { prototype: { send: plainSend } } } as unknown as BotIdWindow;
  return { win, plainFetch, plainSend };
}

describe("startBotId", () => {
  it("protects the five public POST paths", () => {
    const { win } = fakeWindow();
    const init = vi.fn();
    startBotId(win, init);
    expect(init).toHaveBeenCalledWith({
      protect: [
        { path: "/api/orders", method: "POST" },
        { path: "/api/upload", method: "POST" },
        { path: "/api/upload/direct", method: "POST" },
        { path: "/api/design/brief", method: "POST" },
        { path: "/api/design/generate", method: "POST" },
      ],
    });
    expect(BOTID_PROTECTED_PATHS).toHaveLength(5);
  });

  it("changes nothing when BotID patches nothing (development)", () => {
    const { win, plainFetch, plainSend } = fakeWindow();
    startBotId(win, vi.fn());
    expect(win.fetch).toBe(plainFetch);
    expect(win.XMLHttpRequest!.prototype.send).toBe(plainSend);
  });

  it("fetch: a challenge script that fails to load sends the plain request", async () => {
    const { win, plainFetch } = fakeWindow();
    startBotId(win, () => {
      win.fetch = vi.fn(async () => {
        throw failedScript();
      });
    });
    const res = await win.fetch("/api/orders", { method: "POST", body: "{}" });
    expect(await res.text()).toBe("plain");
    expect(plainFetch).toHaveBeenCalledWith("/api/orders", { method: "POST", body: "{}" });
  });

  it("fetch: a real network error is rethrown and nothing is sent twice", async () => {
    const { win, plainFetch } = fakeWindow();
    startBotId(win, () => {
      win.fetch = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
    });
    await expect(win.fetch("/api/orders", { method: "POST" })).rejects.toThrow("Failed to fetch");
    expect(plainFetch).not.toHaveBeenCalled();
  });

  it("fetch: a working challenge answer is passed through", async () => {
    const { win, plainFetch } = fakeWindow();
    startBotId(win, () => {
      win.fetch = vi.fn(async () => new Response("with-token"));
    });
    expect(await (await win.fetch("/api/orders", { method: "POST" })).text()).toBe("with-token");
    expect(plainFetch).not.toHaveBeenCalled();
  });

  it("XHR: when BotID's async send rejects, the plain send runs with the same body", async () => {
    const { win, plainSend } = fakeWindow();
    startBotId(win, () => {
      win.XMLHttpRequest!.prototype.send = vi.fn(async () => {
        throw failedScript();
      });
    });
    const xhr = { send: win.XMLHttpRequest!.prototype.send };
    xhr.send.call(xhr, "BODY"); // like the browser: the returned promise is not awaited
    await new Promise((r) => setTimeout(r, 0));
    expect(plainSend).toHaveBeenCalledTimes(1);
    expect(plainSend.mock.calls[0]).toEqual(["BODY"]);
  });

  it("XHR: a send that works is not repeated", async () => {
    const { win, plainSend } = fakeWindow();
    const patched = vi.fn(async () => undefined);
    startBotId(win, () => {
      win.XMLHttpRequest!.prototype.send = patched;
    });
    await win.XMLHttpRequest!.prototype.send.call({}, "BODY");
    await Promise.resolve();
    expect(patched).toHaveBeenCalledTimes(1);
    expect(plainSend).not.toHaveBeenCalled();
  });
});
