import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { admin } from '@/content/ar';
import type { AiGenerationRecord } from '@/lib/types';

const guard = vi.hoisted(() => ({ denied: null as Response | null }));
const store = vi.hoisted(() => ({
  row: null as unknown,
  upload: null as unknown,
}));
const normalise = vi.hoisted(() => vi.fn());
const buildPdf = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/session', () => ({ adminApiGuard: async () => guard.denied }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => DEFAULT_SETTINGS }));
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    aiGetGeneration: async () => store.row,
    readUpload: async () => store.upload,
  }),
}));
vi.mock('@/lib/design/normalise.server', () => ({ normaliseArtwork: normalise }));
vi.mock('@/lib/pdf/build-sheet', () => ({ buildSheetPdf: buildPdf }));

import { GET as getImage } from '@/app/api/admin/designs/[id]/image/route';
import { GET as getSheet } from '@/app/api/admin/designs/[id]/sheet/route';

const ID = 'upl_abcdef123456';
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const req = (path: string) => new Request(`http://localhost${path}`);
const row = (over: Partial<AiGenerationRecord> = {}): AiGenerationRecord => ({
  id: 'gen_1',
  createdAt: '2026-11-20T10:00:00Z',
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
const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const pdfOf = (n: number) => ({ bytes: new Uint8Array(n), report: {} });

beforeEach(() => {
  guard.denied = null;
  store.row = row();
  store.upload = { bytes: png, meta: {} };
  normalise.mockReset().mockResolvedValue({ ok: true, artwork: { kind: 'raster' }, pxWidth: 1, pxHeight: 1, kind: 'png' });
  buildPdf.mockReset().mockResolvedValue(pdfOf(1000));
});

describe('GET /api/admin/designs/<id>/image', () => {
  it('stays inline without the parameter', async () => {
    const res = await getImage(req(`/api/admin/designs/${ID}/image`), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
  });

  it('?download=1 sends an attachment with an ASCII name', async () => {
    const res = await getImage(req(`/api/admin/designs/${ID}/image?download=1`), ctx());
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="softy-design-${ID}.png"`);
  });

  it('any other value stays inline; the guard and the id are still checked', async () => {
    const other = await getImage(req(`/api/admin/designs/${ID}/image?download=yes`), ctx());
    expect(other.headers.get('content-disposition')).toBe('inline');
    expect((await getImage(req('/x'), ctx('../etc'))).status).toBe(404);
    guard.denied = new Response(null, { status: 401 });
    expect((await getImage(req('/x?download=1'), ctx())).status).toBe(401);
  });
});

describe('GET /api/admin/designs/<id>/sheet', () => {
  it('is admin only', async () => {
    guard.denied = new Response(null, { status: 401 });
    expect((await getSheet(req('/x'), ctx())).status).toBe(401);
    expect(buildPdf).not.toHaveBeenCalled();
  });

  it('404 for a bad id, a missing row or a missing upload', async () => {
    expect((await getSheet(req('/x'), ctx('../etc'))).status).toBe(404);
    store.row = null;
    const res = await getSheet(req('/x'), ctx());
    expect(res.status).toBe(404);
    expect((await res.json()).message).toBe(admin.designs.sheet.notFound);
    store.row = row();
    store.upload = null;
    expect((await getSheet(req('/x'), ctx())).status).toBe(404);
  });

  it('answers a PDF attachment named after the shape, size and count; the PDF builder is called once at 1200 DPI', async () => {
    const res = await getSheet(req('/x'), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="softy-sheet-circle-30x30mm-x\d+\.pdf"$/);
    expect(buildPdf).toHaveBeenCalledTimes(1);
    expect(normalise.mock.calls[0][1]).toMatchObject({ targetDpi: 1200, spec: { shape: 'circle', widthUm: 30_000 } });
    expect(buildPdf.mock.calls[0][0].meta.displayNo).toBe('SOFTY');
  });

  it('lowers the DPI (600, then 300) until the PDF is at most 4,000,000 bytes', async () => {
    buildPdf
      .mockResolvedValueOnce(pdfOf(5_000_000))
      .mockResolvedValueOnce(pdfOf(4_500_000))
      .mockResolvedValueOnce(pdfOf(3_000_000));
    const res = await getSheet(req('/x'), ctx());
    expect(res.status).toBe(200);
    expect(normalise.mock.calls.map((c) => c[1].targetDpi)).toEqual([1200, 600, 300]);
    expect(Number(res.headers.get('content-length'))).toBe(3_000_000);
  });

  it('stops at the first size that fits', async () => {
    buildPdf.mockResolvedValueOnce(pdfOf(5_000_000)).mockResolvedValueOnce(pdfOf(2_000_000));
    await getSheet(req('/x'), ctx());
    expect(normalise.mock.calls.map((c) => c[1].targetDpi)).toEqual([1200, 600]);
  });

  it('a PDF that is still too big gets a clear error, never oversized bytes', async () => {
    buildPdf.mockResolvedValue(pdfOf(5_000_000));
    const res = await getSheet(req('/x'), ctx());
    expect(res.status).toBe(413);
    expect((await res.json()).message).toBe(admin.designs.sheet.tooBig);
  });

  it('vector artwork is not re-normalised', async () => {
    normalise.mockResolvedValue({ ok: true, artwork: { kind: 'pdf' }, pxWidth: 1, pxHeight: 1, kind: 'pdf' });
    buildPdf.mockResolvedValue(pdfOf(5_000_000));
    const res = await getSheet(req('/x'), ctx());
    expect(normalise).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(413);
  });

  it('a sticker that does not fit the sheet is an error response', async () => {
    store.row = row({ widthUm: 300_000, heightUm: 300_000 });
    const res = await getSheet(req('/x'), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).message).toBe(admin.designs.sheet.layoutFailed);
    expect(buildPdf).not.toHaveBeenCalled();
  });

  it('an artwork that cannot be prepared, or a builder crash, is an error response', async () => {
    normalise.mockResolvedValueOnce({ ok: false, error: 'corrupt' });
    expect((await getSheet(req('/x'), ctx())).status).toBe(422);
    buildPdf.mockRejectedValueOnce(new Error('boom'));
    const res = await getSheet(req('/x'), ctx());
    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe(admin.designs.sheet.failed);
  });
});
