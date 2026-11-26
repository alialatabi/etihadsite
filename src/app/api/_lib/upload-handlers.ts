/**
 * The three upload route bodies, shared by the customer routes (/api/upload*, limited per IP) and the staff routes
 * (/api/team/upload*, behind the staff login and limited per account). Only the rate-limit gate and the route name
 * (for the error report) differ; every byte check is the same.
 */
import { nanoid } from "nanoid";
import { z } from "zod";
import { BodyTooLarge, declaredLength, readCapped } from "./body";
import { checkUploadBytes } from "./image-header";
import { directUploadCap, parseSmallJson, uploadFail, uploadMetaFor, uploadOk } from "./upload";
import { kindForMime, sniffKind } from "@/lib/design/kind";
import { trackServer } from "@/lib/analytics/server";
import { reportError } from "@/lib/monitoring/report";
import { getSettings } from "@/lib/settings";
import { getStorage } from "@/lib/storage";
import { ID_RE, uploadPath } from "@/lib/storage/paths";
import type { DirectUploadStart, UploadError } from "@/lib/types";

/** Records one hit against the caller's allowance (per IP for customers, per account for staff). */
export type UploadGate = () => { ok: boolean; retryAfterSec: number };
export interface UploadRouteOpts {
  gate: UploadGate;
  /** For the log line and the error report, e.g. "/api/upload/direct". */
  route: string;
  /** false for the staff routes: /team stays out of the site analytics. Default true. */
  track?: boolean;
}

const tag = (route: string) => route.replace(/^\/api\//, "");
const limited = (rl: { retryAfterSec: number }) => uploadFail("rate_limited", { "Retry-After": String(rl.retryAfterSec) });

const startSchema = z.object({
  size: z.number().int().positive(),
  name: z.string().max(500).optional(),
});

/**
 * Step 1 of a direct (browser → bucket) upload. Returns a one-time signed PUT URL, or
 * `mode: 'server'` when the storage has a disk and the classic POST /api/upload applies.
 * The declared size is only a fast pre-check: the commit step re-checks the real bytes.
 */
export async function handleUploadStart(request: Request, { gate, route }: UploadRouteOpts): Promise<Response> {
  try {
    const storage = getStorage();
    if (!storage.createDirectUpload) {
      const body: DirectUploadStart = { ok: true, mode: "server" };
      return Response.json(body);
    }
    const rl = gate();
    if (!rl.ok) return limited(rl);

    const data = await parseSmallJson(request, startSchema);
    if (!data) return uploadFail("corrupt");
    const settings = await getSettings();
    const max = directUploadCap(settings, storage);
    if (data.size > max) return uploadFail("too_large");

    const uploadId = nanoid();
    const url = await storage.createDirectUpload(uploadId);
    const body: DirectUploadStart = { ok: true, mode: "direct", uploadId, url };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(`[${tag(route)}] failed`, e);
    reportError(e, { where: "upload.direct", route });
    return uploadFail("server_error");
  }
}

const commitSchema = z.object({
  uploadId: z.string().regex(ID_RE),
  name: z.string().max(500).optional(),
});

/**
 * Step 2 of a direct upload: the browser has PUT the file to uploads/<id>.bin. The server
 * reads the REAL bytes back and applies the same checks as POST /api/upload (size cap,
 * magic bytes). Only then is the meta written, and readUpload() requires the meta, so an
 * unchecked file can never reach an order. Rejected files are deleted.
 */
export async function handleUploadCommit(request: Request, { gate, route, track = true }: UploadRouteOpts): Promise<Response> {
  try {
    // Its own gate (not the start's): a retry of a real commit must not be refused by the start's allowance, and a loop of commits must not be free.
    const rl = gate();
    if (!rl.ok) return limited(rl);

    const data = await parseSmallJson(request, commitSchema);
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
    if (track) await trackServer(request, { type: "upload", meta: { kind } });
    return uploadOk(uploadId, kind, bytes.byteLength);
  } catch (e) {
    console.error(`[${tag(route)}] failed`, e);
    reportError(e, { where: "upload.directCommit", route });
    return uploadFail("server_error");
  }
}

/** Allowance for multipart boundaries/headers on top of the file itself. */
const MULTIPART_OVERHEAD = 64 * 1024;

/** POST multipart/form-data, field `file`. The type is decided by magic bytes, never by client MIME. */
export async function handleUploadServer(request: Request, { gate, route, track = true }: UploadRouteOpts): Promise<Response> {
  try {
    const rl = gate();
    if (!rl.ok) return limited(rl);

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
    // Magic bytes alone prove nothing: a PNG/JPEG must have a readable header within the pixel cap and decode, a PDF must carry no active content (see _lib/file-safety).
    const checked = await checkUploadBytes(bytes);
    if (!checked.ok) return uploadFail(checked.error);
    const { kind } = checked;

    const uploadId = nanoid();
    await getStorage().saveUpload(uploadId, bytes, uploadMetaFor(kind, file.name, bytes.byteLength));

    if (track) await trackServer(request, { type: "upload", meta: { kind } });
    return uploadOk(uploadId, kind, bytes.byteLength);
  } catch (e) {
    console.error(`[${tag(route)}] failed`, e);
    reportError(e, { where: "upload.post", route });
    return uploadFail("server_error");
  }
}
