import { describe, expect, it, vi } from 'vitest';
import type { OrderRecord, ShopSettings } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { accountCsvCell, CSV_BOM, weekCsv } from '@/lib/accounting/csv';
import { computeWeek } from '@/lib/accounting/compute';
import { makeOrder } from './fixtures';

const COSTS = [{ from: '2026-11-01T00:00:00.000Z', paperIqd: 300, plasticIqd: 500 }];

describe('accountCsvCell', () => {
  it('quotes and escapes quotes', () => {
    expect(accountCsvCell('a"b')).toBe('"a""b"');
    expect(accountCsvCell(null)).toBe('""');
  });
  it('neutralises text that a spreadsheet would run as a formula', () => {
    for (const t of ['=1+1', '+SUM(A1)', '-2', '@x', '\tx', '\rx']) {
      expect(accountCsvCell(t)).toBe(`"'${t}"`);
    }
  });
  it('leaves numbers alone, negatives included', () => {
    expect(accountCsvCell(-500)).toBe('"-500"');
    expect(accountCsvCell(0)).toBe('"0"');
    expect(accountCsvCell(15000)).toBe('"15000"');
  });
});

describe('weekCsv', () => {
  const orders = [
    makeOrder({ id: 'a', createdAt: '2026-11-21T09:00:00+03:00', sheets: 10, unitBase: 1000 }),
    makeOrder({ id: 'b', createdAt: '2026-11-22T09:00:00+03:00', sheets: 2, unitBase: 100 }), // sells below cost: negative profit
    makeOrder({ id: 'c', createdAt: '2026-11-23T09:00:00+03:00', unitBase: null }),
    makeOrder({ id: 'd', createdAt: '2026-11-24T09:00:00+03:00', status: 'cancelled' }),
  ];
  const text = weekCsv(computeWeek(orders, COSTS));
  const lines = text.split('\r\n');

  it('UTF-8 BOM, CRLF, a closing CRLF', () => {
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.includes('\n') && text.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  it('header + sold orders (no cancelled one) + totals', () => {
    // header, a, b, c, total, trailing empty
    expect(lines).toHaveLength(6);
    expect(text).not.toContain('EP-d');
  });

  it('a negative profit stays a plain number', () => {
    // b: subtotal 200 - cost 2*300 = -400
    const b = lines.find((l) => l.includes('EP-b'))!;
    expect(b).toContain(',"-400"');
    expect(b).not.toContain("'-400");
  });

  it('an unpriced order has empty money cells', () => {
    const c = lines.find((l) => l.includes('EP-c'))!;
    expect(c.endsWith(',"","",""')).toBe(true);
  });

  it('has no customer fields', () => {
    for (const secret of ['زبون سري', '9647701234567', 'بغداد', 'المنطقة', 'قرب الجسر']) expect(text).not.toContain(secret);
  });

  it('a hostile display number is neutralised', () => {
    const o: OrderRecord = { ...makeOrder({ createdAt: '2026-11-21T09:00:00+03:00' }), displayNo: '=HYPERLINK("x")' };
    expect(weekCsv(computeWeek([o], COSTS))).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('GET /api/admin/accounts/export', () => {
  it('serves the CSV as an attachment named accounts-<week>.csv', async () => {
    vi.resetModules();
    const listed: Array<[string, string]> = [];
    const settings: ShopSettings = { ...structuredClone(DEFAULT_SETTINGS), accounting: { sheetCosts: COSTS } };
    vi.doMock('@/lib/auth/session', () => ({ adminApiGuard: async () => null }));
    vi.doMock('@/lib/storage', () => ({
      getStorage: () => ({
        listOrdersBetween: async (a: string, b: string) => {
          listed.push([a, b]);
          return [makeOrder({ createdAt: '2026-11-21T09:00:00+03:00' })];
        },
        getSettings: async () => settings,
      }),
    }));
    const { GET } = await import('@/app/api/admin/accounts/export/route');
    const res = await GET(new Request('http://localhost/api/admin/accounts/export?week=2026-11-14'));
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="accounts-2026-11-14.csv"');
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(listed[0]).toEqual(['2026-11-13T21:00:00.000Z', '2026-11-20T21:00:00.000Z']);
    // A non-Saturday falls back to the current week, never to the raw input.
    const bad = await GET(new Request('http://localhost/api/admin/accounts/export?week=2026-11-22'));
    expect(bad.headers.get('content-disposition')).not.toContain('2026-11-22');
    vi.doUnmock('@/lib/auth/session');
    vi.doUnmock('@/lib/storage');
  });

  it('refuses without a session', async () => {
    vi.resetModules();
    vi.doMock('@/lib/auth/session', () => ({ adminApiGuard: async () => new Response('no', { status: 401 }) }));
    vi.doMock('@/lib/storage', () => ({ getStorage: () => ({}) }));
    const { GET } = await import('@/app/api/admin/accounts/export/route');
    expect((await GET(new Request('http://localhost/api/admin/accounts/export'))).status).toBe(401);
    vi.doUnmock('@/lib/auth/session');
    vi.doUnmock('@/lib/storage');
  });
});
