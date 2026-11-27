/**
 * pdf-lib is loaded on demand by original.client.ts (it is ~430 KB and stays out of the staff page's
 * first load). A failed chunk load must be LOUD: it must never fall back to the canvas path, which
 * would print a re-encoded RGB JPEG instead of the original CMYK bytes. Here the `pdf-lib` import
 * itself rejects; the staff and receipt downloads must report a build failure (same as a PDF that
 * could not be built), report the error, and never call the canvas preparation.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { ReceiptAction } from '@/components/staff/receipts/receipt-logic';
import type { StaffAction } from '@/components/staff/staff-logic';
import type { DesignSource } from '@/lib/types';

const spies = vi.hoisted(() => ({ prepareArtwork: vi.fn(), reportClientError: vi.fn() }));

/** Fresh copies of the modules under test, with the `pdf-lib` import rejecting (the factory throws). */
async function load() {
  vi.resetModules();
  vi.doMock('pdf-lib', () => {
    throw new Error('Loading chunk pdf-lib failed (network)');
  });
  vi.doMock('@/lib/design/prepare.client', () => ({ prepareArtwork: spies.prepareArtwork }));
  vi.doMock('@/lib/monitoring/report.client', () => ({ reportClientError: spies.reportClientError }));
  const [original, staff, receipts] = await Promise.all([
    import('@/lib/design/original.client'),
    import('@/components/staff/staff-logic'),
    import('@/components/staff/receipts/receipt-logic'),
  ]);
  return { ...original, ...staff, ...receipts };
}

const LAYOUT = DEFAULT_SETTINGS.layout;
const jpegBytes = new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', 'opaque-300x300.jpg')));
const MIME = { jpeg: 'image/jpeg', png: 'image/png' } as const;
const source = (kind: 'jpeg' | 'png', name: string): DesignSource => ({
  kind,
  file: new File([new Uint8Array(jpegBytes)], name, { type: MIME[kind] }),
  pxWidth: 300,
  pxHeight: 300,
  hasAlpha: false,
  previewUrl: `blob:${name}`,
});

beforeEach(() => {
  spies.prepareArtwork.mockReset();
  spies.reportClientError.mockReset();
  spies.prepareArtwork.mockResolvedValue({ ok: false, error: 'corrupt' });
});

describe('pdf-lib chunk fails to load', () => {
  it('prepareOriginalArtwork rejects for a JPEG and never takes the canvas path', async () => {
    const { prepareOriginalArtwork } = await load();
    const spec = { shape: 'rect', corners: 'sharp', widthUm: 30_000, heightUm: 30_000 } as const;
    await expect(prepareOriginalArtwork(source('jpeg', 'a.jpg'), spec)).rejects.toSatisfy((e: unknown) => String((e as { cause?: unknown }).cause ?? e).includes('Loading chunk pdf-lib failed'));
    expect(spies.prepareArtwork).not.toHaveBeenCalled();
  });

  it('a PNG never needs pdf-lib here: its original bytes still go through', async () => {
    const { prepareOriginalArtwork } = await load();
    const png = new Uint8Array(await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer());
    const s = { ...source('png', 'a.png'), file: new File([new Uint8Array(png)], 'a.png', { type: 'image/png' }) };
    const spec = { shape: 'rect', corners: 'sharp', widthUm: 30_000, heightUm: 30_000 } as const;
    const r = await prepareOriginalArtwork(s, spec);
    expect(r.ok).toBe(true);
    expect(spies.prepareArtwork).not.toHaveBeenCalled();
  });

  it('the staff download reports a build failure, reports the error, and never uses the canvas path', async () => {
    const { buildStaffFile, staffReducer } = await load();
    const id = 'a.jpg-0';
    const actions: StaffAction[] = [
      { type: 'add', items: [{ id, file: new File([new Uint8Array([1])], 'a.jpg') }] },
      { type: 'shape', id, shape: 'sharp' },
      { type: 'width', id, text: '3' },
      { type: 'decoded', id, seq: 1, outcome: { ok: true, source: source('jpeg', 'a.jpg') } },
    ];
    const card = actions.reduce(staffReducer, [])[0];
    const out = await buildStaffFile(card, 'a-3cm.pdf', LAYOUT);
    expect(out).toMatchObject({ ok: false, reason: 'build', cardId: id });
    expect(spies.reportClientError).toHaveBeenCalledTimes(1);
    expect(spies.reportClientError.mock.calls[0][1]).toMatchObject({ where: 'staff.buildPdf' });
    expect(spies.prepareArtwork).not.toHaveBeenCalled();
  });

  it('the receipts download reports a build failure, reports the error, and never uses the canvas path', async () => {
    const { buildReceiptFile, receiptReducer } = await load();
    const id = 'a.jpg-0';
    const actions: ReceiptAction[] = [
      { type: 'add', items: [{ id, file: new File([new Uint8Array([1])], 'a.jpg') }] },
      { type: 'decoded', id, outcome: { ok: true, source: source('jpeg', 'a.jpg') } },
    ];
    const card = actions.reduce(receiptReducer, [])[0];
    const out = await buildReceiptFile(card, 'a-a4.pdf');
    expect(out).toMatchObject({ ok: false, reason: 'build', cardId: id });
    expect(spies.reportClientError).toHaveBeenCalledTimes(1);
    expect(spies.reportClientError.mock.calls[0][1]).toMatchObject({ where: 'staff.receipts.buildPdf' });
    expect(spies.prepareArtwork).not.toHaveBeenCalled();
  });
});
