import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  META_STEP_EVENTS,
  isMetaExcludedPath,
  metaIqdPerUsd,
  metaPixelId,
  parseIqdPerUsd,
  parsePixelId,
  purchaseParams,
  purchaseValueUsd,
} from '@/lib/meta/config';

afterEach(() => vi.unstubAllEnvs());

describe('pixel id', () => {
  it('accepts a long decimal id, trimmed', () => {
    expect(parsePixelId('1234567890123456')).toBe('1234567890123456');
    expect(parsePixelId(' 1234567890 ')).toBe('1234567890');
  });

  it('treats anything else as not set', () => {
    for (const v of [undefined, '', '   ', '12345', 'abc1234567', '1234567890123456789012', '12345678 9']) {
      expect(parsePixelId(v)).toBeNull();
    }
  });

  it('reads NEXT_PUBLIC_META_PIXEL_ID', () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '');
    expect(metaPixelId()).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '987654321012345');
    expect(metaPixelId()).toBe('987654321012345');
  });
});

describe('purchase value', () => {
  it('needs a sane IQD-per-USD rate', () => {
    expect(parseIqdPerUsd('1310')).toBe(1310);
    expect(parseIqdPerUsd(' 1460.5 ')).toBe(1460.5);
    for (const v of [undefined, '', '0', '99', '100001', '-1310', '1,310', 'abc', '1e3']) {
      expect(parseIqdPerUsd(v)).toBeNull();
    }
    vi.stubEnv('NEXT_PUBLIC_META_IQD_PER_USD', '1500');
    expect(metaIqdPerUsd()).toBe(1500);
  });

  it('converts to USD with 2 decimals', () => {
    expect(purchaseValueUsd(8000, 1310)).toBe(6.11);
    expect(purchaseValueUsd(15000, 1500)).toBe(10);
  });

  it('never makes up a value: no price, a zero price or no rate means none', () => {
    expect(purchaseValueUsd(null, 1310)).toBeNull();
    expect(purchaseValueUsd(undefined, 1310)).toBeNull();
    expect(purchaseValueUsd(0, 1310)).toBeNull();
    expect(purchaseValueUsd(8000, null)).toBeNull();
    expect(purchaseParams(null, 1310)).toEqual({});
    expect(purchaseParams(8000, null)).toEqual({});
    expect(purchaseParams(8000, 1310)).toEqual({ value: 6.11, currency: 'USD' });
  });
});

describe('step events and excluded paths', () => {
  it('maps the funnel steps to standard events', () => {
    expect(META_STEP_EVENTS).toEqual({ design: 'ViewContent', quantity: 'AddToCart', details: 'InitiateCheckout' });
  });

  it('excludes admin, the staff link and the staff designer in any letter case', () => {
    for (const p of ['/admin', '/admin/orders/x', '/Staff/secret-key', '/staff', '/staff-sheets', '/team', '/TEAM/login']) {
      expect(isMetaExcludedPath(p)).toBe(true);
    }
    for (const p of ['/', '/how-it-works', '/order/success', '/administrator', '/teams']) {
      expect(isMetaExcludedPath(p)).toBe(false);
    }
  });
});
