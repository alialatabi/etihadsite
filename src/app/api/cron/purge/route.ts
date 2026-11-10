import { timingSafeEqual } from "node:crypto";
import { getSettings } from "@/lib/settings";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Purgeable = {
  purgeOlderThan(cutoff: Date, dryRun: boolean): Promise<string[]>;
  purgeEventsOlderThan?(cutoff: Date, dryRun: boolean): Promise<string[]>;
};

/** Analytics events (no personal data) are kept this long. */
const EVENT_RETENTION_DAYS = 400;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * GET /api/cron/purge — daily retention purge (vercel.json crons). Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`; anything else gets 401. Deletes orders, PDFs and
 * designs older than settings.retentionDays (the promise in the consent line) plus
 * never-committed direct uploads, and analytics events older than 400 days.
 * Customers (name/phone/address) are NEVER deleted here: kept permanently by owner decision.
 * `?dry=1` only reports.
 */
export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) return Response.json({ ok: false }, { status: 401 });
  try {
    const storage = getStorage() as unknown as Partial<Purgeable>;
    if (typeof storage.purgeOlderThan !== "function") return Response.json({ ok: false, error: "unsupported" }, { status: 501 });
    const settings = await getSettings();
    const cutoff = new Date(Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000);
    const dryRun = new URL(request.url).searchParams.get("dry") === "1";
    const removed = await storage.purgeOlderThan(cutoff, dryRun);
    const eventCutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const removedEvents = storage.purgeEventsOlderThan ? await storage.purgeEventsOlderThan(eventCutoff, dryRun) : [];
    console.log(`[cron/purge] ${dryRun ? "would remove" : "removed"} ${removed.length} item(s) older than ${cutoff.toISOString()}`);
    return Response.json({ ok: true, dryRun, cutoff: cutoff.toISOString(), removed: removed.length, removedEvents: removedEvents.length });
  } catch (e) {
    console.error("[cron/purge] failed", e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
