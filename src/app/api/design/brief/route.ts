import { handleAiPost } from "../../_lib/ai-route";
import { BRIEF_STATUS, runBrief } from "@/lib/ai/service";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST { idea, shape, widthUm, heightUm } → BriefResponse: the lines to print (spelling fixed),
 * the spelling changes, and a signed English artwork description for /api/design/generate.
 * Logic in src/lib/ai/service.ts.
 */
export async function POST(request: Request): Promise<Response> {
  return handleAiPost(request, {
    status: BRIEF_STATUS,
    report: { message: "ai brief route failed", where: "ai.brief.post", route: "/api/design/brief" },
    run: (json) => runBrief(request, json),
  });
}
