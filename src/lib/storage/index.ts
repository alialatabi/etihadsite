import 'server-only';
/**
 * Storage adapter factory — OWNED BY AGENT D.
 *
 * `STORAGE=local` (default): files + JSON under DATA_DIR (default ./data):
 *   data/uploads/<uploadId>.bin + <uploadId>.json (StoredFileMeta)
 *   data/orders/<orderId>.json (OrderRecord), data/orders/<orderId>.pdf
 *   data/settings.json (ShopSettings)
 * Paths returned by saveUpload/savePdf are RELATIVE to DATA_DIR and are
 * validated against traversal in readFile/deleteFile.
 * getSettings() = DEFAULT_SETTINGS deep-merged with settings.json, validated with zod.
 */
import type { StorageAdapter } from '@/lib/types';
import { LocalStorage } from './local';

const g = globalThis as unknown as { __epStorage?: { key: string; adapter: StorageAdapter } };

export function getStorage(): StorageAdapter {
  // Deliberately not the full env schema: the public site must render without admin secrets.
  const dir = process.env.DATA_DIR?.trim() || './data';
  const key = `local:${dir}`;
  if (!g.__epStorage || g.__epStorage.key !== key) {
    g.__epStorage = { key, adapter: new LocalStorage(dir) };
  }
  return g.__epStorage.adapter;
}
