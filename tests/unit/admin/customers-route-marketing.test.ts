import { describe, expect, it, vi } from 'vitest';
import { admin } from '@/content/ar';
import type { CustomerRecord } from '@/lib/types';

const customers = vi.hoisted(() => [] as CustomerRecord[]);
vi.mock('@/lib/auth/session', () => ({ adminApiGuard: async () => null }));
vi.mock('@/lib/storage', () => ({ getStorage: () => ({ listCustomers: async () => customers }) }));

import { GET } from '@/app/api/admin/customers/route';

const base: CustomerRecord = {
  phone: '9647701234567', governorate: 'بغداد', district: 'x', landmark: 'y', firstOrderAt: '2026-11-01T09:00:00Z',
  lastOrderAt: '2026-11-02T09:00:00Z', ordersCount: 1, totalIqd: 0, lastOrderId: 'a', lastDisplayNo: 'EP-1',
};
customers.push(
  { ...base, phone: '9647701111111', marketingOptIn: true, marketingOptInAt: '2026-11-02T09:00:00Z' },
  { ...base, phone: '9647702222222', marketingOptIn: false, marketingOptInAt: null },
  { ...base, phone: '9647703333333' },
);
const lines = async (res: Response) => (await res.text()).split('\r\n').filter(Boolean);

describe('GET /api/admin/customers ?marketing=1', () => {
  it('exports everyone without the parameter (no request at all, or another value)', async () => {
    expect(await lines(await GET())).toHaveLength(4);
    expect(await lines(await GET(new Request('http://localhost/api/admin/customers')))).toHaveLength(4);
    expect(await lines(await GET(new Request('http://localhost/api/admin/customers?marketing=0')))).toHaveLength(4);
  });

  it('exports only the opted-in customers, under the offers file name', async () => {
    const res = await GET(new Request('http://localhost/api/admin/customers?marketing=1'));
    const out = await lines(res);
    expect(out).toHaveLength(2);
    expect(out[1]).toContain('964 770 111 1111');
    expect(res.headers.get('content-disposition')).toContain(`filename="${admin.customers.marketingCsvFile}-`);
  });
});
