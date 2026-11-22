import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { hasPngSignature, pdfHasActiveContent, pngChunksComplete, rasterDecodeOk } from '@/app/api/_lib/file-safety';
import { checkUploadBytes } from '@/app/api/_lib/image-header';
import { cleanOriginalName } from '@/app/api/_lib/upload';
import { order } from '@/content/ar';
import type { UploadResponse } from '@/lib/types';
import { pngWithDeclaredSize } from '../png-header';
import {
  cleanPdf,
  pdfWithEmbeddedFiles,
  pdfWithEscapedJsKey,
  pdfWithGoTo,
  pdfWithLaunch,
  pdfWithOpenActionJs,
  pdfWithRichMedia,
  pdfWithTooDeepJs,
  pdfWithXfa,
} from '../unsafe-pdf';
import { setupEnv } from './helpers';

import { POST } from '@/app/api/upload/route';
import { getStorage } from '@/lib/storage';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');
const fx = (n: string) => new Uint8Array(readFileSync(join(FIXTURES, n)));

describe('PDF active-content scan', () => {
  it.each([
    ['a JavaScript /OpenAction', pdfWithOpenActionJs],
    ['/Names /EmbeddedFiles', pdfWithEmbeddedFiles],
    ['a RichMedia annotation inside /Annots', pdfWithRichMedia],
    ['an XFA AcroForm', pdfWithXfa],
    ['a Launch action in a link annotation', pdfWithLaunch],
    ['a #-escaped /J#53 key', async () => pdfWithEscapedJsKey()],
  ])('flags %s', async (_label, make) => {
    const bytes = await make();
    expect(await pdfHasActiveContent(bytes)).toBe(true);
    expect(await checkUploadBytes(bytes)).toEqual({ ok: false, error: 'unsafe' });
  });

  it('accepts a clean PDF and a plain GoTo OpenAction', async () => {
    for (const bytes of [await cleanPdf(), await pdfWithGoTo()]) {
      expect(await pdfHasActiveContent(bytes)).toBe(false);
      expect(await checkUploadBytes(bytes)).toEqual({ ok: true, kind: 'pdf' });
    }
  });

  it('accepts every PDF fixture of the repo', async () => {
    const pdfs = readdirSync(FIXTURES).filter((f) => f.endsWith('.pdf'));
    expect(pdfs.length).toBeGreaterThanOrEqual(3);
    for (const name of pdfs) {
      expect(await checkUploadBytes(fx(name)), name).toEqual({ ok: true, kind: 'pdf' });
    }
  });

  it('accepts a PDF pdf-lib cannot read (the order flow handles it later) instead of rejecting it', async () => {
    const bare = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
    expect(await pdfHasActiveContent(bare)).toBe(false);
    expect(await checkUploadBytes(bare)).toEqual({ ok: true, kind: 'pdf' });
  });

  it('stops at the depth bound and accepts instead of blocking', async () => {
    expect(await pdfHasActiveContent(await pdfWithTooDeepJs())).toBe(false);
  });
});

describe('raster checks', () => {
  const good = fx('padded-400x400.png');

  it('requires the full 8-byte PNG signature', async () => {
    expect(hasPngSignature(good)).toBe(true);
    const wrong = new Uint8Array(good);
    wrong[4] = 0x00; // 89 50 4E 47 00 0A 1A 0A: sniffKind still says png (it reads 4 bytes)
    expect(hasPngSignature(wrong)).toBe(false);
    expect(await checkUploadBytes(wrong)).toEqual({ ok: false, error: 'unsupported_type' });
    const wrongTail = new Uint8Array(good);
    wrongTail[7] = 0x0b;
    expect(await checkUploadBytes(wrongTail)).toEqual({ ok: false, error: 'unsupported_type' });
  });

  it('refuses a PNG cut in the middle of its data as corrupt', async () => {
    const cut = good.slice(0, Math.floor(good.length / 2));
    expect(pngChunksComplete(cut)).toBe(false);
    expect(await checkUploadBytes(cut)).toEqual({ ok: false, error: 'corrupt' });
  });

  it('refuses a PNG whose chunk CRC is damaged and a JPEG that is cut', async () => {
    const bad = new Uint8Array(pngWithDeclaredSize(1, 1));
    bad[50] ^= 0xff; // the first byte of the IDAT chunk's CRC (8 signature + 25 IHDR + 8 + 9 data)
    expect(pngChunksComplete(bad)).toBe(false);
    expect(await checkUploadBytes(bad)).toEqual({ ok: false, error: 'corrupt' });
    const jpg = fx('exif6-600x400.jpg');
    expect(await checkUploadBytes(jpg.slice(0, Math.floor(jpg.length / 2)))).toEqual({ ok: false, error: 'corrupt' });
  });

  it('accepts real PNG and JPEG files, and a complete PNG with bytes after IEND', async () => {
    expect(await checkUploadBytes(good)).toEqual({ ok: true, kind: 'png' });
    expect(await checkUploadBytes(fx('exif6-600x400.jpg'))).toEqual({ ok: true, kind: 'jpeg' });
    const padded = new Uint8Array(good.length + 50).fill(7);
    padded.set(good);
    expect(pngChunksComplete(padded)).toBe(true);
    expect(await checkUploadBytes(padded)).toEqual({ ok: true, kind: 'png' });
  });

  it('keeps accepting a structurally complete PNG with too little pixel data (the pinned route fixtures)', async () => {
    expect(await checkUploadBytes(pngWithDeclaredSize(1, 1))).toEqual({ ok: true, kind: 'png' });
    expect(await checkUploadBytes(pngWithDeclaredSize(9921, 14031))).toEqual({ ok: true, kind: 'png' });
  });

  it('refuses a side over 60 000 px even when the pixel total is under the cap', async () => {
    expect(await rasterDecodeOk(pngWithDeclaredSize(60_000, 1), 'png')).toBe(true);
    expect(await rasterDecodeOk(pngWithDeclaredSize(60_001, 1), 'png')).toBe(false);
    expect(await checkUploadBytes(pngWithDeclaredSize(1, 60_001))).toEqual({ ok: false, error: 'corrupt' });
  });
});

describe('cleanOriginalName', () => {
  it('removes C0, DEL, C1 and bidi controls but keeps ZWJ/ZWNJ and Arabic', () => {
    const dirty = `a\u0000b\u007fc\u0085d\u009fe‎f‏g‪h‮i⁦j⁩k‍l‌m تصميم.png`;
    expect(cleanOriginalName(dirty)).toBe('abcdefghijk‍l‌m تصميم.png');
  });

  it('keeps the 200-character cap and the "design" fallback', () => {
    expect(cleanOriginalName('x'.repeat(300))).toHaveLength(200);
    expect(cleanOriginalName(undefined)).toBe('design');
    expect(cleanOriginalName('')).toBe('design');
  });
});

describe('POST /api/upload with the new rules', () => {
  beforeEach(() => {
    setupEnv();
  });

  async function upload(bytes: Uint8Array, name: string, type: string) {
    const form = new FormData();
    form.set('file', new File([bytes as BlobPart], name, { type }));
    const encoded = new Response(form);
    const raw = new Uint8Array(await encoded.arrayBuffer());
    return POST(
      new Request('http://localhost/api/upload', {
        method: 'POST',
        body: raw,
        headers: {
          'x-forwarded-for': '8.8.4.4',
          'content-type': encoded.headers.get('content-type')!,
          'content-length': String(raw.byteLength),
        },
      }),
    );
  }

  it('answers 422 unsafe for a PDF with a JavaScript action and stores nothing', async () => {
    const res = await upload(await pdfWithOpenActionJs(), 'a.pdf', 'application/pdf');
    expect(res.status).toBe(422);
    expect((await res.json()) as UploadResponse).toEqual({ ok: false, error: 'unsafe', message: order.errors.unsafe });
    const dir = join(process.env.DATA_DIR as string, 'uploads');
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it('stores a clean PDF and the cleaned bidi-free name', async () => {
    const res = await upload(await cleanPdf(), 'a‮bad.pdf', 'application/pdf');
    expect(res.status).toBe(200);
    const r = (await res.json()) as UploadResponse;
    if (!r.ok) throw new Error('expected ok');
    expect((await getStorage().readUpload(r.uploadId))?.meta.originalName).toBe('abad.pdf');
  });

  it('answers 415 for a PNG with a wrong signature and 400 for a cut PNG', async () => {
    const wrong = new Uint8Array(fx('padded-400x400.png'));
    wrong[5] = 0x00;
    expect((await upload(wrong, 'a.png', 'image/png')).status).toBe(415);
    const good = fx('padded-400x400.png');
    expect((await upload(good.slice(0, 600), 'a.png', 'image/png')).status).toBe(400);
  });
});
