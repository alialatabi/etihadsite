import { describe, expect, it } from 'vitest';
import {
  filterQuery,
  matchOrderIds,
  MAX_QUERY_LENGTH,
  MAX_SEARCH_ORDER_IDS,
  parseDesignFilters,
  phoneSearchDigits,
  shopDayEndIso,
  shopDayStartIso,
} from '@/app/admin/designs/filters';

const KEY = 'ab'.repeat(32);

describe('shop day bounds (Asia/Baghdad, UTC+3)', () => {
  it('start of a shop day is 21:00 UTC of the day before', () => {
    expect(shopDayStartIso('2026-11-26')).toBe('2026-11-25T21:00:00.000Z');
  });

  it('"until" is the start of the day AFTER the chosen day', () => {
    expect(shopDayEndIso('2026-11-26')).toBe('2026-11-26T21:00:00.000Z');
    expect(shopDayEndIso('2026-12-31')).toBe('2026-12-31T21:00:00.000Z');
  });

  it('rejects text that is not a real date', () => {
    for (const bad of ['', 'x', '2026-02-31', '2026-13-01', '2026-1-1', '26-01-01', '2026-11-26T00:00']) {
      expect(shopDayStartIso(bad)).toBeNull();
      expect(shopDayEndIso(bad)).toBeNull();
    }
    expect(shopDayStartIso('2028-02-29')).not.toBeNull();
    expect(shopDayStartIso('2027-02-29')).toBeNull();
  });
});

describe('parseDesignFilters', () => {
  it('empty query: no filter, not active, page 1', () => {
    const r = parseDesignFilters({});
    expect(r.filter).toEqual({});
    expect(r.active).toBe(false);
    expect(r.page).toBe(1);
    expect(r.echo).toEqual({ q: '', status: '', maker: '', shape: '', from: '', to: '', ip: '' });
  });

  it('maps every valid value to the storage filter', () => {
    const r = parseDesignFilters({
      q: '  ali  ',
      status: 'unordered',
      maker: 'staff:abc_123',
      shape: 'circle',
      from: '2026-11-01',
      to: '2026-11-26',
      ip: KEY,
      page: '3',
    });
    expect(r.filter).toEqual({
      ipKey: KEY,
      ordered: false,
      maker: { staffId: 'abc_123' },
      shape: 'circle',
      since: '2026-10-31T21:00:00.000Z',
      until: '2026-11-26T21:00:00.000Z',
    });
    expect(r.echo.q).toBe('ali');
    expect(r.page).toBe(3);
    expect(r.active).toBe(true);
  });

  it('status and maker keywords', () => {
    expect(parseDesignFilters({ status: 'ordered' }).filter).toEqual({ ordered: true });
    expect(parseDesignFilters({ maker: 'customer' }).filter).toEqual({ maker: 'customer' });
    expect(parseDesignFilters({ maker: 'staff' }).filter).toEqual({ maker: 'staff' });
  });

  it('ignores bad values (and an array takes its first entry)', () => {
    const r = parseDesignFilters({
      status: 'all',
      maker: 'staff:bad id!',
      shape: 'star',
      from: '2026-02-31',
      to: 'tomorrow',
      ip: 'not-a-key',
      page: '-4',
    });
    expect(r.filter).toEqual({});
    expect(r.active).toBe(false);
    expect(r.page).toBe(1);
    expect(r.echo.maker).toBe('');
    expect(parseDesignFilters({ shape: ['rect', 'circle'] }).filter).toEqual({ shape: 'rect' });
  });

  it('caps a long search text and collapses whitespace', () => {
    const r = parseDesignFilters({ q: `a${' '.repeat(5)}b${'x'.repeat(500)}` });
    expect(r.echo.q.length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
    expect(r.echo.q.startsWith('a b')).toBe(true);
    // a search alone makes the page "active" (the unfiltered total is fetched separately)
    expect(r.active).toBe(true);
    expect(r.filter).toEqual({});
  });

  it('a whitespace-only search is no search', () => {
    expect(parseDesignFilters({ q: '   ' }).active).toBe(false);
  });
});

describe('filterQuery', () => {
  it('writes only the set values, in a stable order, and the page when > 1', () => {
    const { echo } = parseDesignFilters({ q: 'علي', status: 'ordered', ip: KEY });
    expect(filterQuery(echo)).toBe(`q=%D8%B9%D9%84%D9%8A&status=ordered&ip=${KEY}`);
    expect(filterQuery(echo, 2)).toBe(`q=%D8%B9%D9%84%D9%8A&status=ordered&ip=${KEY}&page=2`);
    expect(filterQuery(parseDesignFilters({}).echo)).toBe('');
  });

  it('round-trips through parseDesignFilters', () => {
    const first = parseDesignFilters({ q: 'x', status: 'unordered', maker: 'staff:s1', shape: 'custom', from: '2026-11-01', to: '2026-11-02' });
    const again = parseDesignFilters(Object.fromEntries(new URLSearchParams(filterQuery(first.echo))));
    expect(again.echo).toEqual(first.echo);
    expect(again.filter).toEqual(first.filter);
  });
});

describe('phoneSearchDigits', () => {
  it('07xx and 9647xx and Arabic digits search the same digits', () => {
    expect(phoneSearchDigits('0770 123')).toBe('770123');
    expect(phoneSearchDigits('+964 770 123')).toBe('770123');
    expect(phoneSearchDigits('٠٧٧٠١٢٣')).toBe('770123');
  });

  it('too short is no phone search', () => {
    expect(phoneSearchDigits('07')).toBe('');
    expect(phoneSearchDigits('abc')).toBe('');
  });
});

describe('matchOrderIds', () => {
  const order = (orderId: string, name: string | undefined, phone: string, displayNo: string, createdAt: string) => ({
    orderId,
    displayNo,
    createdAt,
    customer: { name, phone, governorate: '', district: '', landmark: '' },
  });
  const orders = [
    order('o1', 'Ali Hassan', '9647701234567', 'EP-261101-AB3C', '2026-11-01T10:00:00Z'),
    order('o2', 'علي كريم', '9647809998877', 'EP-261102-ZZ9K', '2026-11-02T10:00:00Z'),
    order('o3', undefined, '9647705556666', 'EP-261103-QQ7M', '2026-11-03T10:00:00Z'),
  ];

  it('matches the name, case-insensitively', () => {
    expect(matchOrderIds('ALI', orders).ids).toEqual(['o1']);
    expect(matchOrderIds('علي', orders).ids).toEqual(['o2']);
  });

  it('matches the phone written as 07xx, 9647xx or with spaces', () => {
    expect(matchOrderIds('0770 123', orders).ids).toEqual(['o1']);
    expect(matchOrderIds('+964 770 5556', orders).ids).toEqual(['o3']);
    expect(matchOrderIds('7809998', orders).ids).toEqual(['o2']);
  });

  it('matches the order number, case-insensitively', () => {
    expect(matchOrderIds('ep-261102', orders).ids).toEqual(['o2']);
    expect(matchOrderIds('qq7m', orders).ids).toEqual(['o3']);
  });

  it('no text, no match, and a name-less order does not crash', () => {
    expect(matchOrderIds('', orders).ids).toEqual([]);
    expect(matchOrderIds('zzzzzz', orders).ids).toEqual([]);
  });

  it('newest first, no duplicates, at most 200', () => {
    expect(matchOrderIds('EP-26', orders).ids).toEqual(['o3', 'o2', 'o1']);
    const many = Array.from({ length: 450 }, (_, i) =>
      order(`id${i}`, 'Sara', '9647700000000', `EP-${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()),
    );
    const { ids, truncated } = matchOrderIds('sara', [...many, many[0]]);
    expect(ids).toHaveLength(MAX_SEARCH_ORDER_IDS);
    expect(ids[0]).toBe('id449');
    expect(new Set(ids).size).toBe(ids.length);
    expect(truncated).toBe(true);
  });

  it('truncated is false at exactly the cap (duplicates do not count) and when fewer match', () => {
    const exact = Array.from({ length: MAX_SEARCH_ORDER_IDS }, (_, i) =>
      order(`id${i}`, 'Sara', '9647700000000', `EP-${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()),
    );
    expect(matchOrderIds('sara', [...exact, exact[0]]).truncated).toBe(false);
    expect(matchOrderIds('sara', exact).ids).toHaveLength(MAX_SEARCH_ORDER_IDS);
    expect(matchOrderIds('EP-26', orders).truncated).toBe(false);
    expect(matchOrderIds('', orders)).toEqual({ ids: [], truncated: false });
  });

  it('digits typed in Arabic-Indic or Persian form match an order number and a name with digits', () => {
    // «EP-261102-ZZ9K» typed with Arabic-Indic digits, and the same with Persian digits
    expect(matchOrderIds('ep-٢٦١١٠٢', orders).ids).toEqual(['o2']);
    expect(matchOrderIds('EP-۲۶۱۱۰۳', orders).ids).toEqual(['o3']);
    const withDigits = [order('o9', 'محل 24', '9647701111111', 'EP-261109-AAAA', '2026-11-09T10:00:00Z')];
    expect(matchOrderIds('٢٤', withDigits).ids).toEqual(['o9']);
    expect(matchOrderIds('محل ٢٤', withDigits).ids).toEqual(['o9']);
  });
});
