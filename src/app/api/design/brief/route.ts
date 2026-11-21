import { readJsonCapped } from "../../_lib/body";
import { botBlocked } from "@/lib/botid";
import { reportError } from "@/lib/monitoring/report";
import {
  AI_BODY_MAX_BYTES,
  BRIEF_STATUS,
  runBrief,
  type BriefResponse,
} from "@/lib/ai/service";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST { idea, shape, widthUm, heightUm } → BriefResponse: the lines to print (spelling fixed),
 * the spelling changes, and a signed English artwork description for /api/design/generate.
 * Logic in src/lib/ai/service.ts.
 */
export async function POST(request: Request): Promise<Response> {
  const send = (body: BriefResponse, retryAfterSec?: number) =>
    Response.json(body, {
      status: body.ok ? 200 : BRIEF_STATUS[body.error],
      headers: retryAfterSec !== undefined ? { "Retry-After": String(retryAfterSec) } : undefined,
    });

  // Bot check (log-only unless BOTID_ENFORCE=1). The brief errors have no 403, so the nearest one is used.
  if (await botBlocked("/api/design/brief")) return send({ ok: false, error: "rate_limited" });

  let json: unknown;
  try {
    json = await readJsonCapped(request, AI_BODY_MAX_BYTES);
  } catch {
    return send({ ok: false, error: "invalid_request" });
  }

  try {
    const out = await runBrief(request, json);
    return send(out.body, out.retryAfterSec);
  } catch {
    // Codes only: the caught error could carry the customer's text.
    reportError(new Error("ai brief route failed"), { where: "ai.brief.post", route: "/api/design/brief" });
    return send({ ok: false, error: "failed" });
  }
}
