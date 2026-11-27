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

/**
 * The copy of the settings that may be handed to a client component (it is serialised into the
 * page for every visitor). Same type, same keys: values the browser never needs are blanked
 * (the Telegram chat id that receives orders, the AI anti-abuse limits, and the per-sheet prices
 * while pricesPublished is false: the builder never shows them then). The shop's sheet costs
 * (`accounting`) are confidential and removed entirely. Pages that hand
 * `settings` to a 'use client' component pass it through here; server components and the
 * admin may use the full object.
 */
export function toPublicSettings(settings: ShopSettings): ShopSettings {
  // The shop's own costs are confidential: removed, not blanked.
  const rest: ShopSettings = { ...settings };
  delete rest.accounting;
  const { pricing } = rest;
  const publicPricing = settings.pricesPublished
    ? pricing
    : {
        ...pricing,
        materials: {
          paper: { ...pricing.materials.paper, pricePerSheetIqd: 0 },
          plastic: { ...pricing.materials.plastic, pricePerSheetIqd: 0 },
        },
      };
  return {
    ...rest,
    pricing: publicPricing,
    telegramChatId: '',
    ai: { ...settings.ai, perIpDailyLimit: 0, siteDailyLimit: 0 },
  };
}

export const getSettings = cache(async (): Promise<ShopSettings> => getStorage().getSettings());
