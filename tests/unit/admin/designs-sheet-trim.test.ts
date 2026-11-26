/**
 * The sheet route with the REAL normaliseArtwork: a custom-shape design is a transparent 1024x1024 canvas that is
 * trimmed to its alpha box, so the sticker is not the typed square. Only storage, settings, auth and the PDF
 * builder are mocked; computeLayout is the real one, recorded.
 */
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { AiGenerationRecord } from '@/lib/types';

const store = vi.hoisted(() => ({ row: null as unknown, bytes: new Uint8Array() as Uint8Array }));
const buildPdf = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/session', () => ({ adminApiGuard: async () => null }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => DEFAULT_SETTINGS }));
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    aiGetGeneration: async () => store.row,
    readUpload: async () => ({ bytes: store.bytes, meta: {} }),
    getOrder: async () => null,
  }),
}));
vi.mock('@/lib/pdf/build-sheet', () => ({ buildSheetPdf: buildPdf }));
vi.mock('@/lib/layout', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/layout')>();
  return { ...real, computeLayout: vi.fn(real.computeLayout) };
});

import { GET as getSheet } from '@/app/api/admin/designs/[id]/sheet/route';
import { aiAcceptedSize } from '@/lib/ai/accepted-size';
import { computeLayout } from '@/lib/layout';

const ID = 'upl_abcdef123456';

/** A 1024x1024 transparent canvas with an opaque `w` x `h` block in it (what the AI designer stores for a custom shape). */
async function canvasWithBlock(w: number, h: number): Promise<Uint8Array> {
  const block = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 20, b: 60, alpha: 1 } } }).png().toBuffer();
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: block, left: 100, top: 12 }])
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

const row = (over: Partial<AiGenerationRecord>): AiGenerationRecord => ({
  id: 'gen_1',
  createdAt: '2026-11-20T10:00:00Z',
  day: '2026-11-20',
  ip: '1.2.3.4',
  ipKey: 'ab'.repeat(32),
  shape: 'custom',
  corners: 'sharp',
  widthUm: 50_000,
  heightUm: 50_000,
  idea: 'x',
  lines: [],
  hasRefs: false,
  model: 'm',
  uploadId: ID,
  orderId: null,
  ...over,
});

beforeEach(() => {
  buildPdf.mockReset().mockResolvedValue({ bytes: new Uint8Array(1000), report: {} });
  vi.mocked(computeLayout).mockClear();
});

describe('GET /api/admin/designs/<id>/sheet with a real trimmed custom PNG', () => {
  it('lays the sheet out at the accepted size of the trimmed pixels, not at the typed square', async () => {
    store.bytes = await canvasWithBlock(400, 1000); // alpha box 400 x 1000 px
    store.row = row({});
    const res = await getSheet(new Request('http://localhost/x'), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);

    const accepted = aiAcceptedSize('custom', { widthUm: 50_000, heightUm: 50_000 }, 400 / 1000);
    expect(accepted).toEqual({ widthUm: 20_000, heightUm: 50_000 });
    expect(vi.mocked(computeLayout).mock.calls[0][0]).toEqual({ shape: 'custom', corners: 'sharp', ...accepted });
    expect(res.headers.get('content-disposition')).toMatch(/softy-sheet-custom-20x50mm-x\d+\.pdf/);
  });

  it('a wide trimmed design keeps the typed side on its width', async () => {
    store.bytes = await canvasWithBlock(900, 300);
    store.row = row({});
    const res = await getSheet(new Request('http://localhost/x'), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    expect(vi.mocked(computeLayout).mock.calls[0][0]).toEqual({ shape: 'custom', corners: 'sharp', widthUm: 50_000, heightUm: 16_667 });
  });
});
