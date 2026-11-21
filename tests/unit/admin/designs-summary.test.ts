import { describe, expect, it } from 'vitest';
import { alertBadgeCount, designsSummary, pageFromParam, usageSince } from '@/app/admin/designs/summary';
import type { AiUsageRow } from '@/lib/types';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

const row = (over: Partial<AiUsageRow>): AiUsageRow => ({
  day: '2026-11-21',
  ipKey: KEY_A,
  ip: '1.2.3.4',
  kind: 'image',
  count: 1,
  lastAt: '2026-11-21T08:00:00+00:00',
  ...over,
});

describe('designsSummary', () => {
  it('counts only image kind', () => {
    const s = designsSummary(
      [row({ count: 3 }), row({ kind: 'brief', count: 9 }), row({ ipKey: '', ip: '', count: 2 })],
      '2026-11-21',
      5,
    );
    expect(s.today).toBe(5);
    expect(s.month).toBe(5);
    // The all-time count comes from the stored generations, not from usage rows.
    expect('allTime' in s).toBe(false);
  });

  it('month uses Baghdad YYYY-MM (shop day)', () => {
    const s = designsSummary(
      [
        row({ day: '2026-11-01', count: 2 }),
        row({ day: '2026-10-31', count: 4 }),
        row({ day: '2026-11-21', count: 1 }),
        row({ day: '2025-12-01', count: 7 }),
      ],
      '2026-11-21',
      5,
    );
    expect(s.today).toBe(1);
    expect(s.month).toBe(3);
  });

  it('usage is read from the first day of the month, or yesterday when that is earlier', () => {
    expect(usageSince('2026-11-21')).toBe('2026-11-01');
    expect(usageSince('2026-11-02')).toBe('2026-11-01');
    expect(usageSince('2026-11-01')).toBe('2026-10-31');
    expect(usageSince('2027-01-01')).toBe('2026-12-31');
  });

  it('?page is a whole number from 1, capped at 100,000; anything else is page 1', () => {
    expect(pageFromParam(undefined)).toBe(1);
    expect(pageFromParam('3')).toBe(3);
    expect(pageFromParam('0')).toBe(1);
    expect(pageFromParam('-2')).toBe(1);
    expect(pageFromParam('2.5')).toBe(1);
    expect(pageFromParam('abc')).toBe(1);
    expect(pageFromParam('1e400')).toBe(1);
    expect(pageFromParam('99999999999999999999')).toBe(1);
    expect(pageFromParam('100001')).toBe(100_000);
    expect(pageFromParam('100000')).toBe(100_000);
  });

  it('the nav badge counts customers (distinct IP keys), not alert rows', () => {
    const s = designsSummary(
      [
        row({ day: '2026-11-20', ipKey: KEY_A, count: 5 }),
        row({ day: '2026-11-21', ipKey: KEY_A, count: 5 }),
        row({ day: '2026-11-21', ipKey: KEY_B, count: 7 }),
      ],
      '2026-11-21',
      5,
    );
    expect(s.alerts).toHaveLength(3);
    expect(alertBadgeCount(s.alerts)).toBe(2);
    expect(alertBadgeCount([])).toBe(0);
  });

  it('alerts include today and yesterday at the limit, newest first', () => {
    const s = designsSummary(
      [
        row({ day: '2026-11-20', ipKey: KEY_A, count: 5, lastAt: '2026-11-20T10:00:00+00:00' }),
        row({ day: '2026-11-21', ipKey: KEY_B, ip: '5.6.7.8', count: 6, lastAt: '2026-11-21T09:00:00Z' }),
        row({ day: '2026-11-19', ipKey: KEY_A, count: 5, lastAt: '2026-11-19T10:00:00+00:00' }),
        row({ day: '2026-11-21', ipKey: 'c'.repeat(64), count: 4 }),
      ],
      '2026-11-21',
      5,
    );
    expect(s.alerts.map((a) => [a.ipKey, a.day, a.count])).toEqual([
      [KEY_B, '2026-11-21', 6],
      [KEY_A, '2026-11-20', 5],
    ]);
    expect(s.alerts[0].ip).toBe('5.6.7.8');
  });

  it('compares timestamps as dates, not strings (+00:00 vs Z)', () => {
    const s = designsSummary(
      [
        row({ ipKey: KEY_A, count: 5, lastAt: '2026-11-21T08:00:00+00:00' }),
        row({ ipKey: KEY_B, count: 5, lastAt: '2026-11-21T08:00:00.500Z' }),
      ],
      '2026-11-21',
      5,
    );
    expect(s.alerts.map((a) => a.ipKey)).toEqual([KEY_B, KEY_A]);
  });

  it('an already blocked IP is not an alert, but its uses still count', () => {
    const rows = [row({ ipKey: KEY_A, count: 5 }), row({ ipKey: KEY_B, ip: '5.6.7.8', count: 6 })];
    const s = designsSummary(rows, '2026-11-21', 5, new Set([KEY_A]));
    expect(s.alerts.map((a) => a.ipKey)).toEqual([KEY_B]);
    expect(s.today).toBe(11);
    expect(designsSummary(rows, '2026-11-21', 5).alerts).toHaveLength(2);
    expect(designsSummary(rows, '2026-11-21', 5, new Set([KEY_A, KEY_B])).alerts).toEqual([]);
  });

  it('site-only rows never alert', () => {
    const s = designsSummary([row({ ipKey: '', ip: '', count: 300 })], '2026-11-21', 5);
    expect(s.alerts).toEqual([]);
    expect(s.today).toBe(300);
  });

  it('brief rows never alert (their limit is different)', () => {
    const s = designsSummary([row({ kind: 'brief', count: 20 })], '2026-11-21', 5);
    expect(s.alerts).toEqual([]);
  });
});
