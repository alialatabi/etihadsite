import 'server-only';
/**
 * Settings loader for server components and route handlers — OWNED BY AGENT D.
 * Phase 0 stub returns the defaults so the shell renders before storage exists.
 * Final version: `return getStorage().getSettings()`.
 */
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { ShopSettings } from '@/lib/types';

export async function getSettings(): Promise<ShopSettings> {
  return DEFAULT_SETTINGS;
}
