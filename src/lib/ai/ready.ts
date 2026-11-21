import 'server-only';
/**
 * Can the site design now? The checks both AI routes make before anything else, in a small module
 * the home page can import without pulling in the routes' image code (sharp, normalise).
 */
import { getStorage } from '@/lib/storage';
import type { ShopSettings, StorageAdapter } from '@/lib/types';
import { openAiConfig } from './openai';

/** A storage adapter with the two methods the daily limits need. */
export type AiStorage = StorageAdapter & Required<Pick<StorageAdapter, 'aiReserve' | 'aiRelease'>>;

export function hasAiStorage(s: StorageAdapter): s is AiStorage {
  return typeof s.aiReserve === 'function' && typeof s.aiRelease === 'function';
}

/**
 * The token key must be a real secret in production: with SESSION_SECRET blank there, both routes
 * answer `unavailable` instead of signing with the public dev salt (anyone could forge a token).
 */
export function secretReady(): boolean {
  return process.env.NODE_ENV !== 'production' || (process.env.SESSION_SECRET ?? '').trim() !== '';
}

/**
 * The site can design now: switch on, OpenAI key set, token secret ready, AI tables available. The home
 * page passes it to the builder, so a missing key shows the notice before the customer types.
 */
export function aiReady(settings: Pick<ShopSettings, 'ai'>): boolean {
  return settings.ai.enabled && openAiConfig() !== null && secretReady() && hasAiStorage(getStorage());
}
