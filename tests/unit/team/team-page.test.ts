/** /team: requireStaff runs first, the client gets only the settings subset, and the usage count seeds the tries left. No JSX (the glob is *.test.ts). */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { fill, team } from '@/content/ar';
import type { AiUsageRow, StaffAccount } from '@/lib/types';

const h = vi.hoisted(() => ({
  order: [] as string[],
  staffImpl: (async () => {
    throw new Error('unset');
  }) as () => Promise<unknown>,
  storageImpl: {} as { aiUsage?: (day: string, kind?: string) => Promise<AiUsageRow[]> },
  captured: undefined as unknown as { settings: Record<string, unknown>; ready: boolean; remainingToday: number | null },
}));

vi.mock('@/lib/auth/staff-session', () => ({
  requireStaff: vi.fn(async () => {
    h.order.push('requireStaff');
    return h.staffImpl();
  }),
}));
vi.mock('@/lib/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/settings')>()),
  getSettings: vi.fn(async () => {
    h.order.push('getSettings');
    return DEFAULT_SETTINGS;
  }),
}));
vi.mock('@/lib/ai/ready', () => ({ aiReady: () => true }));
vi.mock('@/lib/storage', () => ({ getStorage: () => h.storageImpl }));
vi.mock('@/app/team/actions', () => ({ staffLogoutAction: async () => {}, staffLoginAction: async () => {} }));
vi.mock('@/components/team/TeamDesigner', () => ({
  TeamDesigner: (p: typeof h.captured) => {
    h.captured = p;
    return null;
  },
}));

import TeamPage, { metadata } from '@/app/team/page';
import { shopDayKey } from '@/lib/shop-time';

const staff: StaffAccount = { id: 'st_1', name: 'علي', phone: '07700000000', active: true } as unknown as StaffAccount;
const today = () => shopDayKey(new Date());
const row = (over: Partial<AiUsageRow>): AiUsageRow => ({ day: today(), ipKey: 'staff:st_1', ip: '', kind: 'staff_image', count: 1, lastAt: '', ...over });

beforeEach(() => {
  h.order.length = 0;
  h.staffImpl = async () => staff;
  h.storageImpl = {};
});

describe('/team page', () => {
  it('a visitor without a session is sent away before anything else is read', async () => {
    h.staffImpl = async () => {
      throw new Error('NEXT_REDIRECT /team/login');
    };
    const aiUsage = vi.fn(async () => [] as AiUsageRow[]);
    h.storageImpl = { aiUsage };
    await expect(TeamPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(h.order).toEqual(['requireStaff']);
    expect(aiUsage).not.toHaveBeenCalled();
  });

  it('a staff member: the header, the tries left and only the settings subset reach the designer', async () => {
    h.storageImpl = { aiUsage: async () => [row({ count: 3 }), row({ ipKey: 'staff:other', count: 9 })] };
    const out = renderToStaticMarkup(await TeamPage());
    expect(h.order[0]).toBe('requireStaff');
    expect(h.captured.remainingToday).toBe(47);
    expect(h.captured.ready).toBe(true);
    expect(Object.keys(h.captured.settings).sort()).toEqual(['ai', 'layout', 'maxUploadBytes', 'quality']);
    expect((h.captured.settings.ai as { perIpDailyLimit: number }).perIpDailyLimit).toBe(0);
    expect(out).toContain(team.title);
    expect(out).toContain(fill(team.hello, { name: 'علي' }));
    expect(out).toContain(team.savedNote);
    expect(out).toContain(team.logout);
  });

  it('the tries left: all of them with no row, unknown without a usage method or when the read fails', async () => {
    h.storageImpl = { aiUsage: async () => [] };
    renderToStaticMarkup(await TeamPage());
    expect(h.captured.remainingToday).toBe(50);

    h.storageImpl = {};
    renderToStaticMarkup(await TeamPage());
    expect(h.captured.remainingToday).toBeNull();

    h.storageImpl = {
      aiUsage: async () => {
        throw new Error('db down');
      },
    };
    renderToStaticMarkup(await TeamPage());
    expect(h.captured.remainingToday).toBeNull();
  });

  it('is kept out of search engines', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
