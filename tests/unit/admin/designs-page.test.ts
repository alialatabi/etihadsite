/** /admin/designs: what the page asks storage for, from the query string, and that paging keeps every filter. No JSX (the glob is *.test.ts). */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORDERS_LIST_CAP } from '@/config/defaults';
import { admin } from '@/content/ar';

const store = vi.hoisted(() => ({
  orders: [] as unknown[],
  total: 200,
  aiListGenerations: vi.fn(),
  listOrders: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => undefined }));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ retentionDays: 30, ai: { perIpDailyLimit: 5, siteDailyLimit: 100 } }),
}));
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    aiListGenerations: store.aiListGenerations,
    listOrders: store.listOrders,
    aiUsage: async () => [],
    aiListBlocks: async () => [],
    staffList: async () => [{ id: 's_abc123', name: 'سارة' }],
    getOrder: async () => null,
  }),
}));
vi.mock('@/app/admin/designs/actions', () => ({
  blockIpAction: vi.fn(),
  unblockIpAction: vi.fn(),
  deleteDesignAction: vi.fn(),
}));

import DesignsPage from '@/app/admin/designs/page';

const d = admin.designs;
const render = async (sp: Record<string, string | string[] | undefined>) =>
  renderToStaticMarkup(await DesignsPage({ searchParams: Promise.resolve(sp) }));

const order = (i: number, phone = '9647701234567', name = 'علي') => ({
  orderId: `order_${String(i).padStart(8, '0')}`,
  displayNo: `EP-26110${i % 10}-AB${i}`,
  createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString(),
  customer: { name, phone },
});

beforeEach(() => {
  store.orders = [];
  store.total = 200;
  store.aiListGenerations.mockReset().mockImplementation(async (f: { limit: number }) => ({ rows: [], total: f.limit === 0 ? 777 : store.total }));
  store.listOrders.mockReset().mockImplementation(async () => store.orders);
});

describe('DesignsPage with every filter set', () => {
  const sp = {
    q: '0770 123 4',
    status: 'ordered',
    maker: 'staff:s_abc123',
    from: '2026-11-01',
    to: '2026-11-02',
    page: '2',
  };

  it('asks storage for page 2 with the Baghdad day bounds, the maker, the status and the matching orders', async () => {
    store.orders = [order(1), order(2, '9647809998877', 'كريم'), order(3, '9647701239999')];
    await render(sp);
    expect(store.aiListGenerations).toHaveBeenCalledTimes(2);
    expect(store.aiListGenerations.mock.calls[0][0]).toEqual({
      limit: 48,
      offset: 48,
      ordered: true,
      maker: { staffId: 's_abc123' },
      since: '2026-10-31T21:00:00.000Z',
      until: '2026-11-02T21:00:00.000Z',
      // phone digits 7701234: only order 1 contains them
      search: { text: '0770 123 4', orderIds: ['order_00000001'] },
    });
  });

  it('fetches the unfiltered total separately and shows it in the stored tile', async () => {
    const html = await render(sp);
    expect(store.aiListGenerations.mock.calls[1][0]).toEqual({ limit: 0, offset: 0 });
    expect(html).toContain('777');
  });

  it('every pagination link keeps every parameter and moves only the page', async () => {
    const html = await render(sp);
    const links = [...html.matchAll(/href="(\/admin\/designs\?[^"]*)"/g)].map(
      (m) => new URLSearchParams(m[1].replace(/&amp;/g, '&').split('?')[1]),
    );
    const prev = links.find((p) => p.has('q') && !p.has('page'));
    const next = links.find((p) => p.get('page') === '3');
    const keep = { q: '0770 123 4', status: 'ordered', maker: 'staff:s_abc123', from: '2026-11-01', to: '2026-11-02' };
    expect(prev && Object.fromEntries(prev)).toEqual(keep); // page 1 has no page parameter
    expect(next && Object.fromEntries(next)).toEqual({ ...keep, page: '3' });
  });

  it('shows no search notice for a small shop', async () => {
    const html = await render(sp);
    expect(html).not.toContain(d.filters.searchTruncated);
  });
});

describe('DesignsPage without filters', () => {
  it('lists page 1 with no extra total call and no search', async () => {
    await render({});
    expect(store.aiListGenerations).toHaveBeenCalledTimes(1);
    expect(store.aiListGenerations.mock.calls[0][0]).toEqual({ limit: 48, offset: 0 });
    expect(store.listOrders).not.toHaveBeenCalled();
  });

  it('garbage values are dropped, not passed to storage', async () => {
    await render({ status: 'x', maker: 'staff:../../etc', from: '2026-02-31', to: 'nope', page: '-4', ip: 'zz' });
    expect(store.aiListGenerations.mock.calls[0][0]).toEqual({ limit: 48, offset: 0 });
  });
});

describe('DesignsPage search notices', () => {
  it('says the search covers only the newest ORDERS_LIST_CAP orders, the cap coming from one constant', async () => {
    store.orders = Array.from({ length: ORDERS_LIST_CAP }, (_, i) => order(i));
    const html = await render({ q: 'علي' });
    expect(html).toContain(String(ORDERS_LIST_CAP));
    expect(html).toContain(d.orderPlural.other);
    expect(html).not.toContain('{n}');
    store.orders = Array.from({ length: ORDERS_LIST_CAP - 1 }, (_, i) => order(i));
    expect(await render({ q: 'علي' })).not.toContain(String(ORDERS_LIST_CAP));
  });

  it('says so when more orders matched than one search can use (and sends only the cap)', async () => {
    store.orders = Array.from({ length: 250 }, (_, i) => order(i));
    const html = await render({ q: 'علي' });
    expect(html).toContain(d.filters.searchTruncated);
    expect(store.aiListGenerations.mock.calls[0][0].search.orderIds).toHaveLength(200);
  });
});
