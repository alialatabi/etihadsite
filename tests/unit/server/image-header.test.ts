import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rasterHeaderOk } from '@/app/api/_lib/image-header';
import { pngWithDeclaredSize } from '../png-header';

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', n)));

describe('rasterHeaderOk (upload commit check)', () => {
  it('accepts real PNG and JPEG files', async () => {
    expect(await rasterHeaderOk(fx('padded-400x400.png'), 'png')).toBe(true);
    expect(await rasterHeaderOk(fx('exif6-600x400.jpg'), 'jpeg')).toBe(true);
  });

  it('accepts a header at 139.2 MP and refuses one over the cap', async () => {
    expect(await rasterHeaderOk(pngWithDeclaredSize(9921, 14031), 'png')).toBe(true);
    expect(await rasterHeaderOk(pngWithDeclaredSize(16_000, 16_000), 'png')).toBe(false);
  });

  it('refuses magic bytes with a header sharp cannot read', async () => {
    expect(await rasterHeaderOk(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), 'png')).toBe(false);
    expect(await rasterHeaderOk(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), 'jpeg')).toBe(false);
  });

  it('never judges a PDF', async () => {
    expect(await rasterHeaderOk(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 9, 9]), 'pdf')).toBe(true);
    expect(await rasterHeaderOk(fx('two-page.pdf'), 'pdf')).toBe(true);
  });
});
