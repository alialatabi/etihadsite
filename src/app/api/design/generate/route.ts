import { readJsonCapped } from "../../_lib/body";
import { aiRequestRejection } from "../../_lib/same-origin";
import { reportError } from "@/lib/monitoring/report";
import {
  AI_BODY_MAX_BYTES,
  GENERATE_STATUS,
  runGenerate,
  type GenerateResponse,
} from "@/lib/ai/service";

// runGenerate keeps its own deadline 10 s inside this (service.ts GENERATE_DEADLINE_MS).
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * POST { shape, corners, widthUm, heightUm, idea, visualDescription, briefToken, lines, refUploadIds }
 * → GenerateResponse: one AI sticker design, stored as an ordinary upload (uploadId) and returned
 * as base64 PNG. Logic and the order of checks in src/lib/ai/service.ts.
 */
export async function POST(request: Request): Promise<Response> {
  const send = (body: GenerateResponse, retryAfterSec?: number, status?: number) =>
    Response.json(body, {
      status: status ?? (body.ok ? 200 : GENERATE_STATUS[body.error]),
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
    const out = await runGenerate(request, json);
    return send(out.body, out.retryAfterSec);
  } catch {
    // Codes only: the caught error could carry the customer's text or IP.
    reportError(new Error("ai generate route failed"), { where: "ai.generate.post", route: "/api/design/generate" });
    return send({ ok: false, error: "failed" });
  }
}
