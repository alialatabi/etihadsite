import { handleUploadStart } from "../../../_lib/upload-handlers";
import { staffApiGuard } from "@/lib/auth/staff-session";
import { limiters } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Staff twin of POST /api/upload/direct (reference images on /team): same checks, only for a logged-in staff
 * account (401 otherwise), limited per account instead of per IP so the shop's connection never limits staff.
 */
export async function POST(request: Request): Promise<Response> {
  const g = await staffApiGuard();
  if (g instanceof Response) return g;
  return handleUploadStart(request, {
    gate: () => limiters().staffUpload.check(`staff:${g.staff.id}`),
    route: "/api/team/upload/direct",
  });
}
