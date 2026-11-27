import { describe, expect, it, vi } from 'vitest';
import { parseSettingsForm } from '@/app/admin/settings/parse-form';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { appendSheetCost, parseIqd } from '@/lib/accounting/cost-entry';
import { shopSettingsSchema, parseStoredSettings } from '@/lib/storage/settings-schema';
import type { ShopSettings } from '@/lib/types';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/storage', () => ({ getStorage: () => ({}) }));

const COSTS = [{ from: '2026-11-01T00:00:00.000Z', paperIqd: 300, plasticIqd: 500 }];
const withCosts = (): ShopSettings => ({ ...structuredClone(DEFAULT_SETTINGS), accounting: { sheetCosts: [...COSTS] } });

describe('toPublicSettings', () => {
  it('removes the accounting block entirely (no key left to serialise)', async () => {
    const { toPublicSettings } = await import('@/lib/settings');
    const pub = toPublicSettings(withCosts());
    expect('accounting' in pub).toBe(false);
    expect(JSON.stringify(pub)).not.toContain('paperIqd');
    expect(JSON.stringify(pub)).not.toContain('sheetCosts');
  });
  it('leaves settings without accounting as they were (apart from the existing blanking)', async () => {
    const { toPublicSettings } = await import('@/lib/settings');
    const pub = toPublicSettings(structuredClone(DEFAULT_SETTINGS));
    expect('accounting' in pub).toBe(false);
    expect(pub.shopName).toBe(DEFAULT_SETTINGS.shopName);
  });
  it('does not mutate the settings it was given', async () => {
    const { toPublicSettings } = await import('@/lib/settings');
    const s = withCosts();
    toPublicSettings(s);
    expect(s.accounting?.sheetCosts).toHaveLength(1);
  });
});

describe('settings schema', () => {
  it('DEFAULT_SETTINGS has no accounting and stays valid', () => {
    expect('accounting' in DEFAULT_SETTINGS).toBe(false);
    expect(shopSettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
  it('keeps a stored accounting block when the blob is read back', () => {
    const r = parseStoredSettings({ accounting: { sheetCosts: COSTS } });
    expect(r.ok && r.settings.accounting).toEqual({ sheetCosts: COSTS });
  });
  it('rejects bad entries: negative, fractional, too big, a bad date, more than 500', () => {
    const bad = (e: unknown) => shopSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, accounting: { sheetCosts: [e] } }).success;
    expect(bad({ from: '2026-11-01T00:00:00.000Z', paperIqd: -1, plasticIqd: 0 })).toBe(false);
    expect(bad({ from: '2026-11-01T00:00:00.000Z', paperIqd: 1.5, plasticIqd: 0 })).toBe(false);
    expect(bad({ from: '2026-11-01T00:00:00.000Z', paperIqd: 100_000_001, plasticIqd: 0 })).toBe(false);
    expect(bad({ from: 'yesterday', paperIqd: 1, plasticIqd: 0 })).toBe(false);
    expect(bad({ from: '2026-11-01T00:00:00.000Z', paperIqd: 0, plasticIqd: 100_000_000 })).toBe(true);
    const many = Array.from({ length: 501 }, (_, i) => ({ from: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), paperIqd: 1, plasticIqd: 1 }));
    expect(shopSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, accounting: { sheetCosts: many } }).success).toBe(false);
    expect(shopSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, accounting: { sheetCosts: many.slice(0, 500) } }).success).toBe(true);
  });
});

/** The fields the settings form submits for `s` (the same ones the real form carries). */
function formFor(s: ShopSettings): FormData {
  const mm = (um: number) => String(um / 1000);
  const l = s.layout;
  const fields: Record<string, string | null> = {
    shopName: s.shopName,
    tagline: s.tagline,
    whatsapp: s.whatsapp,
    phone: s.phone,
    hours: s.hours,
    area: s.area,
    telegramChatId: s.telegramChatId,
    paperPrice: String(s.pricing.materials.paper.pricePerSheetIqd),
    paperEnabled: 'on',
    plasticPrice: String(s.pricing.materials.plastic.pricePerSheetIqd),
    plasticEnabled: 'on',
    minSheets: String(s.pricing.minSheets),
    maxSheets: String(s.pricing.maxSheets),
    tiers: JSON.stringify(s.pricing.tiers.map((t) => ({ minSheets: String(t.minSheets), percent: String(t.percent) }))),
    quickPicks: s.pricing.quickPicks.join(','),
    deliveryFeeIqd: String(s.deliveryFeeIqd),
    pricesPublished: s.pricesPublished ? 'on' : null,
    retentionDays: String(s.retentionDays),
    aiEnabled: s.ai.enabled ? 'on' : null,
    aiPerIp: String(s.ai.perIpDailyLimit),
    aiSite: String(s.ai.siteDailyLimit),
    allowRotate: l.allowRotate ? 'on' : null,
    roundedRadius: mm(l.roundedRadiusUm),
    circleMargin: mm(l.circleMarginUm ?? l.marginUm),
    circleGapX: mm(l.circleGapXUm),
    circleGapY: mm(l.circleGapYUm),
    roundedMargin: mm(l.roundedMarginUm ?? l.marginUm),
    roundedGapX: mm(l.rectRoundedGapUm),
    roundedGapY: mm(l.rectRoundedGapYUm ?? l.rectRoundedGapUm),
    sharpMargin: mm(l.sharpMarginUm ?? l.marginUm),
    sharpGapX: mm(l.rectSharpGapUm),
    sharpGapY: mm(l.rectSharpGapYUm ?? l.rectSharpGapUm),
    customMargin: mm(l.customMarginUm ?? l.marginUm),
    customGapX: mm(l.customGapUm),
    customGapY: mm(l.customGapYUm ?? l.customGapUm),
  };
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== null) f.set(k, v);
  return f;
}

describe('saving the settings form', () => {
  it('keeps the sheet costs (the form does not carry them)', () => {
    const current = withCosts();
    const r = parseSettingsForm(formFor(current), current);
    if (!r.ok) throw new Error(`form rejected: ${r.error}`);
    expect(r.settings.accounting).toEqual({ sheetCosts: COSTS });
  });
  it('still works when there is no accounting yet', () => {
    const current = structuredClone(DEFAULT_SETTINGS);
    const r = parseSettingsForm(formFor(current), current);
    if (!r.ok) throw new Error(`form rejected: ${r.error}`);
    expect('accounting' in r.settings).toBe(false);
  });
});

describe('parseIqd', () => {
  it('accepts whole numbers, tolerates grouping, rejects the rest', () => {
    expect(parseIqd('1500')).toBe(1500);
    expect(parseIqd(' 1,500 ')).toBe(1500);
    expect(parseIqd('0')).toBe(0);
    for (const bad of ['', 'abc', '-5', '1.5', '1e3', '1234567890', null]) expect(parseIqd(bad)).toBeNaN();
  });
});

describe('appendSheetCost', () => {
  const now = new Date('2026-11-27T10:00:00.000Z');

  it('appends { from: now, paper, plastic } and keeps the old entries', () => {
    const r = appendSheetCost(withCosts(), 320, 520, now);
    if (!r.ok) throw new Error(r.error);
    expect(r.settings.accounting?.sheetCosts).toEqual([...COSTS, { from: now.toISOString(), paperIqd: 320, plasticIqd: 520 }]);
  });
  it('the first entry creates the accounting block', () => {
    const r = appendSheetCost(structuredClone(DEFAULT_SETTINGS), 300, 500, now);
    expect(r.ok && r.settings.accounting?.sheetCosts).toHaveLength(1);
  });
  it('rejects invalid amounts', () => {
    for (const [p, q] of [[NaN, 1], [1, NaN], [-1, 1], [1.5, 1], [100_000_001, 1]]) {
      expect(appendSheetCost(withCosts(), p, q, now)).toEqual({ ok: false, error: 'invalid' });
    }
  });
  it('skips an entry identical to the one in force', () => {
    expect(appendSheetCost(withCosts(), 300, 500, now)).toEqual({ ok: false, error: 'unchanged' });
  });
  it('at 500 entries it fails and drops nothing', () => {
    const s = withCosts();
    s.accounting = { sheetCosts: Array.from({ length: 500 }, (_, i) => ({ from: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), paperIqd: i, plasticIqd: 1 })) };
    expect(appendSheetCost(s, 7, 7, now)).toEqual({ ok: false, error: 'tooMany' });
    expect(s.accounting.sheetCosts).toHaveLength(500);
  });
  it('does not mutate the settings it was given', () => {
    const s = withCosts();
    appendSheetCost(s, 1, 1, now);
    expect(s.accounting?.sheetCosts).toHaveLength(1);
  });
});
