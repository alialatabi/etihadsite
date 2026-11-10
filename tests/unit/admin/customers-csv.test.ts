import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCell, csvDate, customersToCsv, phoneForCsv } from '@/app/api/admin/customers/csv';
import { matchesQuery, type CustomerRow } from '@/app/admin/customers/filter';
import type { CustomerRecord } from '@/lib/types';

describe('csvCell', () => {
  it('quotes and doubles embedded quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a,b')).toBe('"a,b"');
  });
  it('neutralises formula injection', () => {
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('-2')).toBe(`"'-2"`);
    expect(csvCell('@cmd')).toBe(`"'@cmd"`);
    expect(csvCell('\tx')).toBe(`"'\tx"`);
  });
  it('leaves normal text and numbers, handles empty', () => {
    expect(csvCell('بغداد')).toBe('"بغداد"');
    expect(csvCell(1500)).toBe('"1500"');
    expect(csvCell(undefined)).toBe('""');
  });
});

describe('phone and date', () => {
  it('groups the phone so Excel keeps it as text', () => {
    expect(phoneForCsv('9647701234567')).toBe('964 770 123 4567');
  });
  it('formats in Baghdad time', () => {
    expect(csvDate('2026-11-10T21:30:00Z')).toBe('2026-11-11 00:30');
    expect(csvDate('bad')).toBe('');
  });
});

describe('customersToCsv', () => {
  const c: CustomerRecord = {
    phone: '9647701234567',
    name: '=cmd|evil',
    governorate: 'بغداد',
    district: 'الكرادة',
    landmark: 'قرب "المطعم"',
    firstOrderAt: '2026-11-01T09:00:00Z',
    lastOrderAt: '2026-11-10T09:00:00Z',
    ordersCount: 2,
    totalIqd: 25000,
    lastOrderId: 'abc',
    lastDisplayNo: 'EP-1',
  };
  it('starts with BOM, has header + CRLF rows, escapes cells', () => {
    const out = customersToCsv(['n', 'p'], [c]);
    expect(out.startsWith(CSV_BOM)).toBe(true);
    const lines = out.slice(1).split('\r\n');
    expect(lines[0]).toBe('"n","p"');
    expect(lines[1]).toContain(`"'=cmd|evil"`);
    expect(lines[1]).toContain('"964 770 123 4567"');
    expect(lines[1]).toContain('"قرب ""المطعم"""');
    expect(lines[1]).toContain('"25000"');
    expect(lines[2]).toBe('');
  });
});

describe('customer search', () => {
  const row: CustomerRow = {
    phone: '9647701234567',
    name: 'علي',
    governorate: 'بغداد',
    district: '',
    landmark: '',
    ordersCount: 1,
    totalIqd: 0,
    lastLabel: '',
    lastDisplayNo: 'EP-1',
    lastOrderId: null,
  };
  it('matches name, governorate and local/international phone forms', () => {
    expect(matchesQuery(row, '')).toBe(true);
    expect(matchesQuery(row, 'علي')).toBe(true);
    expect(matchesQuery(row, 'بغد')).toBe(true);
    expect(matchesQuery(row, '07701234567')).toBe(true);
    expect(matchesQuery(row, '٠٧٧٠١٢٣')).toBe(true);
    expect(matchesQuery(row, '9647701')).toBe(true);
    expect(matchesQuery(row, 'البصرة')).toBe(false);
    expect(matchesQuery(row, '0780')).toBe(false);
  });
});
