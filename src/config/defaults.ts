/**
 * Default shop settings.
 *
 * These are the values the site uses until the owner edits them in the admin
 * dashboard (/admin/settings). Safe to import from client components: it
 * contains no secrets.
 */
import type { ShopSettings } from '@/lib/types';

export const DEFAULT_SETTINGS: ShopSettings = {
  shopName: 'مطبعة سوفتي',
  tagline: 'طباعة ستيكرات على قياسك',
  whatsapp: '',
  phone: '',
  hours: 'السبت – الخميس، 10 صباحاً – 8 مساءً',
  area: 'بغداد',
  telegramChatId: '',
  // Owner's pricing (2026-11-10): per sheet by material, min 10 sheets, bigger orders = bigger discount.
  pricing: {
    materials: {
      paper: { enabled: true, pricePerSheetIqd: 800 },
      plastic: { enabled: true, pricePerSheetIqd: 1_500 },
    },
    minSheets: 10,
    maxSheets: 5_000,
    tiers: [
      { minSheets: 20, percent: 10 },
      { minSheets: 50, percent: 15 },
      { minSheets: 100, percent: 20 },
    ],
    quickPicks: [10, 20, 50, 100],
  },
  // Flat for every governorate.
  deliveryFeeIqd: 5_000,
  pricesPublished: true,
  layout: {
    marginUm: 3_000,
    // Owner's choice (Q1 = B): 2 mm between columns, rows touching.
    circleGapXUm: 2_000,
    circleGapYUm: 0,
    rectRoundedGapUm: 2_000,
    rectSharpGapUm: 0,
    customGapUm: 2_000,
    roundedRadiusUm: 3_000,
    allowRotate: false,
    minSideUm: 5_000,
  },
  quality: {
    warnDpi: 150,
    blockDpi: 72,
    targetDpi: 300,
  },
  maxUploadBytes: 15 * 1024 * 1024,
  retentionDays: 30,
  ai: { enabled: true, perIpDailyLimit: 5, siteDailyLimit: 300 },
};

/** Accepted upload MIME types → DesignKind. */
export const ACCEPTED_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'application/pdf': 'pdf',
} as const;

export const ACCEPTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf'] as const;

/**
 * Most designs one order may carry (owner 2026-11-22). 8 fits the 20-uploads-per-hour limit
 * with room for one retry. A multi-design order has 2..MAX_DESIGNS designs.
 */
export const MAX_DESIGNS = 8;

/**
 * Multi-design orders on/off (owner 2026-11-22: «وقف هاذي الميزة لا تمسحها»). While false the
 * «عندي أكثر من تصميم» checkbox is hidden, a saved multi-design draft comes back as a single design,
 * and the order route refuses a request carrying `designs`. Set to true to switch the feature back on.
 */
export const MULTI_DESIGN_ENABLED: boolean = false;

/** Alphabet for the human-friendly order number (no 0/O/1/I). */
export const DISPLAY_NO_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Retention rule switch (owner decision D10). Orders created BEFORE this instant keep the old
 * rule (record, print PDF and design deleted after retentionDays, as those customers were told).
 * Orders from it on are kept forever with the design they used; only their print PDF is purged.
 * Designs no order used (AI or staff designs, plain uploads) are NOT kept forever: they are deleted
 * UNORDERED_DESIGN_DAYS (7) after they were made (owner 2026-11-26; cron aiPurgeUnordered + purgeUnusedUploads).
 * Set it to the real deploy date in the deploy commit.
 */
export const KEEP_DESIGNS_FROM = '2026-11-21T00:00:00+03:00';

/**
 * Designs no order used (AI designs and plain uploads) are deleted this many days after they were
 * made (owner 2026-11-26: «التصاميم الي ما ينطلب طلبها تنحذف بعد اسبوع»). Designs an order used are kept.
 */
export const UNORDERED_DESIGN_DAYS = 7;

/**
 * When the daily retention purge (GET /api/cron/purge) runs, in UTC. MUST match the `crons` schedule in
 * vercel.json ("30 1 * * *" = 01:30 UTC); tests/unit/admin/designs-expiry.test.ts fails when they differ.
 * The admin designs gallery uses it to say on which day an unordered design really goes.
 */
export const PURGE_CRON_UTC = { hour: 1, minute: 30 } as const;

/**
 * A design younger than this cannot be deleted by hand from the admin gallery: the builder keeps a customer's
 * draft (and the design in it) for 2 hours, so a young design may be in an order being placed right now.
 * Keep it at least the builder's DRAFT_TTL_MS (src/components/builder/logic.ts; a test checks it).
 */
export const DESIGN_DELETE_MIN_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * listOrders() answers at most this many orders (the newest, Supabase `limit=1000`): everything that
 * searches or counts "all orders" from that list only covers those. One constant for every page that says so
 * (the orders list and the admin designs search).
 */
export const ORDERS_LIST_CAP = 1000;

/** Each retention purge only looks at items created in [cutoff − this many days, cutoff). */
export const PURGE_WINDOW_DAYS = 30;

/** Time zone for anything the shop reads. */
export const SHOP_TIME_ZONE = 'Asia/Baghdad';
