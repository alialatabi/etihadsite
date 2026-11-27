import { describe, expect, it } from 'vitest';
import { addWeeks, dayIndex, parseWeekKey, weekEndKey, weekKeyOf, weekRange } from '@/lib/accounting/week';

describe('weekKeyOf', () => {
  it('flips at Saturday 00:00 Baghdad = Friday 21:00 UTC', () => {
    // 2026-11-27 (Friday) 20:59:59.999Z is 23:59:59.999 in Baghdad: still the week of Saturday 2026-11-21.
    expect(weekKeyOf(new Date('2026-11-27T20:59:59.999Z'))).toBe('2026-11-21');
    // 21:00:00Z is Saturday 2026-11-28 00:00 in Baghdad: a new week.
    expect(weekKeyOf(new Date('2026-11-27T21:00:00.000Z'))).toBe('2026-11-28');
  });
  it('Saturday itself, a mid-week day and Friday of the same week share a key', () => {
    expect(weekKeyOf(new Date('2026-11-21T00:00:00+03:00'))).toBe('2026-11-21');
    expect(weekKeyOf(new Date('2026-11-24T12:00:00+03:00'))).toBe('2026-11-21');
    expect(weekKeyOf(new Date('2026-11-27T23:59:59+03:00'))).toBe('2026-11-21');
  });
  it('crosses a year boundary', () => {
    // 2026-01-01 is a Thursday: its Saturday is 2025-12-27.
    expect(weekKeyOf(new Date('2026-01-01T10:00:00+03:00'))).toBe('2025-12-27');
  });
});

describe('weekRange', () => {
  it('runs Saturday 00:00 Baghdad (Friday 21:00 UTC) to the next one', () => {
    expect(weekRange('2026-11-21')).toEqual({ fromIso: '2026-11-20T21:00:00.000Z', toIso: '2026-11-27T21:00:00.000Z' });
  });
  it('is consistent with weekKeyOf on both sides of each bound', () => {
    const { fromIso, toIso } = weekRange('2026-11-21');
    const ms = (iso: string) => new Date(iso).getTime();
    expect(weekKeyOf(new Date(ms(fromIso)))).toBe('2026-11-21');
    expect(weekKeyOf(new Date(ms(fromIso) - 1))).toBe('2026-11-14');
    expect(weekKeyOf(new Date(ms(toIso) - 1))).toBe('2026-11-21');
    expect(weekKeyOf(new Date(ms(toIso)))).toBe('2026-11-28');
  });
});

describe('addWeeks / weekEndKey', () => {
  it('moves by whole calendar weeks, forwards, backwards and over month and year ends', () => {
    expect(addWeeks('2026-11-21', 1)).toBe('2026-11-28');
    expect(addWeeks('2026-11-21', -1)).toBe('2026-11-14');
    expect(addWeeks('2026-12-26', 1)).toBe('2027-01-02');
    expect(addWeeks('2026-11-21', 0)).toBe('2026-11-21');
    expect(addWeeks('2026-11-21', -12)).toBe('2026-08-29');
  });
  it('weekEndKey is the Friday', () => {
    expect(weekEndKey('2026-11-21')).toBe('2026-11-27');
    expect(weekEndKey('2026-12-26')).toBe('2027-01-01');
  });
});

describe('parseWeekKey', () => {
  it('accepts a Saturday only', () => {
    expect(parseWeekKey('2026-11-21')).toBe('2026-11-21');
    expect(parseWeekKey('2026-11-22')).toBeNull();
    expect(parseWeekKey('2026-11-20')).toBeNull();
  });
  it('rejects non-dates and non-strings', () => {
    for (const bad of ['', 'abc', '2026-13-01', '2026-02-30', '2026-11-2', '2026/11/21', ' 2026-11-21', undefined, null, 5, ['2026-11-21']]) {
      expect(parseWeekKey(bad)).toBeNull();
    }
  });
});

describe('dayIndex', () => {
  it('Saturday = 0 .. Friday = 6, in shop time', () => {
    expect(dayIndex('2026-11-21T00:00:00+03:00')).toBe(0);
    expect(dayIndex('2026-11-22T12:00:00+03:00')).toBe(1);
    expect(dayIndex('2026-11-26T12:00:00+03:00')).toBe(5);
    expect(dayIndex('2026-11-27T23:59:59+03:00')).toBe(6);
  });
  it('uses the shop day, not the UTC day', () => {
    expect(dayIndex('2026-11-27T20:59:59.999Z')).toBe(6);
    expect(dayIndex('2026-11-27T21:00:00.000Z')).toBe(0);
  });
});
