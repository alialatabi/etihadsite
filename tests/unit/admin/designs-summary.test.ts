import { describe, expect, it } from 'vitest';
import { designsSummary } from '@/app/admin/designs/summary';
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
    expect(s.allTime).toBe(5);
  });

  it('month uses Baghdad YYYY-MM (shop day) and allTime sums everything', () => {
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
    expect(s.allTime).toBe(14);
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
