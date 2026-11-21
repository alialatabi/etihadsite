/**
 * Numeric limits of the shop settings, kept apart from the zod schema so that any module
 * can read them without loading zod. No imports (settings-schema.ts is loaded by the tsx
 * scripts through storage/local.ts, so everything it imports stays relative and plain).
 */

/** Most discount tiers a shop may define. */
export const MAX_DISCOUNT_TIERS = 20;

/** Highest discount percent of one tier. */
export const MAX_TIER_PERCENT = 90;

/** Most quick-pick sheet counts. */
export const MAX_QUICK_PICKS = 8;

/** Highest AI generations per visitor (IP) per day. */
export const AI_PER_IP_MAX = 100;

/** Highest AI generations per day for the whole site. */
export const AI_SITE_MAX = 10_000;
