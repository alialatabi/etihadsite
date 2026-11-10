import { nanoid } from "nanoid";
import { order } from "@/content/ar";
import { BodyTooLarge, declaredLength, readCapped } from "../_lib/body";
import { sniffKind } from "@/lib/design/normalise.server";
import { trackServer } from "@/lib/analytics/server";
import { clientIp, limiters } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { getStorage } from "@/lib/storage";
import type { UploadError, UploadResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS: Record<UploadError, number> = {
  unsupported_type: 415,
  too_large: 413,
  corrupt: 400,
  rate_limited: 429,
  server_error: 500,
};

/** Allowance for multipart boundaries/headers on top of the file itself. */
const MULTIPART_OVERHEAD = 64 * 1024;

const MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
} as const;

function fail(error: UploadError, headers?: HeadersInit): Response {
  const body: UploadResponse = {
    ok: false,
    error,
    message: order.errors[error],
  };
  return Response.json(body, { status: STATUS[error], headers });
}

/** POST multipart/form-data, field `file`. The type is decided by magic bytes, never by client MIME. */
export async function POST(request: Request): Promise<Response> {
  try {
    const rl = limiters().upload.check(clientIp(request));
    if (!rl.ok)
      return fail("rate_limited", { "Retry-After": String(rl.retryAfterSec) });

    const settings = await getSettings();
    const max = settings.maxUploadBytes;

    // The body is never buffered unless it declares (and then stays within) the size cap.
    const declared = declaredLength(request);
    if (declared === null) return fail("corrupt");
    const cap = max + MULTIPART_OVERHEAD;
    if (declared > cap) return fail("too_large");

    let form: FormData;
    try {
      const raw = await readCapped(request, cap);
      form = await new Response(raw as BodyInit, {
        headers: { "content-type": request.headers.get("content-type") ?? "" },
      }).formData();
    } catch (e) {
      return fail(e instanceof BodyTooLarge ? "too_large" : "corrupt");
    }
    const file = form.get("file");
    if (!(file instanceof File)) return fail("corrupt");
    if (file.size > max) return fail("too_large");
    if (file.size === 0) return fail("corrupt");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffKind(bytes);
    if (!kind) return fail("unsupported_type");

    const uploadId = nanoid();
    const originalName = (file.name || "design")
      .replace(/[\u0000-\u001f]/g, "")
      .slice(0, 200);
    await getStorage().saveUpload(uploadId, bytes, {
      mime: MIME[kind],
      originalName,
      bytes: bytes.byteLength,
      createdAt: new Date().toISOString(),
    });

    await trackServer(request, { type: "upload", meta: { kind } });
    const body: UploadResponse = {
      ok: true,
      uploadId,
      kind,
      bytes: bytes.byteLength,
    };
    return Response.json(body);
  } catch (e) {
    console.error("[upload] failed", e);
    return fail("server_error");
  }
}
