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
    marginUm: 7_000,
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
  maxUploadBytes: 10 * 1024 * 1024,
  retentionDays: 30,
};

/** Accepted upload MIME types → DesignKind. */
export const ACCEPTED_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'application/pdf': 'pdf',
} as const;

export const ACCEPTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf'] as const;

/** Alphabet for the human-friendly order number (no 0/O/1/I). */
export const DISPLAY_NO_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Time zone for anything the shop reads. */
export const SHOP_TIME_ZONE = 'Asia/Baghdad';
