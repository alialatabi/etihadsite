import { handleUploadServer } from "../_lib/upload-handlers";
import { clientIp, limiters } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** POST multipart/form-data, field `file`. The type is decided by magic bytes, never by client MIME. Body shared with the staff route. */
export function POST(request: Request): Promise<Response> {
  return handleUploadServer(request, {
    gate: () => limiters().upload.check(clientIp(request)),
    route: "/api/upload",
  });
}
