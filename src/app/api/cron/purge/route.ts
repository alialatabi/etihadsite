import { timingSafeEqual } from "node:crypto";
import { UNORDERED_DESIGN_DAYS } from "@/config/defaults";
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
  if (!secret || secret.length < 16) {
    // Fixed text, no secret value: Sentry raises it so a missing secret does not fail silently every day.
    reportError(new Error("CRON_SECRET is missing or too short: the retention purge cannot run"), {
      where: "cron.purge.auth",
      route: "/api/cron/purge",
    });
    return false;
  }
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * GET /api/cron/purge — daily retention purge (vercel.json crons). Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`; anything else gets 401. Deletes print PDFs older than
 * settings.retentionDays (orders and the designs they used are kept forever, owner decision D10; orders
 * from before KEEP_DESIGNS_FROM are removed whole, as their customers were told), uploads no
 * order or AI generation uses, never-committed direct uploads, and analytics events older
 * than 400 days, and AI usage counters older than 400 days.
 * Then the 7-day rule (owner 2026-11-26): aiPurgeUnordered removes every design no order used (AI and staff
 * designs: upload files and gallery row) UNORDERED_DESIGN_DAYS after it was made, healing any that an order does
 * use; purgeUnusedUploads then removes plain uploads no order and no remaining design uses. Both refuse a
 * cutoff newer than 7 days, and delete nothing when a read fails.
 * Customers (name/phone/address) are NEVER deleted here: kept permanently by owner decision.
 * `?dry=1` only reports. The 7-day rule adds `removedDesigns` and `removedUploads` to the JSON when either is
 * non-zero (a run with nothing to do answers exactly as before the rule existed: the golden test pins that).
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
    // 7-day rule: designs first (their uploads leave the "in use" set of the second step), then plain uploads.
    const unorderedCutoff = new Date(Date.now() - UNORDERED_DESIGN_DAYS * DAY_MS);
    const removedDesignItems = storage.aiPurgeUnordered ? await storage.aiPurgeUnordered(unorderedCutoff, dryRun) : [];
    const removedDesigns = removedDesignItems.filter((x) => x.startsWith("ai_generation:")).length;
    const removedUploadItems = storage.purgeUnusedUploads ? await storage.purgeUnusedUploads(unorderedCutoff, dryRun) : [];
    // The first line and the JSON of a run that found nothing to do for the 7-day rule stay byte-identical to what
    // they were before it existed (tests/unit/golden/routes.golden pins them); the new counts appear when non-zero.
    console.log(`[cron/purge] ${dryRun ? "would remove" : "removed"} ${removed.length} item(s) older than ${cutoff.toISOString()}`);
    if (removedDesigns > 0 || removedUploadItems.length > 0) {
      console.log(`[cron/purge] 7-day rule: ${dryRun ? "would remove" : "removed"} ${removedDesigns} design(s) no order used and ${removedUploadItems.length} unused upload file(s)`);
    }
    return Response.json({
      ok: true,
      dryRun,
      cutoff: cutoff.toISOString(),
      removed: removed.length,
      removedEvents: removedEvents.length,
      ...(removedDesigns > 0 || removedUploadItems.length > 0 ? { removedDesigns, removedUploads: removedUploadItems.length } : {}),
    });
  } catch (e) {
    console.error("[cron/purge] failed", e);
    reportError(e, { where: "cron.purge", route: "/api/cron/purge" });
    return Response.json({ ok: false }, { status: 500 });
  }
}
