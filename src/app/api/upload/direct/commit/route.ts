import { z } from "zod";
import { order } from "@/content/ar";
import { readCapped } from "../../../_lib/body";
import { sniffKind } from "@/lib/design/normalise.server";
import { trackServer } from "@/lib/analytics/server";
import { getSettings } from "@/lib/settings";
import { getStorage } from "@/lib/storage";
import { ID_RE, uploadPath } from "@/lib/storage/paths";
import type { UploadError, UploadResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS: Record<UploadError, number> = {
  unsupported_type: 415,
  too_large: 413,
  corrupt: 400,
  rate_limited: 429,
  server_error: 500,
};

const MIME = { png: "image/png", jpeg: "image/jpeg", pdf: "application/pdf" } as const;

const bodySchema = z.object({
  uploadId: z.string().regex(ID_RE),
  name: z.string().max(500).optional(),
});

function fail(error: UploadError, headers?: HeadersInit): Response {
  const body: UploadResponse = { ok: false, error, message: order.errors[error] };
  return Response.json(body, { status: STATUS[error], headers });
}

/**
 * Step 2 of a direct upload: the browser has PUT the file to uploads/<id>.bin. The server
 * reads the REAL bytes back and applies the same checks as POST /api/upload (size cap,
 * magic bytes). Only then is the meta written, and readUpload() requires the meta, so an
 * unchecked file can never reach an order. Rejected files are deleted.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    // Not rate-limited again: a commit needs a file that a (rate-limited) start produced.
    let parsed;
    try {
      parsed = bodySchema.safeParse(JSON.parse(new TextDecoder().decode(await readCapped(request, 4096))));
    } catch {
      return fail("corrupt");
    }
    if (!parsed.success) return fail("corrupt");
    const { uploadId } = parsed.data;

    const storage = getStorage();
    if (!storage.createDirectUpload) return fail("corrupt");
    // Already committed (retry after a network blip): answer from the stored meta.
    const existing = await storage.readUpload(uploadId);
    if (existing) {
      const kind = sniffKind(existing.bytes);
      if (!kind) return fail("unsupported_type");
      const body: UploadResponse = { ok: true, uploadId, kind, bytes: existing.bytes.byteLength };
      return Response.json(body);
    }

    const bytes = await storage.readFile(uploadPath(uploadId));
    if (!bytes) return fail("corrupt");
    const settings = await getSettings();
    const reject = async (error: UploadError) => {
      await storage.deleteFile(uploadPath(uploadId)).catch(() => {});
      return fail(error);
    };
    if (bytes.byteLength === 0) return reject("corrupt");
    if (bytes.byteLength > Math.min(settings.maxUploadBytes, storage.directUploadMaxBytes ?? Infinity)) return reject("too_large");
    const kind = sniffKind(bytes);
    if (!kind) return reject("unsupported_type");

    const originalName = (parsed.data.name || "design").replace(/[\u0000-\u001f]/g, "").slice(0, 200);
    const meta = { mime: MIME[kind], originalName, bytes: bytes.byteLength, createdAt: new Date().toISOString() };
    // The meta marks the bytes as checked (readUpload needs both files).
    if (storage.saveUploadMeta) await storage.saveUploadMeta(uploadId, meta);
    else await storage.saveUpload(uploadId, bytes, meta);
    await trackServer(request, { type: "upload", meta: { kind } });
    const body: UploadResponse = { ok: true, uploadId, kind, bytes: bytes.byteLength };
    return Response.json(body);
  } catch (e) {
    console.error("[upload/direct/commit] failed", e);
    return fail("server_error");
  }
}
