import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdmin = vi.fn();
const revalidatePath = vi.fn();
const aiBlock = vi.fn();
const aiUnblock = vi.fn();

vi.mock('@/lib/auth/guard', () => ({ requireAdmin: () => requireAdmin() }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({ aiBlock: (...a: unknown[]) => aiBlock(...a), aiUnblock: (...a: unknown[]) => aiUnblock(...a) }),
}));

import { blockIpAction, unblockIpAction } from '@/app/admin/designs/actions';

const KEY = 'ab'.repeat(32);
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue(undefined);
  revalidatePath.mockReset();
  aiBlock.mockReset().mockResolvedValue(undefined);
  aiUnblock.mockReset().mockResolvedValue(undefined);
});

describe('blockIpAction', () => {
  it('block requires admin', async () => {
    requireAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(blockIpAction(form({ ipKey: KEY, ip: '1.2.3.4' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(aiBlock).not.toHaveBeenCalled();
  });

  it('block rejects a bad ipKey', async () => {
    await blockIpAction(form({ ipKey: 'nope', ip: '1.2.3.4' }));
    await blockIpAction(form({ ipKey: '', ip: '' }));
    expect(aiBlock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('block calls aiBlock and revalidates', async () => {
    await blockIpAction(form({ ipKey: KEY, ip: '1.2.3.4' }));
    expect(aiBlock).toHaveBeenCalledWith(KEY, '1.2.3.4');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/designs');
  });
});

describe('unblockIpAction', () => {
  it('requires admin', async () => {
    requireAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(unblockIpAction(form({ ipKey: KEY }))).rejects.toThrow('NEXT_REDIRECT');
    expect(aiUnblock).not.toHaveBeenCalled();
  });

  it('calls aiUnblock and revalidates; rejects a bad key', async () => {
    await unblockIpAction(form({ ipKey: 'zz' }));
    expect(aiUnblock).not.toHaveBeenCalled();
    await unblockIpAction(form({ ipKey: KEY }));
    expect(aiUnblock).toHaveBeenCalledWith(KEY);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/designs');
  });
});
