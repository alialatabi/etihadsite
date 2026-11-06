import { z } from 'zod';

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const offerSchema = z.object({
  id: z.string().min(1).max(40),
  sheets: int(1, 100_000),
  priceIqd: int(0, 1_000_000_000).nullable(),
  badge: z.string().max(40).optional(),
  enabled: z.boolean(),
});

export const shopSettingsSchema = z.object({
  shopName: z.string().min(1).max(80),
  tagline: z.string().max(160),
  whatsapp: z.string().regex(/^\d{0,15}$/),
  phone: z.string().max(40),
  hours: z.string().max(160),
  area: z.string().max(80),
  telegramChatId: z.string().max(64),
  offers: z
    .array(offerSchema)
    .max(20)
    .refine((o) => new Set(o.map((x) => x.id)).size === o.length, 'duplicate offer id'),
  deliveryFeeIqd: int(0, 1_000_000_000),
  pricesPublished: z.boolean(),
  layout: z.object({
    marginUm: int(0, 50_000),
    circleGapXUm: int(0, 50_000),
    circleGapYUm: int(0, 50_000),
    rectRoundedGapUm: int(0, 50_000),
    rectSharpGapUm: int(0, 50_000),
    customGapUm: int(0, 50_000),
    roundedRadiusUm: int(0, 100_000),
    allowRotate: z.boolean(),
    minSideUm: int(1_000, 100_000),
  }),
  quality: z.object({
    warnDpi: int(1, 2400),
    blockDpi: int(1, 2400),
    targetDpi: int(72, 1200),
  }),
  maxUploadBytes: int(1024, 100 * 1024 * 1024),
  retentionDays: int(1, 3650),
});
