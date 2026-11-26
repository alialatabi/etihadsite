import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiGenerationRecord } from '@/lib/types';

const requireAdmin = vi.fn();
const revalidatePath = vi.fn();
const calls: string[] = [];
const aiGetGeneration = vi.fn();
const orderUsingUpload = vi.fn();
const aiMarkOrdered = vi.fn();
const aiDeleteGeneration = vi.fn();
const deleteFile = vi.fn();
let adapter: Record<string, unknown>;

vi.mock('@/lib/auth/guard', () => ({ requireAdmin: () => requireAdmin() }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('@/lib/storage', () => ({ getStorage: () => adapter }));

import { deleteDesignAction } from '@/app/admin/designs/actions';

const ID = 'upl_abcdef123456';
const row = (over: Partial<AiGenerationRecord> = {}): AiGenerationRecord => ({
  id: 'gen_1',
  createdAt: '2026-11-20T10:00:00Z', // far older than DESIGN_DELETE_MIN_AGE_MS at the fixed test clock
  day: '2026-11-20',
  ip: '1.2.3.4',
  ipKey: 'ab'.repeat(32),
  shape: 'circle',
  corners: 'rounded',
  widthUm: 30_000,
  heightUm: 30_000,
  idea: 'x',
  lines: [],
  hasRefs: false,
  model: 'm',
  uploadId: ID,
  orderId: null,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
  calls.length = 0;
  requireAdmin.mockReset().mockImplementation(async () => {
    calls.push('requireAdmin');
  });
  revalidatePath.mockReset();
  aiGetGeneration.mockReset().mockResolvedValue(row());
  orderUsingUpload.mockReset().mockResolvedValue(null);
  aiMarkOrdered.mockReset().mockResolvedValue(undefined);
  aiDeleteGeneration.mockReset().mockResolvedValue(row());
  deleteFile.mockReset().mockImplementation(async (p: string) => {
    calls.push(`deleteFile:${p}`);
  });
  aiDeleteGeneration.mockImplementation(async () => {
    calls.push('aiDeleteGeneration');
    return row();
  });
  adapter = { aiGetGeneration, orderUsingUpload, aiMarkOrdered, aiDeleteGeneration, deleteFile };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deleteDesignAction', () => {
  it('requires admin first, and does nothing when it throws', async () => {
    requireAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(deleteDesignAction(ID)).rejects.toThrow('NEXT_REDIRECT');
    expect(aiGetGeneration).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('deletes an unordered design: the gallery row first, then the image files, then revalidates', async () => {
    await expect(deleteDesignAction(ID)).resolves.toEqual({ status: 'deleted' });
    expect(calls).toEqual([
      'requireAdmin',
      'aiDeleteGeneration',
      `deleteFile:uploads/${ID}.bin`,
      `deleteFile:uploads/${ID}.json`,
    ]);
    expect(aiDeleteGeneration).toHaveBeenCalledWith('gen_1');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/designs');
  });

  it('refuses a design whose row says an order used it', async () => {
    aiGetGeneration.mockResolvedValue(row({ orderId: 'ord_12345678' }));
    await expect(deleteDesignAction(ID)).resolves.toEqual({ status: 'refused' });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(aiDeleteGeneration).not.toHaveBeenCalled();
  });

  it('refuses when an order uses the upload although the row is not marked, and heals the row', async () => {
    orderUsingUpload.mockResolvedValue('ord_87654321');
    await expect(deleteDesignAction(ID)).resolves.toEqual({ status: 'refused' });
    expect(aiMarkOrdered).toHaveBeenCalledWith(ID, 'ord_87654321');
    expect(deleteFile).not.toHaveBeenCalled();
    expect(aiDeleteGeneration).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/admin/designs');
  });

  it('rejects an invalid id without touching storage', async () => {
    for (const bad of ['', 'short', '../../etc/passwd', 'a b c d e f g h', 'x'.repeat(65)]) {
      await expect(deleteDesignAction(bad)).resolves.toEqual({ status: 'invalid' });
    }
    expect(aiGetGeneration).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('no such row is a no-op', async () => {
    aiGetGeneration.mockResolvedValue(null);
    await expect(deleteDesignAction(ID)).resolves.toEqual({ status: 'missing' });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(aiDeleteGeneration).not.toHaveBeenCalled();
  });

  it('deletes nothing when a check cannot run (adapter method missing or storage throws)', async () => {
    adapter = { aiGetGeneration, aiDeleteGeneration, deleteFile }; // no orderUsingUpload
    await expect(deleteDesignAction(ID)).resolves.toEqual({ status: 'error' });

    adapter = { aiGetGeneration, orderUsingUpload, aiMarkOrdered, aiDeleteGeneration, deleteFile };
    orderUsingUpload.mockRejectedValue(new Error('outage'));
    await expect(deleteDesignAction(ID)).resolves.toEqual({ status: 'error' });

    orderUsingUpload.mockResolvedValue(null);
    aiGetGeneration.mockRejectedValue(new Error('outage'));
    await expect(deleteDesignAction(ID)).resolves.toEqual({ status: 'error' });

    expect(deleteFile).not.toHaveBeenCalled();
    expect(aiDeleteGeneration).not.toHaveBeenCalled();
  });

  it('refuses a design younger than 2 hours (a customer may be ordering it), and lets it go at exactly 2 hours', async () => {
    aiGetGeneration.mockResolvedValue(row({ createdAt: '2026-11-26T10:00:01Z' })); // 1 h 59 min 59 s old
    await expect(deleteDesignAction(ID)).resolves.toEqual({ status: 'tooNew' });
    expect(aiDeleteGeneration).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();

    aiGetGeneration.mockResolvedValue(row({ createdAt: '2026-11-26T10:00:00Z' }));
    await expect(deleteDesignAction(ID)).resolves.toEqual({ status: 'deleted' });
  });

  it('an unreadable creation date cannot prove the design is old enough: refused', async () => {
    aiGetGeneration.mockResolvedValue(row({ createdAt: 'garbage' }));
    await expect(deleteDesignAction(ID)).resolves.toEqual({ status: 'tooNew' });
    expect(aiDeleteGeneration).not.toHaveBeenCalled();
  });

  it('a failing row delete removes nothing and is an error (the files are untouched)', async () => {
    aiDeleteGeneration.mockRejectedValue(new Error('db down'));
    await expect(deleteDesignAction(ID)).resolves.toEqual({ status: 'error' });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('when the row is gone but a file cannot be deleted it is still deleted, flagged filesLeft (orphans are swept later)', async () => {
    deleteFile.mockRejectedValue(new Error('storage down'));
    await expect(deleteDesignAction(ID)).resolves.toEqual({ status: 'deleted', filesLeft: true });
    expect(aiDeleteGeneration).toHaveBeenCalledWith('gen_1');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/designs');
  });
});
