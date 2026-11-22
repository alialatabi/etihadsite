/**
 * Shared by the three upload routes: the status table and JSON answers (`uploadFail`, `uploadOk`), the
 * stored name and meta (`cleanOriginalName`, `uploadMetaFor`), the small-JSON body parse of the two
 * direct-upload steps (`parseSmallJson`) and their size cap (`directUploadCap`). The byte rules
 * (`checkUploadBytes`) live in ./image-header.
 */
import type { z } from "zod";
import { SMALL_JSON_MAX_BYTES, readJsonCapped } from "./body";
import { order } from "@/content/ar";
import { MIME_BY_KIND } from "@/lib/design/kind";
import type {
  DesignKind,
  ShopSettings,
  StorageAdapter,
  StoredFileMeta,
  UploadError,
  UploadResponse,
} from "@/lib/types";

const UPLOAD_STATUS: Record<UploadError, number> = {
  unsupported_type: 415,
  too_large: 413,
  corrupt: 400,
  unsafe: 422,
  rate_limited: 429,
  server_error: 500,
};

/** `{ ok: false, error, message }` with the status of UPLOAD_STATUS. */
export function uploadFail(error: UploadError, headers?: HeadersInit): Response {
  const body: Extract<UploadResponse, { ok: false }> = {
    ok: false,
    error,
    message: order.errors[error],
  };
  return Response.json(body, { status: UPLOAD_STATUS[error], headers });
}

/** `{ ok: true, uploadId, kind, bytes }` (200). */
export function uploadOk(
  uploadId: string,
  kind: DesignKind,
  bytes: number,
): Response {
  const body: UploadResponse = { ok: true, uploadId, kind, bytes };
  return Response.json(body);
}

/** Characters a stored name never keeps: C0 controls, DEL, C1 controls and the bidi controls (U+200E/F, U+202A-E, U+2066-9). */
const NAME_CONTROLS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** Stored file name: "design" when the client sent none, control and bidi-control characters removed, at most 200 characters. */
export function cleanOriginalName(name: string | undefined): string {
  return (name || "design").replace(NAME_CONTROLS, "").slice(0, 200);
}

/** Meta stored with a checked upload. */
export function uploadMetaFor(
  kind: DesignKind,
  name: string | undefined,
  byteLength: number,
): StoredFileMeta {
  return {
    mime: MIME_BY_KIND[kind],
    originalName: cleanOriginalName(name),
    bytes: byteLength,
    createdAt: new Date().toISOString(),
  };
}

/** Parses a small JSON body with `schema`; null when it is too large, not JSON, or does not match. */
export async function parseSmallJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T | null> {
  try {
    const parsed = schema.safeParse(await readJsonCapped(request, SMALL_JSON_MAX_BYTES));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Largest file a direct (browser → bucket) upload may have: the shop cap, bounded by the bucket's. */
export function directUploadCap(
  settings: Pick<ShopSettings, "maxUploadBytes">,
  storage: Pick<StorageAdapter, "directUploadMaxBytes">,
): number {
  return Math.min(
    settings.maxUploadBytes,
    storage.directUploadMaxBytes ?? Infinity,
  );
}
