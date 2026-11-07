import { nanoid } from "nanoid";
import { z } from "zod";
import { order } from "@/content/ar";
import { readCapped } from "../../_lib/body";
import { clientIp, limiters } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { getStorage } from "@/lib/storage";
import type { DirectUploadStart, UploadError } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS: Record<UploadError, number> = {
  unsupported_type: 415,
  too_large: 413,
  corrupt: 400,
  rate_limited: 429,
  server_error: 500,
};

const bodySchema = z.object({
  size: z.number().int().positive(),
  name: z.string().max(500).optional(),
});

function fail(error: UploadError, headers?: HeadersInit): Response {
  const body: DirectUploadStart = { ok: false, error, message: order.errors[error] };
  return Response.json(body, { status: STATUS[error], headers });
}

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
    if (!rl.ok) return fail("rate_limited", { "Retry-After": String(rl.retryAfterSec) });

    let parsed;
    try {
      parsed = bodySchema.safeParse(JSON.parse(new TextDecoder().decode(await readCapped(request, 4096))));
    } catch {
      return fail("corrupt");
    }
    if (!parsed.success) return fail("corrupt");
    const settings = await getSettings();
    const max = Math.min(settings.maxUploadBytes, storage.directUploadMaxBytes ?? Infinity);
    if (parsed.data.size > max) return fail("too_large");

    const uploadId = nanoid();
    const url = await storage.createDirectUpload(uploadId);
    const body: DirectUploadStart = { ok: true, mode: "direct", uploadId, url };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[upload/direct] failed", e);
    return fail("server_error");
  }
}
