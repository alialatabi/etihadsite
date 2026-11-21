import { nanoid } from "nanoid";
import { z } from "zod";
import { directUploadCap, parseSmallJson, uploadFail } from "../../_lib/upload";
import { clientIp, limiters } from "@/lib/rate-limit";
import { reportError } from "@/lib/monitoring/report";
import { getSettings } from "@/lib/settings";
import { getStorage } from "@/lib/storage";
import type { DirectUploadStart } from "@/lib/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  size: z.number().int().positive(),
  name: z.string().max(500).optional(),
});

/**
 * Step 1 of a direct (browser → bucket) upload. Returns a one-time signed PUT URL, or
 * `mode: 'server'` when the storage has a disk and the classic POST /api/upload applies.
 * The declared size is only a fast pre-check: the commit step re-checks the real bytes.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const storage = getStorage();
    if (!storage.createDirectUpload) {
      const body: DirectUploadStart = { ok: true, mode: "server" };
      return Response.json(body);
    }
    const rl = limiters().upload.check(clientIp(request));
    if (!rl.ok) return uploadFail("rate_limited", { "Retry-After": String(rl.retryAfterSec) });

    const data = await parseSmallJson(request, bodySchema);
    if (!data) return uploadFail("corrupt");
    const settings = await getSettings();
    const max = directUploadCap(settings, storage);
    if (data.size > max) return uploadFail("too_large");

    const uploadId = nanoid();
    const url = await storage.createDirectUpload(uploadId);
    const body: DirectUploadStart = { ok: true, mode: "direct", uploadId, url };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[upload/direct] failed", e);
    reportError(e, { where: "upload.direct", route: "/api/upload/direct" });
    return uploadFail("server_error");
  }
}
