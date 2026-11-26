import { handleAiPost } from "../../../_lib/ai-route";
import { GENERATE_STATUS, runGenerate, staffActor } from "@/lib/ai/service";
import { staffApiGuard } from "@/lib/auth/staff-session";

// The image call's time budget is worked out against this (config.ts AI_ROUTE_MAX_DURATION_MS; keep the literal 120).
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Staff twin of POST /api/design/generate: same body and answers, only for a logged-in staff account
 * (401 otherwise), counted against that account's own daily limit. The design is stored like a customer's
 * and shows in the admin gallery with the staff name.
 */
export async function POST(request: Request): Promise<Response> {
  // The time budget of the image call counts from here: the guard's storage read and the body read use up the route's maxDuration too.
  const startedAt = Date.now();
  const g = await staffApiGuard();
  if (g instanceof Response) return g;
  const actor = staffActor(g.staff.id);
  return handleAiPost(request, {
    status: GENERATE_STATUS,
    report: { message: "ai team generate route failed", where: "ai.team.generate.post", route: "/api/team/design/generate" },
    run: (json) => runGenerate(request, json, Date.now, startedAt, actor),
  });
}
