/** Millimetre parsing for the receipts spacing fields (src/lib/parse/mm.ts). */
import { describe, expect, it } from 'vitest';
import { formatMm, parseMm } from '@/lib/parse/mm';

describe('parseMm', () => {
  it('zero is allowed', () => {
    expect(parseMm('0')).toBe(0);
    expect(parseMm('0.0')).toBe(0);
    expect(parseMm(' ٠ ')).toBe(0);
  });
  it('whole and decimal numbers become integer micrometres', () => {
    expect(parseMm('15')).toBe(15_000);
    expect(parseMm('7.5')).toBe(7_500);
    expect(parseMm('7,5')).toBe(7_500);
    expect(parseMm('.5')).toBe(500);
    expect(parseMm('7.')).toBe(7_000);
    expect(parseMm('7.22')).toBe(7_220);
  });
  it('rounds to the micrometre', () => {
    expect(parseMm('7.2204')).toBe(7_220);
    expect(parseMm('7.2206')).toBe(7_221);
  });
  it('Arabic-Indic and Persian digits, Arabic decimal mark', () => {
    expect(parseMm('٧٫٢٢')).toBe(7_220);
    expect(parseMm('۱۵')).toBe(15_000);
    expect(parseMm('٧,٥')).toBe(7_500);
  });
  it('surrounding spaces and a trailing unit', () => {
    expect(parseMm('  15  ')).toBe(15_000);
    expect(parseMm('15 ملم')).toBe(15_000);
    expect(parseMm('15ملم')).toBe(15_000);
    expect(parseMm('15 مم')).toBe(15_000);
    expect(parseMm('7.5 mm')).toBe(7_500);
    expect(parseMm('7.5MM')).toBe(7_500);
  });
  it('empty, negative, exponent and garbage are null', () => {
    for (const bad of ['', '   ', '-1', '-0', '+1', '1e2', 'abc', '1 2', '1..2', '1.2.3', 'ملم', 'mm', '5 سم', '٣ cm', 'NaN', 'Infinity']) {
      expect(parseMm(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it('a number too big to be a safe integer is null', () => {
    expect(parseMm('9'.repeat(40))).toBeNull();
  });
  it('a non-string is null', () => {
    expect(parseMm(undefined as unknown as string)).toBeNull();
    expect(parseMm(5 as unknown as string)).toBeNull();
  });
});

describe('formatMm', () => {
  it('up to two decimals, Western digits, no unit', () => {
    expect(formatMm(7_220)).toBe('7.22');
    expect(formatMm(15_000)).toBe('15');
    expect(formatMm(0)).toBe('0');
    expect(formatMm(7_360)).toBe('7.36');
    expect(formatMm(7_500)).toBe('7.5');
    expect(formatMm(7_001)).toBe('7');
  });
  it('is not a number: empty text', () => {
    expect(formatMm(Number.NaN)).toBe('');
  });
  it('round-trips the owner defaults', () => {
    for (const um of [0, 7_000, 7_220, 7_360, 8_000, 12_000, 15_000]) expect(parseMm(formatMm(um))).toBe(um);
  });
});
