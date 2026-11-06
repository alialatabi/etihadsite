import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { UploadResponse } from '@/lib/types';
import { setupEnv } from './helpers';

import { POST } from '@/app/api/upload/route';
import { getStorage } from '@/lib/storage';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function upload(bytes: Uint8Array, name = 'a.png', type = 'image/png', ip = '8.8.8.8') {
  const form = new FormData();
  form.set('file', new File([bytes as BlobPart], name, { type }));
  return POST(new Request('http://localhost/api/upload', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } }));
}

const json = async (r: Response) => (await r.json()) as UploadResponse;

beforeEach(() => {
  setupEnv();
});

describe('POST /api/upload', () => {
  it('stores a PNG and returns an uploadId', async () => {
    const res = await upload(new Uint8Array([...PNG, 1, 2, 3]));
    expect(res.status).toBe(200);
    const r = await json(res);
    if (!r.ok) throw new Error('expected ok');
    expect(r.kind).toBe('png');
    expect(r.bytes).toBe(11);
    const stored = await getStorage().readUpload(r.uploadId);
    expect(stored?.meta.originalName).toBe('a.png');
    expect(stored?.meta.mime).toBe('image/png');
  });

  it('rejects a GIF by magic bytes even when labelled image/png', async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
    const res = await upload(gif, 'a.png', 'image/png');
    expect(res.status).toBe(415);
    expect(await json(res)).toMatchObject({ ok: false, error: 'unsupported_type' });
  });

  it('rejects oversize files', async () => {
    const big = new Uint8Array(DEFAULT_SETTINGS.maxUploadBytes + 1);
    big.set(PNG);
    const res = await upload(big);
    expect(res.status).toBe(413);
    expect(await json(res)).toMatchObject({ ok: false, error: 'too_large' });
  });

  it('rejects a missing file field and rate limits', async () => {
    const empty = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: new FormData() }));
    expect(empty.status).toBe(400);
    for (let i = 0; i < 20; i++) await upload(new Uint8Array([...PNG, i]), 'a.png', 'image/png', '6.6.6.6');
    const limited = await upload(new Uint8Array([...PNG, 99]), 'a.png', 'image/png', '6.6.6.6');
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ ok: false, error: 'rate_limited' });
  });
});
