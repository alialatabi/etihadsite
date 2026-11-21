import { AI_BODY_MAX_BYTES } from "@/lib/ai/service";
import { reportError } from "@/lib/monitoring/report";
import { readJsonCapped } from "./body";
import { aiRequestRejection } from "./same-origin";

type Fixed = "invalid_request" | "failed";
type AiBody<E> = { ok: true } | { ok: false; error: E };

/**
 * Shared POST skeleton of /api/design/brief and /api/design/generate. Order: 415/403 before the body
 * is read, then the body (invalid_request), then `run`; any throw is reported and answers 'failed'.
 */
export async function handleAiPost<E extends string>(
  request: Request,
  opts: {
    status: Record<NoInfer<E> | Fixed, number>;
    report: { message: string; where: string; route: string };
    run: (json: unknown) => Promise<{ body: AiBody<E>; retryAfterSec?: number }>;
  },
): Promise<Response> {
  const send = (body: AiBody<E | Fixed>, retryAfterSec?: number, status?: number) =>
    Response.json(body, {
      status: status ?? (body.ok ? 200 : opts.status[body.error]),
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
    const out = await opts.run(json);
    return send(out.body, out.retryAfterSec);
  } catch {
    // Codes only: the caught error could carry the customer's text or IP.
    reportError(new Error(opts.report.message), { where: opts.report.where, route: opts.report.route });
    return send({ ok: false, error: "failed" });
  }
}
