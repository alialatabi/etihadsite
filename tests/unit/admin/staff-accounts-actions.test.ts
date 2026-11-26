import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupEnv } from '../server/helpers';

const requireAdmin = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/lib/auth/guard', () => ({ requireAdmin: () => requireAdmin() }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
// A test can swap the adapter for one without the staff methods (an adapter that predates them).
let storageOverride: unknown = null;
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return { ...actual, getStorage: () => (storageOverride ?? actual.getStorage()) as ReturnType<typeof actual.getStorage> };
});
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error('NEXT_REDIRECT ' + u);
  },
}));

import { createStaffAction, resetStaffPasswordAction, setStaffActiveAction } from '@/app/admin/staff/actions';
import { verifyPassword } from '@/lib/auth/password';
import { getStorage } from '@/lib/storage';
import { LocalStorage } from '@/lib/storage/local';
import type { StaffAccountRecord } from '@/lib/types';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

/** Runs an action and returns where it redirected to. */
async function run(action: (f: FormData) => Promise<void>, o: Record<string, string>): Promise<string> {
  try {
    await action(form(o));
  } catch (e) {
    const m = /^NEXT_REDIRECT (.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  throw new Error('no redirect');
}

const ID = 'st_abcdefgh12';
async function seed(over: Partial<StaffAccountRecord> = {}): Promise<StaffAccountRecord> {
  const rec: StaffAccountRecord = {
    id: ID,
    name: 'أحمد',
    phone: '9647701234567',
    active: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    passwordChangedAt: '2026-01-01T08:00:00.000Z',
    passwordHash: 'scrypt$16384$8$1$AAAA$BBBB',
    ...over,
  };
  await getStorage().staffCreate!(rec);
  return rec;
}

beforeEach(() => {
  setupEnv();
  requireAdmin.mockReset().mockResolvedValue(undefined);
  revalidatePath.mockReset();
  vi.restoreAllMocks();
  storageOverride = null;
});

describe('admin staff actions require the admin first', () => {
  const calls: [string, (f: FormData) => Promise<void>, Record<string, string>][] = [
    ['create', createStaffAction, { name: 'س', phone: '07701234567', password: 'longenough1' }],
    ['toggle', setStaffActiveAction, { id: ID, active: 'false' }],
    ['reset', resetStaffPasswordAction, { id: ID, password: 'longenough1' }],
  ];
  it.each(calls)('%s: no storage access when requireAdmin rejects', async (_n, action, body) => {
    requireAdmin.mockRejectedValue(new Error('NEXT_REDIRECT /admin/login'));
    const storage = getStorage();
    const spies = (['staffByPhone', 'staffCreate', 'staffUpdate', 'staffList'] as const).map((m) => vi.spyOn(storage, m));
    await expect(action(form(body))).rejects.toThrow('NEXT_REDIRECT /admin/login');
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe('createStaffAction', () => {
  it('stores the normalised phone, a scrypt hash (never the plaintext) and active: true, then redirects to ?saved=1', async () => {
    const to = await run(createStaffAction, { name: '  أحمد  ', phone: '0770 123 4567', password: 'longenough1' });
    expect(to).toBe('/admin/staff?saved=1');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/staff');
    const [rec] = await getStorage().staffList!();
    expect(rec).toMatchObject({ name: 'أحمد', phone: '9647701234567', active: true });
    expect(rec.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(rec.passwordHash).not.toContain('longenough1');
    expect(await verifyPassword('longenough1', rec.passwordHash)).toBe(true);
    expect(rec.id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(rec.passwordChangedAt).toBe(rec.createdAt);
  });

  it('a duplicate phone gives phoneTaken (also written differently)', async () => {
    await seed();
    expect(await run(createStaffAction, { name: 'ثاني', phone: '+964 770 123 4567', password: 'longenough1' })).toBe(
      '/admin/staff?error=phoneTaken',
    );
    expect(await getStorage().staffList!()).toHaveLength(1);
  });

  it('a race on the unique phone (the pre-check misses) still gives phoneTaken', async () => {
    await seed();
    vi.spyOn(getStorage(), 'staffByPhone').mockResolvedValue(null);
    expect(await run(createStaffAction, { name: 'ثاني', phone: '07701234567', password: 'longenough1' })).toBe(
      '/admin/staff?error=phoneTaken',
    );
  });

  it.each([
    ['a 7-character password', { name: 'س', phone: '07701234567', password: '1234567' }],
    ['a bad phone', { name: 'س', phone: '12345', password: 'longenough1' }],
    ['an empty name', { name: '   ', phone: '07701234567', password: 'longenough1' }],
    ['a missing field', { name: 'س', phone: '07701234567' }],
  ])('%s gives invalid and stores nothing', async (_n, body) => {
    expect(await run(createStaffAction, body)).toBe('/admin/staff?error=invalid');
    expect(await getStorage().staffList!()).toEqual([]);
  });

  it('an adapter without the staff methods gives notReady', async () => {
    storageOverride = {};
    expect(await run(createStaffAction, { name: 'س', phone: '07701234567', password: 'longenough1' })).toBe(
      '/admin/staff?error=notReady',
    );
  });
});

describe('setStaffActiveAction', () => {
  it('disables and re-enables an account', async () => {
    await seed();
    expect(await run(setStaffActiveAction, { id: ID, active: 'false' })).toBe('/admin/staff?saved=1');
    expect((await getStorage().staffGet!(ID))?.active).toBe(false);
    await run(setStaffActiveAction, { id: ID, active: 'true' });
    expect((await getStorage().staffGet!(ID))?.active).toBe(true);
  });

  it('a bad id, a bad value or an unknown account gives invalid', async () => {
    await seed();
    expect(await run(setStaffActiveAction, { id: '../x', active: 'false' })).toBe('/admin/staff?error=invalid');
    expect(await run(setStaffActiveAction, { id: ID, active: 'maybe' })).toBe('/admin/staff?error=invalid');
    expect(await run(setStaffActiveAction, { id: 'st_unknown123', active: 'false' })).toBe('/admin/staff?error=invalid');
    expect((await getStorage().staffGet!(ID))?.active).toBe(true);
  });

  it('an adapter without the staff methods gives notReady', async () => {
    storageOverride = {};
    expect(await run(setStaffActiveAction, { id: ID, active: 'false' })).toBe('/admin/staff?error=notReady');
  });
});

describe('resetStaffPasswordAction', () => {
  it('changes the hash and moves passwordChangedAt later', async () => {
    const before = await seed();
    expect(await run(resetStaffPasswordAction, { id: ID, password: 'brand-new-pass' })).toBe('/admin/staff?saved=1');
    const after = (await getStorage().staffGet!(ID))!;
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(await verifyPassword('brand-new-pass', after.passwordHash)).toBe(true);
    expect(Date.parse(after.passwordChangedAt)).toBeGreaterThan(Date.parse(before.passwordChangedAt));
  });

  it('a short password, a bad id or an unknown account gives invalid and changes nothing', async () => {
    const before = await seed();
    expect(await run(resetStaffPasswordAction, { id: ID, password: 'short' })).toBe('/admin/staff?error=invalid');
    expect(await run(resetStaffPasswordAction, { id: 'bad id', password: 'brand-new-pass' })).toBe('/admin/staff?error=invalid');
    expect(await run(resetStaffPasswordAction, { id: 'st_unknown123', password: 'brand-new-pass' })).toBe('/admin/staff?error=invalid');
    expect(await getStorage().staffGet!(ID)).toEqual(before);
  });

  it('an adapter without the staff methods gives notReady', async () => {
    storageOverride = {};
    expect(await run(resetStaffPasswordAction, { id: ID, password: 'brand-new-pass' })).toBe('/admin/staff?error=notReady');
  });
});

describe('local adapter is what these tests run against', () => {
  it('uses LocalStorage', () => {
    expect(getStorage()).toBeInstanceOf(LocalStorage);
  });
});
