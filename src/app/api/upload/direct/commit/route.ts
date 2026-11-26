import { handleUploadCommit } from "../../../_lib/upload-handlers";
import { clientIp, limiters } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Customer commit of a direct upload; the body is shared with the staff route (see _lib/upload-handlers).
 * Its own limiter (not the start's): a retry of a real commit must not be refused by the start's allowance,
 * and a loop of commits must not be free.
 */
export function POST(request: Request): Promise<Response> {
  return handleUploadCommit(request, {
    gate: () => limiters().commit.check(clientIp(request)),
    route: "/api/upload/direct/commit",
  });
}
