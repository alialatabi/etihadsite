import { nanoid } from "nanoid";
import { BodyTooLarge, declaredLength, readCapped } from "../_lib/body";
import { cleanOriginalName, uploadFail, uploadOk } from "../_lib/upload";
import { MIME_BY_KIND, sniffKind } from "@/lib/design/kind";
import { trackServer } from "@/lib/analytics/server";
import { clientIp, limiters } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Allowance for multipart boundaries/headers on top of the file itself. */
const MULTIPART_OVERHEAD = 64 * 1024;

/** POST multipart/form-data, field `file`. The type is decided by magic bytes, never by client MIME. */
export async function POST(request: Request): Promise<Response> {
  try {
    const rl = limiters().upload.check(clientIp(request));
    if (!rl.ok)
      return uploadFail("rate_limited", { "Retry-After": String(rl.retryAfterSec) });

    const settings = await getSettings();
    const max = settings.maxUploadBytes;

    // The body is never buffered unless it declares (and then stays within) the size cap.
    const declared = declaredLength(request);
    if (declared === null) return uploadFail("corrupt");
    const cap = max + MULTIPART_OVERHEAD;
    if (declared > cap) return uploadFail("too_large");

    let form: FormData;
    try {
      const raw = await readCapped(request, cap);
      form = await new Response(raw as BodyInit, {
        headers: { "content-type": request.headers.get("content-type") ?? "" },
      }).formData();
    } catch (e) {
      return uploadFail(e instanceof BodyTooLarge ? "too_large" : "corrupt");
    }
    const file = form.get("file");
    if (!(file instanceof File)) return uploadFail("corrupt");
    if (file.size > max) return uploadFail("too_large");
    if (file.size === 0) return uploadFail("corrupt");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffKind(bytes);
    if (!kind) return uploadFail("unsupported_type");

    const uploadId = nanoid();
    const originalName = cleanOriginalName(file.name);
    await getStorage().saveUpload(uploadId, bytes, {
      mime: MIME_BY_KIND[kind],
      originalName,
      bytes: bytes.byteLength,
      createdAt: new Date().toISOString(),
    });

    await trackServer(request, { type: "upload", meta: { kind } });
    return uploadOk(uploadId, kind, bytes.byteLength);
  } catch (e) {
    console.error("[upload] failed", e);
    return uploadFail("server_error");
  }
}
