import 'server-only';
/**
 * Storage adapter factory. One adapter per process: it is kept on globalThis and rebuilt
 * only when the backend, SUPABASE_URL or DATA_DIR changes.
 *
 * `STORAGE=supabase` (hosting): Postgres tables + a private bucket, see ./supabase.ts.
 *   Needs SUPABASE_URL and SUPABASE_SECRET_KEY (server only); getStorage() throws without them.
 * Anything else (the default; local development and tests): files under DATA_DIR
 *   (default ./data), see ./local.ts:
 *     uploads/<uploadId>.bin + <uploadId>.json (StoredFileMeta)
 *     orders/<orderId>.json (OrderRecord) + <orderId>.pdf
 *     settings.json (ShopSettings), customers.json, analytics/events-YYYY-MM.jsonl
 *
 * Both backends use the same storage paths (./paths.ts): relative to DATA_DIR on disk,
 * object keys in the bucket. Each adapter validates a path before it touches anything.
 * getSettings() is DEFAULT_SETTINGS deep-merged with the stored value and validated
 * (parseStoredSettings in ./settings-schema.ts).
 *
 * The variables are read from process.env directly, not through getOrderEnv(): every page
 * and route needs the adapter, so choosing it must neither fail because an unrelated
 * variable is invalid nor re-parse the whole environment on every call.
 */
import type { StorageAdapter } from '@/lib/types';
import { LocalStorage } from './local';
import { SupabaseStorage } from './supabase';

const g = globalThis as unknown as { __epStorage?: { key: string; adapter: StorageAdapter } };

/** The adapter for the current environment (see the header). */
export function getStorage(): StorageAdapter {
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
