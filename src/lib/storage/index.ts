import 'server-only';
/**
 * Storage adapter factory — OWNED BY AGENT D.
 *
 * `STORAGE=local` (default): files + JSON under DATA_DIR (default ./data):
 *   data/uploads/<uploadId>.bin + <uploadId>.json (StoredFileMeta)
 *   data/orders/<orderId>.json (OrderRecord), data/orders/<orderId>.pdf
 *   data/settings.json (ShopSettings)
 * Paths returned by saveUpload/savePdf are RELATIVE to DATA_DIR and must be
 * validated against traversal before use in readFile/deleteFile.
 * getSettings() = DEFAULT_SETTINGS deep-merged with settings.json, validated with zod.
 */
import type { StorageAdapter } from '@/lib/types';

export function getStorage(): StorageAdapter {
  throw new Error('NOT_IMPLEMENTED: getStorage (Agent D)');
}
