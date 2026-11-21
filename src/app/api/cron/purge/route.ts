import { timingSafeEqual } from "node:crypto";
import { reportError } from "@/lib/monitoring/report";
import { getSettings } from "@/lib/settings";
import { DAY_MS, shopDayKey } from "@/lib/shop-time";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Analytics events (no personal data) are kept this long. */
const EVENT_RETENTION_DAYS = 400;
/** AI usage counters (per-IP daily counts, spec §5.6) are kept this long. */
const AI_USAGE_RETENTION_DAYS = 400;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * GET /api/cron/purge — daily retention purge (vercel.json crons). Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`; anything else gets 401. Deletes print PDFs older than
 * settings.retentionDays (orders and their designs are kept forever, owner decision D10; orders
 * from before KEEP_DESIGNS_FROM are removed whole, as their customers were told), uploads no
 * order or AI generation uses, never-committed direct uploads, and analytics events older
 * than 400 days, and AI usage counters older than 400 days.
 * Customers (name/phone/address) are NEVER deleted here: kept permanently by owner decision.
 * `?dry=1` only reports.
 */
export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) return Response.json({ ok: false }, { status: 401 });
  try {
    const storage = getStorage();
    if (typeof storage.purgeOlderThan !== "function") return Response.json({ ok: false, error: "unsupported" }, { status: 501 });
    const settings = await getSettings();
    const cutoff = new Date(Date.now() - settings.retentionDays * DAY_MS);
    const dryRun = new URL(request.url).searchParams.get("dry") === "1";
    const removed = await storage.purgeOlderThan(cutoff, dryRun);
    const eventCutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * DAY_MS);
    const removedEvents = storage.purgeEventsOlderThan ? await storage.purgeEventsOlderThan(eventCutoff, dryRun) : [];
    if (storage.aiPurgeUsageBefore) {
      await storage.aiPurgeUsageBefore(shopDayKey(new Date(Date.now() - AI_USAGE_RETENTION_DAYS * DAY_MS)), dryRun);
    }
    console.log(`[cron/purge] ${dryRun ? "would remove" : "removed"} ${removed.length} item(s) older than ${cutoff.toISOString()}`);
    return Response.json({ ok: true, dryRun, cutoff: cutoff.toISOString(), removed: removed.length, removedEvents: removedEvents.length });
  } catch (e) {
    console.error("[cron/purge] failed", e);
    reportError(e, { where: "cron.purge", route: "/api/cron/purge" });
    return Response.json({ ok: false }, { status: 500 });
  }
}
