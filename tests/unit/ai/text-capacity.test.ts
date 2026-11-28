import { describe, expect, it } from 'vitest';
import { textCapacity, usableBoxUm } from '@/lib/ai/text-capacity';

const BIRTHDAY = ['عيد ميلاد سعيد', 'يا حبيبي', 'محمد', 'عمرك سنتين', 'نحبك هواية', 'ماما وبابا'];

describe('textCapacity', () => {
  it('spike a: 5 cm circle holds حلويات الريم / أهلاً وسهلاً / 07801112233', () => {
    const r = textCapacity(['حلويات الريم', 'أهلاً وسهلاً', '07801112233'], 'circle', 50_000, 50_000);
    expect(r.ok).toBe(true);
  });

  it('spike c: 3 cm circle cannot hold the 6 birthday lines', () => {
    const r = textCapacity(BIRTHDAY, 'circle', 30_000, 30_000);
    expect(r.ok).toBe(false);
  });

  it('3 cm circle holds حلويات الريم on 2 rows', () => {
    const r = textCapacity(['حلويات الريم'], 'circle', 30_000, 30_000);
    expect(r).toMatchObject({ ok: true, rowsNeeded: 2, rowsAllowed: 2 });
  });

  it('no lines is always ok', () => {
    expect(textCapacity([], 'circle', 30_000, 30_000)).toMatchObject({ ok: true, rowsNeeded: 0 });
    expect(textCapacity(['  ', ''], 'circle', 30_000, 30_000)).toMatchObject({ ok: true, rowsNeeded: 0 });
  });

  it('tanween does not count', () => {
    // 4 base letters + tanween: 4 chars * 0.55 * 4233 = 9312 um; the 3 cm circle row is 19320 um wide -> 1 row.
    const withMark = textCapacity(['أهلاً'], 'circle', 30_000, 30_000);
    const without = textCapacity(['أهلا'], 'circle', 30_000, 30_000);
    expect(withMark.rowsNeeded).toBe(without.rowsNeeded);
    // Make the count observable: a row holds floor(usable.w / (0.55 * 4233)) chars.
    const perRow = Math.floor((0.7 * 30_000 * 0.92) / (0.55 * 4233)); // 8
    const exactlyFull = 'ا'.repeat(perRow) + 'ً'.repeat(5);
    expect(textCapacity([exactlyFull], 'circle', 30_000, 30_000).rowsNeeded).toBe(1);
  });

  it('minSizeUm is the smallest ok width', () => {
    const r = textCapacity(BIRTHDAY, 'circle', 30_000, 30_000);
    expect(r.ok).toBe(false);
    const min = r.minSizeUm;
    expect(min).not.toBeNull();
    expect(textCapacity(BIRTHDAY, 'circle', min!, min!).ok).toBe(true);
    expect(textCapacity(BIRTHDAY, 'circle', min! - 1000, min! - 1000).ok).toBe(false);
  });

  it('minSizeUm is null when already ok, and when nothing up to 204 mm fits', () => {
    expect(textCapacity(['حلويات'], 'circle', 50_000, 50_000).minSizeUm).toBeNull();
    const huge = Array.from({ length: 200 }, () => 'ا'.repeat(60));
    const r = textCapacity(huge, 'circle', 30_000, 30_000);
    expect(r.ok).toBe(false);
    expect(r.minSizeUm).toBeNull();
  });
});

describe('usableBoxUm', () => {
  it('rect uses 90 % box', () => {
    expect(usableBoxUm('rect', 90_000, 60_000)).toEqual({ w: 81_000, h: 54_000 });
  });

  it('circle uses 0.70 x d x 0.92 on the shorter side', () => {
    const b = usableBoxUm('circle', 50_000, 50_000);
    expect(b.w).toBeCloseTo(32_200, 6);
    expect(b.h).toBeCloseTo(32_200, 6);
  });

  it('rect longer than 3:1 is measured at the 3:1 canvas the model draws', () => {
    expect(usableBoxUm('rect', 200_000, 20_000)).toEqual({ w: 54_000, h: 18_000 });
    expect(usableBoxUm('rect', 20_000, 200_000)).toEqual({ w: 18_000, h: 54_000 });
    expect(usableBoxUm('rect', 60_000, 20_000)).toEqual({ w: 54_000, h: 18_000 });
  });

  it('custom uses 80 % box', () => {
    expect(usableBoxUm('custom', 50_000, 40_000)).toEqual({ w: 40_000, h: 32_000 });
  });
});

describe('textCapacity on a rect longer than 3:1', () => {
  it('20 x 2 cm with one 60-character line does not fit', () => {
    const r = textCapacity(['ا'.repeat(60)], 'rect', 200_000, 20_000);
    expect(r.ok).toBe(false);
  });

  it('28 x 3 cm with two 40-character lines does not fit', () => {
    const r = textCapacity(['ا'.repeat(40), 'ب'.repeat(40)], 'rect', 280_000, 30_000);
    expect(r.ok).toBe(false);
    expect(r.rowsNeeded).toBeGreaterThan(r.rowsAllowed);
  });

  it('a rect up to 3:1 is unchanged', () => {
    expect(textCapacity(['ا'.repeat(10)], 'rect', 90_000, 30_000).ok).toBe(true);
  });
});
