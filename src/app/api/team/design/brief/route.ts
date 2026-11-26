import { handleAiPost } from "../../../_lib/ai-route";
import { BRIEF_STATUS, runBrief, staffActor } from "@/lib/ai/service";
import { staffApiGuard } from "@/lib/auth/staff-session";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Staff twin of POST /api/design/brief: same body and answers, but only for a logged-in staff account
 * (401 otherwise) and counted against that account's own daily limit, never the customers'.
 */
export async function POST(request: Request): Promise<Response> {
  const g = await staffApiGuard();
  if (g instanceof Response) return g;
  const actor = staffActor(g.staff.id);
  return handleAiPost(request, {
    status: BRIEF_STATUS,
    report: { message: "ai team brief route failed", where: "ai.team.brief.post", route: "/api/team/design/brief" },
    run: (json) => runBrief(request, json, actor),
  });
}
