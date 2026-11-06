import 'server-only';
/**
 * Settings loader for server components and route handlers — OWNED BY AGENT D.
 * Defaults deep-merged with data/settings.json (validated), read at request time.
 */
import { getStorage } from '@/lib/storage';
import type { ShopSettings } from '@/lib/types';

export async function getSettings(): Promise<ShopSettings> {
  return getStorage().getSettings();
}
