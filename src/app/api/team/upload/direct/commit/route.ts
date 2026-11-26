import { handleUploadCommit } from "../../../../_lib/upload-handlers";
import { staffApiGuard } from "@/lib/auth/staff-session";
import { limiters } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Staff twin of POST /api/upload/direct/commit: same byte checks, staff login required, limited per account. */
export async function POST(request: Request): Promise<Response> {
  const g = await staffApiGuard();
  if (g instanceof Response) return g;
  return handleUploadCommit(request, {
    gate: () => limiters().staffCommit.check(`staff:${g.staff.id}`),
    route: "/api/team/upload/direct/commit",
    track: false,
  });
}
