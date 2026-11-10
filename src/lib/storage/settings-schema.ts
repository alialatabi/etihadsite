import { z } from 'zod';

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const materialPriceSchema = z.object({
  enabled: z.boolean(),
  pricePerSheetIqd: int(0, 100_000_000),
});

export const pricingSchema = z
  .object({
    materials: z
      .object({ paper: materialPriceSchema, plastic: materialPriceSchema })
      .refine((m) => m.paper.enabled || m.plastic.enabled, 'at least one material must be enabled'),
    minSheets: int(1, 100_000),
    maxSheets: int(1, 100_000),
    tiers: z
      .array(z.object({ minSheets: int(1, 100_000), percent: int(0, 90) }))
      .max(20)
      .refine((t) => new Set(t.map((x) => x.minSheets)).size === t.length, 'duplicate tier')
      .transform((t) => [...t].sort((a, b) => a.minSheets - b.minSheets)),
    quickPicks: z.array(int(1, 100_000)).max(8),
  })
  .refine((p) => p.minSheets <= p.maxSheets, 'minSheets must be ≤ maxSheets');

export const shopSettingsSchema = z.object({
  shopName: z.string().min(1).max(80),
  tagline: z.string().max(160),
  whatsapp: z.string().regex(/^\d{0,15}$/),
  phone: z.string().max(40),
  hours: z.string().max(160),
  area: z.string().max(80),
  telegramChatId: z.string().max(64),
  pricing: pricingSchema,
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
