import { describe, expect, it } from 'vitest';
import { costAt, currentCost } from '@/lib/accounting/costs';
import type { SheetCostEntry } from '@/lib/types';

const A: SheetCostEntry = { from: '2026-11-10T00:00:00.000Z', paperIqd: 300, plasticIqd: 500 };
const B: SheetCostEntry = { from: '2026-11-20T00:00:00.000Z', paperIqd: 350, plasticIqd: 600 };

describe('costAt', () => {
  it('no entries: null (never 0)', () => {
    expect(costAt([], '2026-11-15T00:00:00.000Z', 'paper')).toBeNull();
  });
  it('an order before the first entry uses the first entry', () => {
    expect(costAt([A, B], '2026-01-01T00:00:00.000Z', 'paper')).toBe(300);
    expect(costAt([A, B], '2026-01-01T00:00:00.000Z', 'plastic')).toBe(500);
  });
  it('between entries: the latest entry that started before the order', () => {
    expect(costAt([A, B], '2026-11-15T00:00:00.000Z', 'paper')).toBe(300);
    expect(costAt([A, B], '2026-11-25T00:00:00.000Z', 'paper')).toBe(350);
    expect(costAt([A, B], '2026-11-25T00:00:00.000Z', 'plastic')).toBe(600);
  });
  it('an entry starting exactly at the order time applies', () => {
    expect(costAt([A, B], B.from, 'paper')).toBe(350);
  });
  it('does not depend on the order of the entries', () => {
    expect(costAt([B, A], '2026-11-15T00:00:00.000Z', 'paper')).toBe(300);
    expect(costAt([B, A], '2026-01-01T00:00:00.000Z', 'paper')).toBe(300);
  });
  it('an unreadable order date is null', () => {
    expect(costAt([A], 'nope', 'paper')).toBeNull();
  });
});

describe('currentCost', () => {
  it('is the entry with the latest from, or null', () => {
    expect(currentCost([])).toBeNull();
    expect(currentCost([B, A])).toBe(B);
  });
});
