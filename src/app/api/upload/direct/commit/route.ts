import { z } from "zod";
import { SMALL_JSON_MAX_BYTES, readJsonCapped } from "../../../_lib/body";
import { cleanOriginalName, directUploadCap, uploadFail, uploadOk } from "../../../_lib/upload";
import { MIME_BY_KIND, sniffKind } from "@/lib/design/kind";
import { trackServer } from "@/lib/analytics/server";
import { getSettings } from "@/lib/settings";
import { getStorage } from "@/lib/storage";
import { ID_RE, uploadPath } from "@/lib/storage/paths";
import type { UploadError } from "@/lib/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  uploadId: z.string().regex(ID_RE),
  name: z.string().max(500).optional(),
});

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
      parsed = bodySchema.safeParse(await readJsonCapped(request, SMALL_JSON_MAX_BYTES));
    } catch {
      return uploadFail("corrupt");
    }
    if (!parsed.success) return uploadFail("corrupt");
    const { uploadId } = parsed.data;

    const storage = getStorage();
    if (!storage.createDirectUpload) return uploadFail("corrupt");
    // Already committed (retry after a network blip): answer from the stored meta.
    const existing = await storage.readUpload(uploadId);
    if (existing) {
      const kind = sniffKind(existing.bytes);
      if (!kind) return uploadFail("unsupported_type");
      return uploadOk(uploadId, kind, existing.bytes.byteLength);
    }

    const bytes = await storage.readFile(uploadPath(uploadId));
    if (!bytes) return uploadFail("corrupt");
    const settings = await getSettings();
    const reject = async (error: UploadError) => {
      await storage.deleteFile(uploadPath(uploadId)).catch(() => {});
      return uploadFail(error);
    };
    if (bytes.byteLength === 0) return reject("corrupt");
    if (bytes.byteLength > directUploadCap(settings, storage)) return reject("too_large");
    const kind = sniffKind(bytes);
    if (!kind) return reject("unsupported_type");

    const originalName = cleanOriginalName(parsed.data.name);
    const meta = { mime: MIME_BY_KIND[kind], originalName, bytes: bytes.byteLength, createdAt: new Date().toISOString() };
    // The meta marks the bytes as checked (readUpload needs both files).
    if (storage.saveUploadMeta) await storage.saveUploadMeta(uploadId, meta);
    else await storage.saveUpload(uploadId, bytes, meta);
    await trackServer(request, { type: "upload", meta: { kind } });
    return uploadOk(uploadId, kind, bytes.byteLength);
  } catch (e) {
    console.error("[upload/direct/commit] failed", e);
    return uploadFail("server_error");
  }
}
