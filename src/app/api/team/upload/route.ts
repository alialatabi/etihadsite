import { handleUploadServer } from "../../_lib/upload-handlers";
import { staffApiGuard } from "@/lib/auth/staff-session";
import { limiters } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Staff twin of POST /api/upload (the local-disk mode of the same upload): staff login required, limited per account. */
export async function POST(request: Request): Promise<Response> {
  const g = await staffApiGuard();
  if (g instanceof Response) return g;
  return handleUploadServer(request, {
    gate: () => limiters().staffUpload.check(`staff:${g.staff.id}`),
    route: "/api/team/upload",
    track: false,
  });
}
