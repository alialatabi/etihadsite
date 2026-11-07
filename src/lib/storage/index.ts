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
 *
 * `STORAGE=supabase`: same paths inside a private bucket + Postgres tables (./supabase.ts).
 */
import type { StorageAdapter } from '@/lib/types';
import { LocalStorage } from './local';
import { SupabaseStorage } from './supabase';

const g = globalThis as unknown as { __epStorage?: { key: string; adapter: StorageAdapter } };

/**
 * `STORAGE=supabase` (hosting): Postgres + private bucket, needs SUPABASE_URL and
 * SUPABASE_SECRET_KEY (server-only). Anything else: local files under DATA_DIR.
 */
export function getStorage(): StorageAdapter {
  // Deliberately not the full env schema: the public site must render without admin secrets.
  if (process.env.STORAGE?.trim() === 'supabase') {
    const url = process.env.SUPABASE_URL?.trim();
    const secret = process.env.SUPABASE_SECRET_KEY?.trim();
    if (!url || !secret) throw new Error('STORAGE=supabase needs SUPABASE_URL and SUPABASE_SECRET_KEY');
    const key = `supabase:${url}`;
    if (!g.__epStorage || g.__epStorage.key !== key) g.__epStorage = { key, adapter: new SupabaseStorage(url, secret) };
    return g.__epStorage.adapter;
  }
  const dir = process.env.DATA_DIR?.trim() || './data';
  const key = `local:${dir}`;
  if (!g.__epStorage || g.__epStorage.key !== key) {
    g.__epStorage = { key, adapter: new LocalStorage(dir) };
  }
  return g.__epStorage.adapter;
}
