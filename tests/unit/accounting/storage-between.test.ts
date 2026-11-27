import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStorage } from '@/lib/storage/local';
import { SupabaseStorage } from '@/lib/storage/supabase';
import { makeOrder } from './fixtures';

describe('LocalStorage.listOrdersBetween', () => {
  const FROM = '2026-11-20T21:00:00.000Z';
  const TO = '2026-11-27T21:00:00.000Z';

  it('returns only orders with from <= createdAt < to, oldest first', async () => {
    const s = new LocalStorage(mkdtempSync(path.join(tmpdir(), 'ep-between-')));
    const items = [
      makeOrder({ id: 'order-0000-before', createdAt: '2026-11-20T20:59:59.999Z' }),
      makeOrder({ id: 'order-0000-late', createdAt: '2026-11-25T10:00:00.000Z' }),
      makeOrder({ id: 'order-0000-first', createdAt: FROM }),
      makeOrder({ id: 'order-0000-mid', createdAt: '2026-11-22T10:00:00.000Z' }),
      makeOrder({ id: 'order-0000-at-end', createdAt: TO }),
      makeOrder({ id: 'order-0000-after', createdAt: '2026-12-01T00:00:00.000Z' }),
    ];
    for (const o of items) await s.saveOrder(o);
    const got = await s.listOrdersBetween(FROM, TO);
    expect(got.map((o) => o.orderId)).toEqual(['order-0000-first', 'order-0000-mid', 'order-0000-late']);
  });

  it('empty store and empty range are empty lists', async () => {
    const s = new LocalStorage(mkdtempSync(path.join(tmpdir(), 'ep-between-')));
    expect(await s.listOrdersBetween(FROM, TO)).toEqual([]);
    await s.saveOrder(makeOrder({ id: 'order-0000-x', createdAt: '2026-11-22T10:00:00.000Z' }));
    expect(await s.listOrdersBetween(TO, FROM)).toEqual([]);
  });

  it('an unreadable bound throws', async () => {
    const s = new LocalStorage(mkdtempSync(path.join(tmpdir(), 'ep-between-')));
    await expect(s.listOrdersBetween('x', TO)).rejects.toThrow();
  });
});

describe('SupabaseStorage.listOrdersBetween', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for the half-open range, oldest first with an id tie-break, and reads every page', async () => {
    const calls: { url: string; range: string }[] = [];
    const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ record: { orderId: `o${from + i}` } }));
    const queue = [page(1000, 0), page(3, 1000), []];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
        calls.push({ url, range: init.headers.Range });
        return new Response(JSON.stringify(queue.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    const s = new SupabaseStorage('https://proj.supabase.co', 'test-secret-key-not-real');
    const got = await s.listOrdersBetween('2026-11-20T21:00:00.000Z', '2026-11-27T21:00:00.000Z');
    expect(got).toHaveLength(1003);
    expect(got[0].orderId).toBe('o0');
    expect(got[1002].orderId).toBe('o1002');
    expect(calls).toHaveLength(3);
    expect(calls[0].range).toBe('0-999');
    expect(calls[1].range).toBe('1000-1999');
    expect(calls[2].range).toBe('1003-2002');
    const u = calls[0].url;
    expect(u).toContain('created_at=gte.2026-11-20T21%3A00%3A00.000Z');
    expect(u).toContain('created_at=lt.2026-11-27T21%3A00%3A00.000Z');
    expect(u).toContain('order=created_at.asc,order_id.asc');
    expect(u).not.toContain('limit=');
  });

  it('a server cap below the page size does not cut the list short', async () => {
    const all = Array.from({ length: 1200 }, (_, i) => ({ record: { orderId: `o${i}` } }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
        const start = Number(init.headers.Range.split('-')[0]);
        return new Response(JSON.stringify(all.slice(start, start + 500)), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    const s = new SupabaseStorage('https://proj.supabase.co', 'test-secret-key-not-real');
    const got = await s.listOrdersBetween('2026-11-20T21:00:00.000Z', '2026-11-27T21:00:00.000Z');
    expect(got).toHaveLength(1200);
    expect(got[1199].orderId).toBe('o1199');
  });

  it('refuses an unreadable bound without calling the network', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const s = new SupabaseStorage('https://proj.supabase.co', 'test-secret-key-not-real');
    await expect(s.listOrdersBetween('nope', '2026-11-27T21:00:00.000Z')).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
