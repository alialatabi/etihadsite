import { describe, expect, it } from 'vitest';
import { SHOP_TIME_ZONE } from '@/config/defaults';
import { DAY_MS, formatShopDateTime, shopDayKey } from './shop-time';

/** Fresh formatters with the options the call sites used before they shared one module. */
const freshDateTime = (iso: string) =>
  new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
    timeZone: SHOP_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));

const freshDayKey = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

// Baghdad is UTC+3 all year, so its midnight is 21:00 UTC.
const INSTANTS = [
  '2026-11-09T20:59:59.999Z', // last millisecond of 9 Nov in Baghdad
  '2026-11-09T21:00:00.000Z', // first millisecond of 10 Nov in Baghdad
  '2026-11-10T20:59:00.000Z',
  '2026-11-10T21:00:00.000Z',
  '2025-12-31T20:59:59.000Z', // year boundary
  '2025-12-31T21:00:00.000Z',
  '2026-02-28T20:59:59.000Z', // month boundary
  '2026-02-28T21:00:00.000Z',
  '2026-06-15T09:30:00.000Z', // midday
];

describe('shop time', () => {
  it('DAY_MS is one day', () => expect(DAY_MS).toBe(24 * 60 * 60 * 1000));

  it.each(INSTANTS)('formatShopDateTime(%s) equals a freshly built formatter', (iso) => {
    expect(formatShopDateTime(iso)).toBe(freshDateTime(iso));
  });

  it.each(INSTANTS)('shopDayKey(%s) equals a freshly built formatter', (iso) => {
    expect(shopDayKey(new Date(iso))).toBe(freshDayKey(new Date(iso)));
  });

  it('the day key changes exactly at Baghdad midnight', () => {
    expect(shopDayKey(new Date('2026-11-09T20:59:59.999Z'))).toBe('2026-11-09');
    expect(shopDayKey(new Date('2026-11-09T21:00:00.000Z'))).toBe('2026-11-10');
    expect(shopDayKey(new Date('2025-12-31T21:00:00.000Z'))).toBe('2026-01-01');
  });

  it('the date-time text differs on the two sides of Baghdad midnight', () => {
    expect(formatShopDateTime('2026-11-09T20:59:59.999Z')).not.toBe(formatShopDateTime('2026-11-09T21:00:00.000Z'));
  });

  it('formatShopDateTime throws for an invalid date, like the formatter it replaced', () => {
    expect(() => formatShopDateTime('not-a-date')).toThrow(RangeError);
    expect(() => freshDateTime('not-a-date')).toThrow(RangeError);
  });
});
