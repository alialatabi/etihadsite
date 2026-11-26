import { beforeEach, describe, expect, it, vi } from 'vitest';
import { customerAllTime } from '@/app/admin/designs/all-time';
import { getStorage } from '@/lib/storage';
import type { AiGenerationRecord } from '@/lib/types';
import { setupEnv } from '../server/helpers';

const gen = (id: string, over: Partial<AiGenerationRecord> = {}): AiGenerationRecord => ({
  id,
  createdAt: '2026-11-26T08:00:00.000Z',
  day: '2026-11-26',
  ip: '',
  ipKey: 'k1',
  shape: 'circle',
  corners: 'rounded',
  widthUm: 50_000,
  heightUm: 50_000,
  idea: 'x',
  lines: [],
  hasRefs: false,
  model: 'gpt-image',
  uploadId: `upload-${id}-0001`,
  orderId: null,
  ...over,
});

beforeEach(() => setupEnv());

describe('«الكل» counts customer designs only', () => {
  async function seed() {
    const s = getStorage();
    await s.aiRecordGeneration!(gen('gen_cust0001'));
    await s.aiRecordGeneration!(gen('gen_cust0002', { createdAt: '2026-11-26T09:00:00.000Z' }));
    await s.aiRecordGeneration!(gen('gen_staff001', { ipKey: 'staff:st_a', staffId: 'st_aaaaaaaa' }));
    await s.aiRecordGeneration!(gen('gen_staff002', { ipKey: 'staff:st_b', staffId: 'st_bbbbbbbb' }));
    return s;
  }

  it('the maker filter of aiListGenerations', async () => {
    const s = await seed();
    const total = async (maker?: Parameters<NonNullable<typeof s.aiListGenerations>>[0]['maker']) =>
      (await s.aiListGenerations!({ limit: 0, offset: 0, maker })).total;
    expect(await total()).toBe(4);
    expect(await total('customer')).toBe(2);
    expect(await total('staff')).toBe(2);
    expect(await total({ staffId: 'st_aaaaaaaa' })).toBe(1);
    const rows = (await s.aiListGenerations!({ limit: 10, offset: 0, maker: 'customer' })).rows;
    expect(rows.map((r) => r.id)).toEqual(['gen_cust0002', 'gen_cust0001']);
  });

  it('customerAllTime ignores the staff rows', async () => {
    expect(await customerAllTime(await seed())).toBe(2);
  });

  it('a storage that rejects the staff filter answers with its plain total; no method = unknown', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('column ai_generations.staff_id does not exist'))
      .mockResolvedValueOnce({ rows: [], total: 7 });
    expect(await customerAllTime({ aiListGenerations: list })).toBe(7);
    expect(list).toHaveBeenLastCalledWith({ limit: 0, offset: 0 });
    expect(await customerAllTime({})).toBeNull();
  });
});
