/** Shared by the three upload routes: status table, JSON answers, name clean-up, and the size cap of the two direct-upload steps. */
import { order } from "@/content/ar";
import type {
  DesignKind,
  ShopSettings,
  StorageAdapter,
  UploadError,
  UploadResponse,
} from "@/lib/types";

const UPLOAD_STATUS: Record<UploadError, number> = {
  unsupported_type: 415,
  too_large: 413,
  corrupt: 400,
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

/** Stored file name: "design" when the client sent none, control characters removed, at most 200 characters. */
export function cleanOriginalName(name: string | undefined): string {
  return (name || "design").replace(/[\u0000-\u001f]/g, "").slice(0, 200);
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
