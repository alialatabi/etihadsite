import { readJsonCapped } from "../../_lib/body";
import { botBlocked } from "@/lib/botid";
import { reportError } from "@/lib/monitoring/report";
import {
  AI_BODY_MAX_BYTES,
  GENERATE_STATUS,
  runGenerate,
  type GenerateResponse,
} from "@/lib/ai/service";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST { shape, corners, widthUm, heightUm, idea, visualDescription, briefToken, lines, refUploadIds }
 * → GenerateResponse: one AI sticker design, stored as an ordinary upload (uploadId) and returned
 * as base64 PNG. Logic and the order of checks in src/lib/ai/service.ts.
 */
export async function POST(request: Request): Promise<Response> {
  const send = (body: GenerateResponse, retryAfterSec?: number) =>
    Response.json(body, {
      status: body.ok ? 200 : GENERATE_STATUS[body.error],
      headers: retryAfterSec !== undefined ? { "Retry-After": String(retryAfterSec) } : undefined,
    });

  // Bot check (log-only unless BOTID_ENFORCE=1): the 403 answer of this route.
  if (await botBlocked("/api/design/generate")) return send({ ok: false, error: "blocked" });

  let json: unknown;
  try {
    json = await readJsonCapped(request, AI_BODY_MAX_BYTES);
  } catch {
    return send({ ok: false, error: "invalid_request" });
  }

  try {
    const out = await runGenerate(request, json);
    return send(out.body, out.retryAfterSec);
  } catch {
    // Codes only: the caught error could carry the customer's text or IP.
    reportError(new Error("ai generate route failed"), { where: "ai.generate.post", route: "/api/design/generate" });
    return send({ ok: false, error: "failed" });
  }
}
