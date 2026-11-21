import { readJsonCapped } from "../../_lib/body";
import { aiRequestRejection } from "../../_lib/same-origin";
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
  const send = (body: BriefResponse, retryAfterSec?: number, status?: number) =>
    Response.json(body, {
      status: status ?? (body.ok ? 200 : BRIEF_STATUS[body.error]),
      headers: retryAfterSec !== undefined ? { "Retry-After": String(retryAfterSec) } : undefined,
    });

  // Not JSON (415) or from another site (403): refused before the body is read.
  const rejected = aiRequestRejection(request);
  if (rejected !== null) return send({ ok: false, error: "invalid_request" }, undefined, rejected);

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
