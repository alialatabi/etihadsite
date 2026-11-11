import { describe, expect, it } from 'vitest';
import { common } from '@/content/ar/common';
import { count, countLabel, formatCount } from './plural';

const rules = new Intl.PluralRules('ar');
const S = common.plural.sticker;
const H = common.plural.sheet;

describe('count', () => {
  it('stickers across the categories', () => {
    expect(count(0, S)).toBe(S.zero);
    expect(count(1, S)).toBe('ستيكر');
    expect(count(2, S)).toBe('ستيكرين');
    expect(count(3, S)).toBe('ستيكرات');
    expect(count(10, S)).toBe('ستيكرات');
    expect(count(11, S)).toBe('ستيكر');
    expect(count(99, S)).toBe('ستيكر');
    expect(count(100, S)).toBe('ستيكر');
  });
  it('sheets', () => {
    expect(count(1, H)).toBe('ورقة');
    expect(count(2, H)).toBe('ورقتين');
    expect(count(5, H)).toBe('أوراق');
    expect(count(20, H)).toBe('ورقة');
    expect(count(0, H)).toBe(H.zero);
  });
  it('follows Intl for 101, 102, 103, 111, 1000', () => {
    for (const n of [101, 102, 103, 111, 1000]) {
      expect(count(n, H)).toBe(H[rules.select(n) as keyof typeof H]);
    }
    expect(count(101, H)).toBe(H.other);
    expect(count(103, H)).toBe(H.few);
    expect(count(111, H)).toBe(H.many);
    expect(count(1000, H)).toBe(H.other);
  });
});

describe('countLabel', () => {
  it('prefixes a Western-digit number', () => {
    expect(countLabel(54, S)).toBe('54 ستيكر');
    expect(countLabel(2, H)).toBe('2 ورقتين');
    expect(countLabel(1080, S)).toBe('1080 ستيكر');
  });
});

describe('formatCount', () => {
  it('groups thousands with Western digits, like formatIqd', () => {
    expect(formatCount(54)).toBe('54');
    expect(formatCount(1080)).toBe('1,080');
    expect(formatCount(270000)).toBe('270,000');
    expect(formatCount(10_000_000)).toBe('10,000,000');
  });
});
