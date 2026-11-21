/**
 * Fail safe: with a malformed KEEP_DESIGNS_FROM neither adapter may delete anything (the date
 * decides which retention rule applies). The constant is replaced for this file only.
 */
import { mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStorage } from "@/lib/storage/local";
import { SupabaseStorage } from "@/lib/storage/supabase";

vi.mock("@/config/defaults", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/defaults")>()),
  KEEP_DESIGNS_FROM: "22/11/2026",
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("purge with a malformed KEEP_DESIGNS_FROM", () => {
  const cutoff = new Date("2026-12-31T00:00:00.000Z");

  it("local: throws and leaves every file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ep-purge-badkeep-"));
    const s = new LocalStorage(dir);
    await s.saveUpload("unused-upload-1", new Uint8Array([1]), { mime: "image/png", originalName: "a.png", bytes: 1, createdAt: "2026-12-20T00:00:00.000Z" });
    const t = new Date("2026-12-20T00:00:00.000Z");
    for (const ext of ["bin", "json"]) utimesSync(path.join(dir, "uploads", `unused-upload-1.${ext}`), t, t);
    await expect(s.purgeOlderThan(cutoff, false)).rejects.toThrow("bad KEEP_DESIGNS_FROM");
    expect(await s.readFile("uploads/unused-upload-1.bin")).not.toBeNull();
  });

  it("supabase: throws before any request", async () => {
    const fetchSpy = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(new SupabaseStorage("https://proj.supabase.co", "k").purgeOlderThan(cutoff, false)).rejects.toThrow("bad KEEP_DESIGNS_FROM");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
