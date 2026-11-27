import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { ShopSettings } from '@/lib/types';

const requireAdmin = vi.fn();
const revalidatePath = vi.fn();
const store = vi.hoisted(() => ({ settings: null as unknown as ShopSettings, saved: [] as ShopSettings[] }));

vi.mock('@/lib/auth/guard', () => ({ requireAdmin: () => requireAdmin() }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error('NEXT_REDIRECT ' + u);
  },
}));
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    getSettings: async () => structuredClone(store.settings),
    saveSettings: async (s: ShopSettings) => {
      store.saved.push(structuredClone(s));
      store.settings = s;
    },
  }),
}));

import { saveSheetCostAction } from '@/app/admin/accounts/actions';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

async function run(o: Record<string, string>): Promise<string> {
  try {
    await saveSheetCostAction(form(o));
  } catch (e) {
    const m = /^NEXT_REDIRECT (.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  throw new Error('no redirect');
}

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue(undefined);
  revalidatePath.mockReset();
  store.settings = structuredClone(DEFAULT_SETTINGS);
  store.saved = [];
});

describe('saveSheetCostAction', () => {
  it('checks the admin session first, and stops when it redirects', async () => {
    requireAdmin.mockRejectedValueOnce(new Error('NEXT_REDIRECT /admin/login'));
    await expect(saveSheetCostAction(form({ paperCost: '300', plasticCost: '500' }))).rejects.toThrow('/admin/login');
    expect(store.saved).toHaveLength(0);
  });

  it('saves a new entry, revalidates the page and redirects with saved=1', async () => {
    expect(await run({ paperCost: '300', plasticCost: '500' })).toBe('/admin/accounts?saved=1');
    expect(store.saved).toHaveLength(1);
    const entries = store.saved[0].accounting!.sheetCosts;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ paperIqd: 300, plasticIqd: 500 });
    expect(Number.isNaN(Date.parse(entries[0].from))).toBe(false);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/accounts');
    // The rest of the settings is untouched.
    expect(store.saved[0].pricing).toEqual(DEFAULT_SETTINGS.pricing);
  });

  it('a second, different entry is appended after the first', async () => {
    await run({ paperCost: '300', plasticCost: '500' });
    await run({ paperCost: '350', plasticCost: '500' });
    expect(store.settings.accounting!.sheetCosts.map((e) => e.paperIqd)).toEqual([300, 350]);
  });

  it('rejects bad input without saving', async () => {
    expect(await run({ paperCost: '-1', plasticCost: '500' })).toBe('/admin/accounts?error=invalid');
    expect(await run({ paperCost: '1.5', plasticCost: '500' })).toBe('/admin/accounts?error=invalid');
    expect(await run({ paperCost: '300' })).toBe('/admin/accounts?error=invalid');
    expect(await run({ paperCost: '100000001', plasticCost: '1' })).toBe('/admin/accounts?error=invalid');
    expect(store.saved).toHaveLength(0);
  });

  it('skips an entry equal to the current one', async () => {
    await run({ paperCost: '300', plasticCost: '500' });
    expect(await run({ paperCost: '300', plasticCost: '500' })).toBe('/admin/accounts?error=unchanged');
    expect(store.saved).toHaveLength(1);
  });
});
