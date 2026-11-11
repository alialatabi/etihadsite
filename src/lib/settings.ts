import 'server-only';
/**
 * Shop settings for server components and route handlers, read at request time through the
 * storage adapter: DEFAULT_SETTINGS deep-merged with what the owner saved and validated.
 * The saved value is data/settings.json with STORAGE=local and the public.settings row with
 * STORAGE=supabase; a Supabase outage throws, it never falls back to the defaults.
 *
 * Wrapped in React cache(): during ONE server render the layout, the page and its metadata
 * share a single read. Nothing is kept between requests, and outside a render (for example
 * in a route handler) every call reads again.
 *
 * Code that WRITES settings must read through getStorage().getSettings() directly, so it
 * can never get a value that was cached before its own write.
 */
import { cache } from 'react';
import { getStorage } from '@/lib/storage';
import type { ShopSettings } from '@/lib/types';

export const getSettings = cache(async (): Promise<ShopSettings> => getStorage().getSettings());
