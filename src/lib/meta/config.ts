/**
 * Meta ads measurement (owner request, 2026-11-27): the Meta Pixel in the browser and the
 * Conversions API copy of a purchase on the server, so ad campaigns can learn from what customers
 * do on the site. Everything is OFF until the owner sets NEXT_PUBLIC_META_PIXEL_ID; the server copy
 * also needs META_CAPI_TOKEN. Pure and isomorphic: no React, no server code, no secrets here.
 * See "Meta Pixel and Conversions API" in docs/ARCHITECTURE.md.
 */
import type { BuilderStep } from '@/lib/types';
import { isAdminPath, isStaffPath } from '@/lib/analytics/paths';

/** A Meta dataset (pixel) id is a long decimal number; anything else counts as "not set". */
export function parsePixelId(raw: string | undefined): string | null {
  const v = raw?.trim();
  return v && /^\d{6,20}$/.test(v) ? v : null;
}

/**
 * The pixel id. A NEXT_PUBLIC_ variable is inlined at BUILD time: after setting or changing it on
 * Vercel, redeploy. The literal `process.env.NEXT_PUBLIC_META_PIXEL_ID` must stay spelled out for that.
 */
export function metaPixelId(): string | null {
  return parsePixelId(process.env.NEXT_PUBLIC_META_PIXEL_ID);
}

/**
 * Meta does not accept IQD as an event currency, so a purchase value is sent in USD at a rate the
 * owner sets (IQD per 1 USD). No rate, or a rate outside 100-100 000, means no value is sent: the
 * purchase is still counted, the site never makes up a number.
 */
export function parseIqdPerUsd(raw: string | undefined): number | null {
  const v = raw?.trim();
  if (!v || !/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 100 && n <= 100_000 ? n : null;
}

/** The owner's rate, inlined at build time like the pixel id (it is read in the browser too). */
export function metaIqdPerUsd(): number | null {
  return parseIqdPerUsd(process.env.NEXT_PUBLIC_META_IQD_PER_USD);
}

/** The value Meta gets for a purchase: USD, 2 decimals, or null when there is no price or no rate. */
export function purchaseValueUsd(totalIqd: number | null | undefined, iqdPerUsd: number | null): number | null {
  if (totalIqd == null || !Number.isFinite(totalIqd) || totalIqd <= 0 || iqdPerUsd == null) return null;
  return Math.round((totalIqd / iqdPerUsd) * 100) / 100;
}

/** `{ value, currency }` for a Purchase, or `{}`: the browser and server copies send the same thing. */
export function purchaseParams(
  totalIqd: number | null | undefined,
  iqdPerUsd: number | null,
): { value: number; currency: 'USD' } | Record<string, never> {
  const value = purchaseValueUsd(totalIqd, iqdPerUsd);
  return value === null ? {} : { value, currency: 'USD' };
}

/** The Meta standard events the site sends. */
export type MetaStandardEvent = 'PageView' | 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Purchase';

/**
 * Builder step shown → the standard event it stands for. Sent once per step per browser session,
 * together with the first-party 'step' event. `shape` is the first thing on the home page, so it is
 * only a PageView; `size` adds nothing between design and quantity.
 */
export const META_STEP_EVENTS: Readonly<Partial<Record<BuilderStep, MetaStandardEvent>>> = {
  design: 'ViewContent',
  quantity: 'AddToCart',
  details: 'InitiateCheckout',
};

/** Paths Meta never hears about, in any letter case: the admin, the secret staff link, the staff designer. */
export function isMetaExcludedPath(path: string): boolean {
  return isAdminPath(path) || isStaffPath(path);
}
