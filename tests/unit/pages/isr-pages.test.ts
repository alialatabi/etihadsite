import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { ShopSettings } from '@/lib/types';

const calls: string[] = [];
const revalidatePath = vi.fn((...a: unknown[]) => {
  calls.push(`revalidate:${a.join(',')}`);
});
const store = vi.hoisted(() => ({ settings: null as unknown as ShopSettings }));
const parsed = vi.hoisted(() => ({ result: null as unknown as { ok: true; settings: ShopSettings } | { ok: false; error: string } }));

// The form rules have their own tests (settings-form.test.ts); here only the order of save and revalidate counts.
vi.mock('@/app/admin/settings/parse-form', () => ({ parseSettingsForm: () => parsed.result }));

vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => undefined }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({}) }));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error('NEXT_REDIRECT ' + u);
  },
}));
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    getSettings: async () => structuredClone(store.settings),
    saveSettings: async (s: ShopSettings) => {
      calls.push('save');
      store.settings = s;
    },
  }),
}));

import { saveSettingsAction } from '@/app/admin/actions';
import * as home from '@/app/page';
import * as howItWorks from '@/app/how-it-works/page';

beforeEach(() => {
  calls.length = 0;
  revalidatePath.mockClear();
  store.settings = structuredClone(DEFAULT_SETTINGS);
  parsed.result = { ok: true, settings: { ...structuredClone(DEFAULT_SETTINGS), shopName: 'محل جديد' } };
});

describe('ISR for the two public pages', () => {
  it.each([
    ['/', home],
    ['/how-it-works', howItWorks],
  ])('%s is prerendered and regenerated hourly', (_path, mod) => {
    expect(mod.dynamic).toBe('force-static');
    expect(mod.revalidate).toBe(3600);
  });

  it('a settings save refreshes every page under the root layout, after the write', async () => {
    await expect(saveSettingsAction({}, new FormData())).rejects.toThrow('NEXT_REDIRECT /admin/settings?saved=1');
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(calls).toEqual(['save', 'revalidate:/,layout']);
  });

  it('a rejected form saves nothing and refreshes nothing', async () => {
    parsed.result = { ok: false, error: 'x' };
    expect(await saveSettingsAction({}, new FormData())).toEqual({ error: 'x' });
    expect(calls).toEqual([]);
  });
});
