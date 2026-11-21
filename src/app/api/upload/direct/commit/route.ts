import { z } from "zod";
import { checkUploadBytes } from "../../../_lib/image-header";
import { directUploadCap, parseSmallJson, uploadFail, uploadMetaFor, uploadOk } from "../../../_lib/upload";
import { kindForMime, sniffKind } from "@/lib/design/kind";
import { trackServer } from "@/lib/analytics/server";
import { clientIp, limiters } from "@/lib/rate-limit";
import { reportError } from "@/lib/monitoring/report";
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
    // Its own limiter (not the start's): a retry of a real commit must not be refused by the start's allowance, and a loop of commits must not be free.
    const rl = limiters().commit.check(clientIp(request));
    if (!rl.ok) return uploadFail("rate_limited", { "Retry-After": String(rl.retryAfterSec) });

    const data = await parseSmallJson(request, bodySchema);
    if (!data) return uploadFail("corrupt");
    const { uploadId } = data;

    const storage = getStorage();
    if (!storage.createDirectUpload) return uploadFail("corrupt");
    // Already committed (retry after a network blip): answer from the stored meta. The meta is only
    // written after the bytes passed every check, and uploadInfo() does not download the file (up to 15 MB).
    if (storage.uploadInfo) {
      const info = await storage.uploadInfo(uploadId);
      if (info) {
        const kind = kindForMime(info.meta.mime);
        if (!kind) return uploadFail("unsupported_type");
        return uploadOk(uploadId, kind, info.size);
      }
    }
    // No adapter info, or a null from it (missing, or not a clean answer, which is not proof): readUpload decides.
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
    // A file with only the magic bytes (and junk after them) or an absurd pixel count is deleted, never kept.
    const checked = await checkUploadBytes(bytes);
    if (!checked.ok) return reject(checked.error);
    const { kind } = checked;

    const meta = uploadMetaFor(kind, data.name, bytes.byteLength);
    // The meta marks the bytes as checked (readUpload needs both files).
    if (storage.saveUploadMeta) await storage.saveUploadMeta(uploadId, meta);
    else await storage.saveUpload(uploadId, bytes, meta);
    await trackServer(request, { type: "upload", meta: { kind } });
    return uploadOk(uploadId, kind, bytes.byteLength);
  } catch (e) {
    console.error("[upload/direct/commit] failed", e);
    reportError(e, { where: "upload.directCommit", route: "/api/upload/direct/commit" });
    return uploadFail("server_error");
  }
}
