import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCell, csvDate, customersCsv, customersToCsv, onlyMarketingOptIn, phoneForCsv } from '@/app/api/admin/customers/csv';
import { matchesOffers, matchesQuery, type CustomerRow } from '@/app/admin/customers/filter';
import { admin } from '@/content/ar';
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

describe('customersCsv: WhatsApp offers columns and filter', () => {
  const base: CustomerRecord = {
    phone: '9647701234567',
    governorate: 'بغداد',
    district: 'الكرادة',
    landmark: 'x',
    firstOrderAt: '2026-11-01T09:00:00Z',
    lastOrderAt: '2026-11-10T09:00:00Z',
    ordersCount: 1,
    totalIqd: 0,
    lastOrderId: 'abc',
    lastDisplayNo: 'EP-1',
  };
  const yes: CustomerRecord = { ...base, phone: '9647701111111', marketingOptIn: true, marketingOptInAt: '2026-11-10T21:30:00Z' };
  const withdrawn: CustomerRecord = { ...base, phone: '9647702222222', marketingOptIn: false, marketingOptInAt: null };
  const never: CustomerRecord = { ...base, phone: '9647703333333' };
  const rows = (csv: string) => csv.slice(1).split('\r\n').filter(Boolean).map((l) => l.slice(1, -1).split('","'));

  it('appends the opt-in and its date as the LAST two columns, leaving the first ten where they were', () => {
    const [head, a, b, c] = rows(customersCsv([yes, withdrawn, never]));
    expect(head).toHaveLength(12);
    expect(head.slice(10)).toEqual([admin.customers.columns.marketing, admin.customers.columns.marketingAt]);
    expect(head[9]).toBe(admin.customers.lastNo);
    expect(a.slice(10)).toEqual([admin.customers.marketingYes, '2026-11-11 00:30']);
    expect(b.slice(10)).toEqual([admin.customers.marketingNo, '']);
    expect(c.slice(10)).toEqual([admin.customers.marketingNo, '']);
  });

  it('marketingOnly exports only customers who opted in', () => {
    const out = rows(customersCsv([yes, withdrawn, never], { marketingOnly: true }));
    expect(out).toHaveLength(2);
    expect(out[1][1]).toBe('964 770 111 1111');
    expect(rows(customersCsv([withdrawn, never], { marketingOnly: true }))).toHaveLength(1); // header only
    expect(onlyMarketingOptIn([yes, withdrawn, never])).toEqual([yes]);
  });

  it('the admin list filter keeps everyone when off and only opted-in rows when on', () => {
    const row = (marketingOptIn?: boolean): CustomerRow => ({
      phone: '9647701234567', name: '', governorate: 'بغداد', district: '', landmark: '', ordersCount: 1, totalIqd: 0, lastLabel: '', lastDisplayNo: 'EP-1', lastOrderId: null, marketingOptIn,
    });
    expect([row(true), row(false), row()].map((r) => matchesOffers(r, false))).toEqual([true, true, true]);
    expect([row(true), row(false), row()].map((r) => matchesOffers(r, true))).toEqual([true, false, false]);
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
