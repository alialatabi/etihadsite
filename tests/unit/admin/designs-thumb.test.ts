/** GET /api/admin/designs/<id>/image?thumb=1: the gallery tile preview (640 px WebP), with a PNG fallback. */
import sharp from 'sharp';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const guard = vi.hoisted(() => ({ denied: null as Response | null }));
const store = vi.hoisted(() => ({ upload: null as { bytes: Uint8Array; meta: unknown } | null }));

vi.mock('@/lib/auth/session', () => ({ adminApiGuard: async () => guard.denied }));
vi.mock('@/lib/storage', () => ({ getStorage: () => ({ readUpload: async () => store.upload }) }));

import { GET } from '@/app/api/admin/designs/[id]/image/route';

const ID = 'upl_abcdef123456';
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const req = (qs: string) => new Request(`http://localhost/api/admin/designs/${ID}/image${qs}`);
const solid = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();

let big: Buffer;
let small: Buffer;
beforeAll(async () => {
  big = await solid(1600, 1200);
  small = await solid(200, 100);
});
beforeEach(() => {
  guard.denied = null;
  store.upload = { bytes: new Uint8Array(big), meta: {} };
});

describe('?thumb=1', () => {
  it('returns a WebP no larger than 640 px, with the same private cache and nosniff headers', async () => {
    const res = await GET(req('?thumb=1'), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = Buffer.from(await res.arrayBuffer());
    expect(res.headers.get('content-length')).toBe(String(body.byteLength));
    expect(body.byteLength).toBeLessThan(big.byteLength);
    const meta = await sharp(body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(480);
  });

  it('never enlarges a small design', async () => {
    store.upload = { bytes: new Uint8Array(small), meta: {} };
    const meta = await sharp(Buffer.from(await (await GET(req('?thumb=1'), ctx())).arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([200, 100]);
  });

  it('still enforces the guard, the id check and the missing-file 404', async () => {
    guard.denied = new Response(null, { status: 401 });
    expect((await GET(req('?thumb=1'), ctx())).status).toBe(401);
    guard.denied = null;
    expect((await GET(req('?thumb=1'), ctx('../etc'))).status).toBe(404);
    store.upload = null;
    expect((await GET(req('?thumb=1'), ctx())).status).toBe(404);
  });

  it('falls back to the original PNG when sharp cannot decode the bytes', async () => {
    const junk = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    store.upload = { bytes: junk, meta: {} };
    const res = await GET(req('?thumb=1'), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...junk]);
  });

  it('is ignored with download=1 (the original PNG attachment)', async () => {
    const res = await GET(req('?thumb=1&download=1'), ctx());
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="softy-design-${ID}.png"`);
    expect(res.headers.get('content-length')).toBe(String(big.byteLength));
  });
});

describe('without ?thumb=1', () => {
  it('serves the original PNG unchanged', async () => {
    const res = await GET(req(''), ctx());
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('content-length')).toBe(String(big.byteLength));
    expect(Buffer.from(await res.arrayBuffer()).equals(big)).toBe(true);
    expect((await GET(req('?thumb=0'), ctx())).headers.get('content-type')).toBe('image/png');
  });
});
