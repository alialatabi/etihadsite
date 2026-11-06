import { describe, expect, it } from 'vitest';
import { formatCm, normaliseDigits, parseCm } from './cm';
import { formatPhoneLocal, normalisePhone, whatsappUrl } from './phone';

describe('parseCm', () => {
  const ok: [string, number][] = [
    ['3', 30_000],
    ['3,5', 35_000],
    ['3.5', 35_000],
    ['٣٫٢٥', 32_500],
    ['۳٫۵', 35_000],
    [' 4 ', 40_000],
    ['4 سم', 40_000],
    ['4سم', 40_000],
    ['4cm', 40_000],
    ['4 CM', 40_000],
    ['2.3', 23_000],
    ['4.', 40_000],
    ['.5', 5_000],
    ['١٢', 120_000],
  ];
  for (const [i, o] of ok) it(`"${i}" -> ${o}`, () => expect(parseCm(i)).toBe(o));
  const bad = ['abc', '0', '0.0', '-2', '1e3', '', '   ', 'سم', '1.2.3', '1,2,3', '--1', '+3', '3 4', '0.00001', 'NaN', 'Infinity'];
  for (const i of bad) it(`"${i}" -> null`, () => expect(parseCm(i)).toBeNull());
  it('always returns an integer', () => {
    expect(Number.isInteger(parseCm('2.3333333'))).toBe(true);
    expect(parseCm('1.1')).toBe(11_000);
    expect(parseCm('0.0001')).toBe(1);
  });
});

describe('formatCm', () => {
  it('formats', () => {
    expect(formatCm(42_420)).toBe('4.24');
    expect(formatCm(30_000)).toBe('3');
    expect(formatCm(35_000)).toBe('3.5');
    expect(formatCm(10_000)).toBe('1');
    expect(formatCm(23_000)).toBe('2.3');
  });
  it('handles non-finite', () => expect(formatCm(NaN)).toBe(''));
});

describe('normaliseDigits', () => {
  it('maps Arabic-Indic and Persian digits', () => {
    expect(normaliseDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(normaliseDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(normaliseDigits('a٣b.')).toBe('a3b.');
  });
});

describe('normalisePhone', () => {
  const target = '9647701234567';
  for (const i of [
    '07701234567',
    '7701234567',
    '+9647701234567',
    '009647701234567',
    '964 770-123-4567',
    '٠٧٧٠١٢٣٤٥٦٧',
    '(0770) 123 4567',
    '+964 (770) 123-4567',
  ])
    it(`"${i}"`, () => expect(normalisePhone(i)).toBe(target));
  for (const i of ['0770123456', '06801234567', '0171234567', '', 'abc', '077012345678', '96477012345', '9647701234567890'])
    it(`"${i}" -> null`, () => expect(normalisePhone(i)).toBeNull());
});

describe('formatPhoneLocal / whatsappUrl', () => {
  it('formats', () => expect(formatPhoneLocal('9647701234567')).toBe('0770 123 4567'));
  it('leaves malformed input untouched', () => expect(formatPhoneLocal('123')).toBe('123'));
  it('wa.me', () => {
    expect(whatsappUrl('9647701234567')).toBe('https://wa.me/9647701234567');
    expect(whatsappUrl('9647701234567', 'a b')).toBe('https://wa.me/9647701234567?text=a%20b');
  });
});
