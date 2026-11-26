import { handleUploadStart } from "../../_lib/upload-handlers";
import { clientIp, limiters } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Customer start of a direct upload; the body is shared with the staff route (see _lib/upload-handlers). */
export function POST(request: Request): Promise<Response> {
  return handleUploadStart(request, {
    gate: () => limiters().upload.check(clientIp(request)),
    route: "/api/upload/direct",
  });
}
