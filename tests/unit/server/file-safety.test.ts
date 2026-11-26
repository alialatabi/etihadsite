import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { hasPngSignature, pdfHasActiveContent, pngChunksComplete, rasterDecodeOk } from '@/app/api/_lib/file-safety';
import { checkUploadBytes } from '@/app/api/_lib/image-header';
import { cleanOriginalName } from '@/app/api/_lib/upload';
import { order } from '@/content/ar';
import type { UploadResponse } from '@/lib/types';
import { pngWithDeclaredSize } from '../png-header';
import {
  asciiHexBytes,
  cleanPdf,
  contentText,
  flateBytes,
  flateWithBadTail,
  pdfWithEmbeddedFiles,
  pdfWithEscapedJsKey,
  pdfWithEscapedObjectStreamKey,
  pdfWithForwardTypedObjectStream,
  pdfWithGoTo,
  pdfWithLaunch,
  pdfWithLowerCaseEscapedJsKey,
  pdfWithOpenActionJs,
  pdfWithRichMedia,
  pdfWithDuplicateObject,
  pdfWithNestedJs,
  pdfWithObjectStreamBody,
  pdfWithObjectStreams,
  pdfWithPageContents,
  pdfWithPaddingBeforeJs,
  pdfWithRawContents,
  storedFlateBytes,
  pdfWithTooDeepJs,
  pdfWithUntypedObjectStream,
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
    ['a lower-case #-escaped /#4aS key', async () => pdfWithLowerCaseEscapedJsKey()],
    ['an untyped object stream whose /N key is lower-case #-escaped', async () => pdfWithEscapedObjectStreamKey()],
    ['an object stream whose /Type is an indirect reference (never expanded, so never scanned)', async () => pdfWithForwardTypedObjectStream()],
    ['an object stream with no /Type (never expanded, so never scanned)', async () => pdfWithUntypedObjectStream()],
  ])('flags %s', async (_label, make) => {
    const bytes = await make();
    expect(await pdfHasActiveContent(bytes)).toBe(true);
    expect(await checkUploadBytes(bytes)).toEqual({ ok: false, error: 'unsafe' });
  });

  it('accepts a PDF saved with object streams (a correctly labelled /Type /ObjStm is expanded and scanned)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const bytes = await doc.save({ useObjectStreams: true });
    expect(new TextDecoder('latin1').decode(bytes)).toContain('/ObjStm');
    expect(await pdfHasActiveContent(bytes)).toBe(false);
    expect(await checkUploadBytes(bytes)).toEqual({ ok: true, kind: 'pdf' });
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
    // Even with absurdly low decode caps: a file that cannot be read has nothing to bound.
    expect(await pdfHasActiveContent(bare, undefined, { perStream: 1, totalContent: 1 })).toBe(false);
  });

  describe('decode bound (the caps are lowered here, so no large file is needed)', () => {
    const big = { perStream: 1 << 30, totalContent: 1 << 30 };

    it('refuses an object or xref stream that inflates past the per-stream cap, and accepts it under the default', async () => {
      const bytes = fx('cropbox-rot90.pdf'); // has a /Type /ObjStm and a /Type /XRef stream
      const text = new TextDecoder('latin1').decode(bytes);
      expect(text).toContain('/ObjStm');
      expect(text).toContain('/XRef');
      // The ObjStm decodes to 743 bytes, the XRef stream to 40, the page content to 222: only the parse hook can trip 300.
      expect(await pdfHasActiveContent(bytes, undefined, { perStream: 300, totalContent: 1 << 30 })).toBe(true);
      expect(await pdfHasActiveContent(bytes, undefined, { perStream: 800, totalContent: 1 << 30 })).toBe(false);
      expect(await pdfHasActiveContent(bytes, undefined, big)).toBe(false);
      expect(await checkUploadBytes(bytes)).toEqual({ ok: true, kind: 'pdf' });
    });

    it('adds the object streams and the page content of a file into one total (fixture)', async () => {
      const bytes = fx('cropbox-rot90.pdf'); // ObjStm 743 + XRef 40 bytes while parsing, then the page content 222: 1005 together
      expect(await pdfHasActiveContent(bytes, undefined, { perStream: 1 << 30, totalContent: 1000 })).toBe(true); // only the page content tips it over
      expect(await pdfHasActiveContent(bytes, undefined, { perStream: 1 << 30, totalContent: 1100 })).toBe(false);
      expect(await pdfHasActiveContent(bytes, undefined, { perStream: 1 << 30, totalContent: 1 << 30 })).toBe(false);
    });

    it('bounds a Flate content stream of a PDF saved without object streams', async () => {
      const bytes = await pdfWithRawContents([{ bytes: flateBytes(contentText(600)), filters: ['FlateDecode'] }], false);
      expect(await pdfHasActiveContent(bytes, undefined, { perStream: 1 << 30, totalContent: 64 })).toBe(true);
      expect(await pdfHasActiveContent(bytes, undefined, { perStream: 64, totalContent: 1 << 30 })).toBe(true);
      expect(await pdfHasActiveContent(bytes, undefined, { perStream: 600, totalContent: 600 })).toBe(false);
      expect(await pdfHasActiveContent(bytes)).toBe(false);
    });

    it('sums a /Contents array of streams against the total cap', async () => {
      const part = { bytes: flateBytes(contentText(100)), filters: ['FlateDecode'] };
      const bytes = await pdfWithRawContents([part, part, { bytes: flateBytes(contentText(100)), filters: ['FlateDecode'] }]);
      expect(await pdfHasActiveContent(bytes, undefined, { perStream: 200, totalContent: 250 })).toBe(true); // 300 together
      expect(await pdfHasActiveContent(bytes, undefined, { perStream: 200, totalContent: 400 })).toBe(false);
      expect(await pdfHasActiveContent(bytes)).toBe(false);
    });

    it.each([
      ['ASCIIHexDecode', (t: Uint8Array) => ({ bytes: asciiHexBytes(t), filters: ['ASCIIHexDecode'] })],
      ['[ASCIIHexDecode FlateDecode]', (t: Uint8Array) => ({ bytes: asciiHexBytes(flateBytes(t)), filters: ['ASCIIHexDecode', 'FlateDecode'] })],
      ['[FlateDecode FlateDecode]', (t: Uint8Array) => ({ bytes: flateBytes(flateBytes(t)), filters: ['FlateDecode', 'FlateDecode'] })],
      ['no filter', (t: Uint8Array) => ({ bytes: t })],
    ])('bounds a content stream with %s', async (_label, encode) => {
      const bytes = await pdfWithRawContents([encode(contentText(600))], false);
      expect(await pdfHasActiveContent(bytes, undefined, { perStream: 300, totalContent: 1 << 30 })).toBe(true);
      expect(await pdfHasActiveContent(bytes, undefined, { perStream: 1 << 30, totalContent: 300 })).toBe(true);
      expect(await pdfHasActiveContent(bytes)).toBe(false);
    });

    // 200 000 zero bytes deflate to a couple of hundred bytes; twice over, the stage in the middle is that small too.
    const zeros = flateBytes(new Uint8Array(200_000));
    const lazyChain = flateWithBadTail(zeros);
    const lowCaps = { perStream: 1000, totalContent: 1000 };

    it('bounds a [Flate Flate] chain whose inner stage fails after the outer one has what it needs (pdf-lib reads lazily)', async () => {
      const bytes = await pdfWithRawContents([{ bytes: lazyChain, filters: ['FlateDecode', 'FlateDecode'] }], false);
      expect(await pdfHasActiveContent(bytes, undefined, lowCaps)).toBe(true);
      expect(await pdfHasActiveContent(bytes, undefined, big)).toBe(false);
      const objStm = pdfWithObjectStreamBody(lazyChain, '[/FlateDecode /FlateDecode]');
      expect(await pdfHasActiveContent(objStm, undefined, lowCaps)).toBe(true);
    });

    it('charges a stream whose decode fails part-way, so failing streams add up against the total', async () => {
      // Each stream inflates its 500 bytes, then hits a bad block: the work was done, so it counts.
      const failing = () => ({ bytes: flateWithBadTail(contentText(500)), filters: ['FlateDecode'] });
      const bytes = await pdfWithPageContents([failing(), failing(), failing()], [[0], [1], [2]]);
      expect(await pdfHasActiveContent(bytes, undefined, { perStream: 1 << 30, totalContent: 1000 })).toBe(true);
      expect(await pdfHasActiveContent(bytes, undefined, big)).toBe(false);
      expect(await pdfHasActiveContent(bytes)).toBe(false);
    });

    it('charges what a chain inflated even when its last layer shrinks the output to nothing', async () => {
      // 600 spaces inflate in the Flate layer; ASCIIHex then skips the white space and outputs 0 bytes.
      const spaces = new TextEncoder().encode(`${' '.repeat(600)}>`);
      const shrinking = () => ({ bytes: flateBytes(spaces), filters: ['FlateDecode', 'ASCIIHexDecode'] });
      const caps = { perStream: 1 << 30, totalContent: 20_000 }; // one such stream asks for about 8300 bytes of buffers
      const one = await pdfWithPageContents([shrinking()], [[0]]);
      expect(await pdfHasActiveContent(one, undefined, caps)).toBe(false);
      const six = await pdfWithPageContents(Array.from({ length: 6 }, shrinking), [[0], [1], [2], [3], [4], [5]]);
      expect(await pdfHasActiveContent(six, undefined, caps)).toBe(true); // six add up, though each outputs nothing
      expect(await pdfHasActiveContent(six)).toBe(false);
    });

    it('counts the layers of a filter chain together (each layer keeps its whole output in memory)', async () => {
      // Stored (uncompressed) blocks: every layer of the chain is about as big as the 300-byte content.
      let layer = contentText(300);
      for (let i = 0; i < 6; i++) layer = storedFlateBytes(layer);
      const chain = await pdfWithRawContents([{ bytes: layer, filters: Array<string>(6).fill('FlateDecode') }], false);
      const single = await pdfWithRawContents([{ bytes: storedFlateBytes(contentText(300)), filters: ['FlateDecode'] }], false);
      const caps = { perStream: 1000, totalContent: 1 << 30 }; // no single layer comes near 1000, six together do
      expect(await pdfHasActiveContent(chain, undefined, caps)).toBe(true);
      expect(await pdfHasActiveContent(single, undefined, caps)).toBe(false);
      expect(await pdfHasActiveContent(chain, undefined, big)).toBe(false);
      expect(await pdfHasActiveContent(chain)).toBe(false);
    });

    it('counts every object stream against one total, not each against the per-stream cap alone', async () => {
      const three = pdfWithObjectStreams(3, 900); // each decodes to about 900 bytes: under perStream 1000, 2700 together
      const one = pdfWithObjectStreams(1, 900);
      const caps = { perStream: 1000, totalContent: 1500 };
      expect(await pdfHasActiveContent(three, undefined, caps)).toBe(true);
      expect(await pdfHasActiveContent(one, undefined, caps)).toBe(false);
      expect(await pdfHasActiveContent(three, undefined, big)).toBe(false);
      expect(await pdfHasActiveContent(three)).toBe(false);
    });

    it('keeps one running total for the whole file: pages add up, a stream shared by pages counts once', async () => {
      const stream = { bytes: flateBytes(contentText(200)), filters: ['FlateDecode'] };
      const other = { bytes: flateBytes(contentText(200)), filters: ['FlateDecode'] };
      const twoOwn = await pdfWithPageContents([stream, other], [[0], [1]]); // 400 together, each page only 200
      const shared = await pdfWithPageContents([stream], [[0], [0]]); // the same 200 bytes, read twice
      const caps = { perStream: 1 << 30, totalContent: 300 };
      expect(await pdfHasActiveContent(twoOwn, undefined, caps)).toBe(true);
      expect(await pdfHasActiveContent(shared, undefined, caps)).toBe(false);
      expect(await pdfHasActiveContent(shared, undefined, { perStream: 1 << 30, totalContent: 150 })).toBe(true);
      expect(await pdfHasActiveContent(twoOwn, undefined, big)).toBe(false);
      expect(await pdfHasActiveContent(twoOwn)).toBe(false);
    });

    it('still refuses an over-cap object stream when the file cannot be parsed to its end (no endobj)', async () => {
      const bomb = pdfWithObjectStreamBody(zeros, '/FlateDecode', false);
      expect(await pdfHasActiveContent(bomb, undefined, lowCaps)).toBe(true);
      expect(await pdfHasActiveContent(pdfWithObjectStreamBody(zeros, '/FlateDecode'), undefined, lowCaps)).toBe(true);
      // Under the cap the unparseable file is let through as before (the order flow handles it).
      expect(await pdfHasActiveContent(bomb, undefined, big)).toBe(false);
    });

    it('accepts, with the default caps, a pdf-lib default save with drawn text and every fixture', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([200, 200]);
      for (let i = 0; i < 10; i++) page.drawText(`line ${i}`, { x: 10, y: 10 + i * 12 });
      const saved = await doc.save();
      expect(await pdfHasActiveContent(saved)).toBe(false);
      for (const name of readdirSync(FIXTURES).filter((f) => f.endsWith('.pdf'))) {
        expect(await pdfHasActiveContent(fx(name)), name).toBe(false);
      }
    });
  });

  it('finds a script nested 70 levels deep (inside the depth bound)', async () => {
    expect(await pdfHasActiveContent(await pdfWithNestedJs(70))).toBe(true);
  });

  it('refuses a file nested past the depth bound instead of skipping the rest', async () => {
    expect(await pdfHasActiveContent(await pdfWithTooDeepJs())).toBe(true);
    expect(await checkUploadBytes(await pdfWithTooDeepJs())).toEqual({ ok: false, error: 'unsafe' });
  });

  it('finds a script in an earlier definition of an object number that a later one shadows', async () => {
    const bytes = pdfWithDuplicateObject();
    expect(await pdfHasActiveContent(bytes)).toBe(true);
    expect(await checkUploadBytes(bytes)).toEqual({ ok: false, error: 'unsafe' });
  });

  it('refuses a file with more nodes than the scan bound instead of accepting it unscanned', async () => {
    const padded = pdfWithPaddingBeforeJs(2000);
    expect(await pdfHasActiveContent(padded, 1000)).toBe(true); // the bound is reached before the script object
    expect(await pdfHasActiveContent(padded)).toBe(true); // well inside the default bound: the script is found
    // A padded but clean file inside the bound is accepted.
    const clean = new TextEncoder().encode(
      ['%PDF-1.7', `1 0 obj\n[${'[]'.repeat(2000)}]\nendobj`, '2 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj', '3 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj', '4 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 200 200] >>\nendobj', 'trailer\n<< /Size 5 /Root 2 0 R >>', '%%EOF', ''].join('\n'),
    );
    expect(await pdfHasActiveContent(clean)).toBe(false);
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
  it('strips the Arabic letter mark (U+061C) too', () => {
    expect(cleanOriginalName('a؜b.png')).toBe('ab.png');
  });

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
