import { handleAiPost } from "../../_lib/ai-route";
import { GENERATE_STATUS, runGenerate } from "@/lib/ai/service";

// The image calls' time budget (the main call and the long-sticker extension calls) is worked out against this
// (config.ts AI_ROUTE_MAX_DURATION_MS; keep the literal 300: 300 s needs Fluid Compute, on by default).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST { shape, corners, widthUm, heightUm, idea, visualDescription, briefToken, lines, refUploadIds }
 * → GenerateResponse: one AI sticker design, stored as an ordinary upload (uploadId) and returned
 * as base64 PNG. Logic and the order of checks in src/lib/ai/service.ts.
 */
export async function POST(request: Request): Promise<Response> {
  // The time budget of the image calls counts from here: the body read uses up the route's maxDuration too.
  const startedAt = Date.now();
  return handleAiPost(request, {
    status: GENERATE_STATUS,
    report: { message: "ai generate route failed", where: "ai.generate.post", route: "/api/design/generate" },
    run: (json) => runGenerate(request, json, Date.now, startedAt),
  });
}
