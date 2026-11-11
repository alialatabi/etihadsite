/**
 * GOLDEN — server-side artwork normalisation (src/lib/design/normalise.server.ts, pixels.ts)
 * and the A4 sheet builder (src/lib/pdf/build-sheet.ts).
 *
 * Determinism:
 *  - buildSheetPdf() stamps `new Date()` into the PDF Info dictionary (CreationDate, and
 *    pdf-lib adds ModDate). pdf-lib saves with object streams, so that dictionary sits inside
 *    a DEFLATE-compressed stream and cannot be normalised with a text replace. The clock is
 *    therefore FROZEN (Date only) at 2026-11-10T09:00:00Z; with it the PDF bytes are
 *    byte-for-byte reproducible and their sha256 is pinned.
 *  - Clock-independent structural facts are pinned as well (decoded content stream,
 *    embedded XObjects, boxes), and one test proves that ONLY the dates depend on the clock.
 *  - Raster hashes depend on the installed sharp/libvips build (same machine = same bytes).
 *
 * Not covered: src/lib/design/decode.client.ts (needs a browser: canvas, createImageBitmap, pdfjs).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, type PDFObject, type PDFPage } from 'pdf-lib';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { normaliseArtwork, sniffKind, type NormaliseOutcome } from '@/lib/design/normalise.server';
import { ALPHA_THRESHOLD, alphaBoundingBox, fitWithin, hasAnyAlpha } from '@/lib/design/pixels';
import { computeLayout, layoutParamsFor } from '@/lib/layout';
import { buildSheetPdf } from '@/lib/pdf/build-sheet';
import type { LayoutResult, LayoutSettings, NormalisedArtwork, StickerSpec } from '@/lib/types';
import cases from '@/lib/__fixtures__/layout-cases.json';
import { canon, sha16, sha256, show } from './_util';

const FROZEN = new Date('2026-11-10T09:00:00.000Z');
const fx = (name: string) => new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', name)));

const FIXTURES = ['exif6-600x400.jpg', 'opaque-300x300.jpg', 'padded-400x400.png', 'cropbox-rot90.pdf', 'two-page.pdf', 'encrypted-marker.pdf'] as const;

const rect = (wMm: number, hMm: number, corners: 'sharp' | 'rounded' = 'sharp'): StickerSpec => ({ shape: 'rect', corners, widthUm: wMm * 1000, heightUm: hMm * 1000 });
const circle = (dMm: number): StickerSpec => ({ shape: 'circle', widthUm: dMm * 1000, heightUm: dMm * 1000 });
const custom = (wMm: number, hMm: number): StickerSpec => ({ shape: 'custom', widthUm: wMm * 1000, heightUm: hMm * 1000 });
const specText = (s: StickerSpec) => `${s.shape}${s.corners ? '/' + s.corners : ''} ${s.widthUm / 1000}x${s.heightUm / 1000}mm`;

async function describeOutcome(input: Uint8Array, r: NormaliseOutcome) {
  if (!r.ok) return { ok: false, error: r.error };
  if (r.artwork.kind === 'pdf') {
    return {
      ok: true,
      kind: r.kind,
      px: `${r.pxWidth}x${r.pxHeight}`,
      artwork: {
        kind: r.artwork.kind,
        box: r.artwork.box,
        rotate: r.artwork.rotate,
        pageCount: r.artwork.pageCount,
        bytesAreTheInput: r.artwork.bytes === input || sha256(r.artwork.bytes) === sha256(input),
        keys: Object.keys(r.artwork).join(','),
      },
    };
  }
  const meta = await sharp(r.artwork.bytes).metadata();
  const pixels = await sharp(r.artwork.bytes).ensureAlpha().raw().toBuffer();
  return {
    ok: true,
    kind: r.kind,
    px: `${r.pxWidth}x${r.pxHeight}`,
    artwork: {
      kind: r.artwork.kind,
      mime: r.artwork.mime,
      px: `${r.artwork.pxWidth}x${r.artwork.pxHeight}`,
      hasAlpha: r.artwork.hasAlpha,
      effectiveDpi: r.artwork.effectiveDpi,
      byteLength: r.artwork.bytes.byteLength,
      sha256: sha256(r.artwork.bytes),
      decoded: `${meta.format} ${meta.width}x${meta.height} channels=${meta.channels} space=${meta.space} orientation=${show(meta.orientation)} pixels=${sha16(pixels)}`,
      keys: Object.keys(r.artwork).join(','),
    },
  };
}

/* ───────────────────────── fixtures themselves ───────────────────────── */

describe('golden: fixture files', () => {
  it('bytes of tests/fixtures and src/lib/__fixtures__ are what these snapshots were recorded with', () => {
    const out: Record<string, string> = {};
    for (const name of FIXTURES) {
      const b = fx(name);
      out[name] = `${b.byteLength} bytes sha256=${sha256(b)} sniff=${show(sniffKind(b))}`;
    }
    out['layout-cases.json'] = `${(cases as unknown[]).length} cases sha256(canonical)=${sha256(canon(cases))}`;
    expect(out).toMatchSnapshot();
  });
});

describe('golden: sniffKind', () => {
  it('magic-byte table', () => {
    const b = (...xs: number[]) => new Uint8Array(xs);
    const table: [string, Uint8Array][] = [
      ['empty', b()],
      ['png full signature', b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
      ['png first 4 bytes + 4 other (still png)', b(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0)],
      ['png signature cut to 7 bytes', b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a)],
      ['jpeg 3 bytes', b(0xff, 0xd8, 0xff)],
      ['jpeg 2 bytes', b(0xff, 0xd8)],
      ['jpeg JFIF', b(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46)],
      ['pdf %PDF-', b(0x25, 0x50, 0x44, 0x46, 0x2d)],
      ['pdf %PDF without dash', b(0x25, 0x50, 0x44, 0x46, 0x20)],
      ['pdf with leading whitespace', b(0x0a, 0x25, 0x50, 0x44, 0x46, 0x2d)],
      ['gif', b(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0)],
      ['webp', b(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)],
      ['svg text', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
      ['zeros', new Uint8Array(16)],
    ];
    expect(table.map(([name, bytes]) => `${name} -> ${show(sniffKind(bytes))}`)).toMatchSnapshot();
  });
});

/* ───────────────────────── normaliseArtwork ───────────────────────── */

describe('golden: normaliseArtwork', () => {
  const Q = DEFAULT_SETTINGS.quality;
  type Opt = { targetDpi?: number; blockDpi?: number };
  const RUNS: [(typeof FIXTURES)[number], StickerSpec, Opt][] = [
    // EXIF-rotated JPEG (stored 600x400, displays 400x600)
    ['exif6-600x400.jpg', rect(40, 60), {}],
    ['exif6-600x400.jpg', rect(20, 30), {}],
    ['exif6-600x400.jpg', rect(20, 30, 'rounded'), {}],
    ['exif6-600x400.jpg', rect(60, 40), {}],
    ['exif6-600x400.jpg', circle(30), {}],
    ['exif6-600x400.jpg', circle(100), {}],
    ['exif6-600x400.jpg', custom(40, 60), {}],
    ['exif6-600x400.jpg', rect(141, 100), {}], // 72.06 dpi: just above the block threshold
    ['exif6-600x400.jpg', rect(142, 100), {}], // 71.55 dpi: blocked
    ['exif6-600x400.jpg', rect(142, 100), { blockDpi: 71 }],
    ['exif6-600x400.jpg', rect(20, 30), { targetDpi: 150 }],
    ['exif6-600x400.jpg', rect(20, 30), { targetDpi: 600 }],
    ['exif6-600x400.jpg', rect(10, 10), {}], // aspect mismatch: scale = max of the two ratios
    // Opaque JPEG
    ['opaque-300x300.jpg', rect(50, 50, 'rounded'), {}],
    ['opaque-300x300.jpg', rect(25, 25), {}],
    ['opaque-300x300.jpg', circle(30), {}],
    ['opaque-300x300.jpg', rect(100, 40, 'rounded'), {}],
    ['opaque-300x300.jpg', rect(120, 90), {}], // 63.5 dpi: blocked
    ['opaque-300x300.jpg', custom(50, 50), {}],
    // PNG with transparent padding (400x400, opaque 200x100 box inside)
    ['padded-400x400.png', rect(50, 50), {}],
    ['padded-400x400.png', rect(20, 20, 'rounded'), {}],
    ['padded-400x400.png', circle(30), {}],
    ['padded-400x400.png', custom(50, 25), {}],
    ['padded-400x400.png', custom(10, 5), {}],
    ['padded-400x400.png', custom(100, 50), {}], // 50.8 dpi after the trim: blocked
    ['padded-400x400.png', custom(100, 50), { blockDpi: 50 }],
    // PDFs: the spec and the DPI settings do not matter
    ['cropbox-rot90.pdf', rect(30, 40), {}],
    ['cropbox-rot90.pdf', custom(300, 300), { blockDpi: 2_400 }],
    ['two-page.pdf', rect(60, 30), {}],
    ['two-page.pdf', circle(30), {}],
    ['encrypted-marker.pdf', rect(30, 30), {}],
  ];

  it('fixtures x specs', async () => {
    const out: Record<string, unknown> = {};
    for (const [name, spec, opt] of RUNS) {
      const input = fx(name);
      const r = await normaliseArtwork(input, { spec, targetDpi: opt.targetDpi ?? Q.targetDpi, blockDpi: opt.blockDpi ?? Q.blockDpi });
      const key = `${name} | ${specText(spec)}${opt.targetDpi ? ` | targetDpi=${opt.targetDpi}` : ''}${opt.blockDpi ? ` | blockDpi=${opt.blockDpi}` : ''}`;
      out[key] = await describeOutcome(input, r);
    }
    expect(out).toMatchSnapshot();
  });

  it('bad inputs -> error codes', async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const png = fx('padded-400x400.png');
    const jpg = fx('opaque-300x300.jpg');
    const pdf = fx('two-page.pdf');
    const bad: [string, Uint8Array][] = [
      ['empty', new Uint8Array(0)],
      ['random bytes', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
      ['gif header', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0])],
      ['png signature + garbage', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])],
      ['png cut to 40 bytes', png.slice(0, 40)],
      ['png cut in half', png.slice(0, Math.floor(png.byteLength / 2))],
      ['jpeg marker + garbage', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])],
      ['jpeg cut to 100 bytes', jpg.slice(0, 100)],
      ['pdf header only', enc('%PDF-1.7\n')],
      ['pdf header + garbage', enc('%PDF-1.7\nthis is not a pdf at all\n%%EOF')],
      ['pdf cut to 200 bytes', pdf.slice(0, 200)],
      ['text file', enc('hello world')],
    ];
    const rows: string[] = [];
    for (const [name, bytes] of bad) {
      for (const spec of [rect(30, 30), custom(30, 30)]) {
        const r = await normaliseArtwork(bytes, { spec, targetDpi: Q.targetDpi, blockDpi: Q.blockDpi });
        rows.push(`${name} | ${spec.shape} -> ${r.ok ? `ok ${r.kind} ${r.pxWidth}x${r.pxHeight}` : r.error}`);
      }
    }
    expect(rows).toMatchSnapshot();
  });

  it('generated rasters: fully transparent, opaque-with-alpha-channel, semi-transparent edge, greyscale, 16-bit', async () => {
    const mk = (w: number, h: number, alpha: number) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 40, b: 40, alpha } } });
    const inputs: [string, Uint8Array][] = [
      ['png fully transparent 100x100', new Uint8Array(await mk(100, 100, 0).png().toBuffer())],
      ['png opaque but with an alpha channel 120x80', new Uint8Array(await mk(120, 80, 1).png().toBuffer())],
      [
        'png faint halo (alpha 8 = threshold) around a 60x40 core',
        new Uint8Array(
          await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 8 / 255 } } })
            .composite([{ input: await mk(60, 40, 1).png().toBuffer(), left: 10, top: 20 }])
            .png()
            .toBuffer(),
        ),
      ],
      ['png greyscale 90x90', new Uint8Array(await sharp({ create: { width: 90, height: 90, channels: 3, background: { r: 128, g: 128, b: 128 } } }).greyscale().png().toBuffer())],
      ['png 16-bit rgb 64x64', new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 200, b: 90 } } }).toColourspace('rgb16').png().toBuffer())],
      ['jpeg 1x1', new Uint8Array(await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toBuffer())],
    ];
    const out: Record<string, unknown> = {};
    for (const [name, bytes] of inputs) {
      for (const spec of [rect(10, 10), circle(10), custom(10, 10)]) {
        const r = await normaliseArtwork(bytes, { spec, targetDpi: 300, blockDpi: 1 });
        const d = await describeOutcome(bytes, r);
        // The INPUT is generated here, so only the facts that do not depend on its exact encoding are pinned.
        out[`${name} | ${spec.shape}`] = d.ok && 'artwork' in d && d.artwork && 'mime' in d.artwork ? { ok: true, kind: d.kind, px: d.px, mime: d.artwork.mime, outPx: d.artwork.px, hasAlpha: d.artwork.hasAlpha, effectiveDpi: d.artwork.effectiveDpi } : d;
      }
    }
    expect(out).toMatchSnapshot();
  });
});

describe('golden: pixels.ts', () => {
  /** RGBA buffer of w x h, alpha from the given function. */
  const rgba = (w: number, h: number, alpha: (x: number, y: number) => number) => {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[(y * w + x) * 4 + 3] = alpha(x, y);
    return data;
  };
  it('alphaBoundingBox / hasAnyAlpha / fitWithin', () => {
    const box = rgba(10, 8, (x, y) => (x >= 2 && x <= 6 && y >= 3 && y <= 4 ? 255 : 0));
    const faint = rgba(10, 8, (x, y) => (x === 9 && y === 7 ? 9 : x === 0 && y === 0 ? 8 : 0));
    const opaque = rgba(4, 4, () => 255);
    const almost = rgba(4, 4, (x, y) => (x === 3 && y === 3 ? 254 : 255));
    const empty = rgba(4, 4, () => 0);
    expect({
      ALPHA_THRESHOLD,
      alphaBoundingBox: {
        box: alphaBoundingBox(box, 10, 8, ALPHA_THRESHOLD),
        faintOnlyAbove8Counts: alphaBoundingBox(faint, 10, 8, ALPHA_THRESHOLD),
        faintThreshold7: alphaBoundingBox(faint, 10, 8, 7),
        opaque: alphaBoundingBox(opaque, 4, 4, ALPHA_THRESHOLD),
        empty: alphaBoundingBox(empty, 4, 4, ALPHA_THRESHOLD),
        threshold255: alphaBoundingBox(opaque, 4, 4, 255),
        zeroSize: alphaBoundingBox(new Uint8Array(0), 0, 0, ALPHA_THRESHOLD),
        clamped: alphaBoundingBox(new Uint8ClampedArray(box), 10, 8, ALPHA_THRESHOLD),
      },
      hasAnyAlpha: {
        opaque: hasAnyAlpha(opaque, 4, 4),
        almost: hasAnyAlpha(almost, 4, 4),
        almostOpaqueFrom254: hasAnyAlpha(almost, 4, 4, 254),
        empty: hasAnyAlpha(empty, 4, 4),
        zeroSize: hasAnyAlpha(new Uint8Array(0), 0, 0),
      },
      fitWithin: [
        [100, 50, 200],
        [200, 100, 200],
        [400, 100, 200],
        [100, 400, 200],
        [4_000, 3_000, 1_600],
        [3_001, 3_000, 1_600],
        [1_601, 1, 1_600],
        [5_000, 1, 100],
        [0, 0, 100],
        [333, 777, 100],
      ].map(([w, h, m]) => `${w}x${h} max ${m} -> ${canon(fitWithin(w, h, m))}`),
    }).toMatchSnapshot();
  });
});

/* ───────────────────────── buildSheetPdf ───────────────────────── */

function contentOf(page: PDFPage): string {
  const ctx = page.doc.context;
  const contents = page.node.Contents();
  if (!contents) return ''; // a page nothing was drawn on has no content stream at all
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];
  return streams
    .map((s) => {
      if (!(s instanceof PDFRawStream)) throw new Error('unexpected stream type');
      return Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
    })
    .join('\n');
}

const oneLine = (o: PDFObject | undefined): string | null => (o ? o.toString().replace(/\s+/g, ' ') : null);

/** Clock-independent facts about a built sheet. */
async function structure(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = doc.getPage(0);
  const ctx = doc.context;
  const stream = contentOf(page);
  const res = page.node.Resources() as PDFDict;
  const xo = res.lookup(PDFName.of('XObject'), PDFDict);
  const xobjects = xo.entries().map(([name, ref]) => {
    const obj = ctx.lookup(ref);
    if (!(obj instanceof PDFRawStream)) return `${name.toString()} -> not a stream`;
    const smaskRef = obj.dict.get(PDFName.of('SMask'));
    const smask = smaskRef ? ctx.lookup(smaskRef) : undefined;
    return (
      `${name.toString()} dict=${oneLine(obj.dict)} bytes=${obj.contents.byteLength} sha=${sha16(obj.contents)}` +
      (smask instanceof PDFRawStream ? ` | smask dict=${oneLine(smask.dict)} bytes=${smask.contents.byteLength} sha=${sha16(smask.contents)}` : '')
    );
  });
  const m = page.getMediaBox();
  const lines = stream.split('\n');
  return {
    header: Buffer.from(bytes.slice(0, 8)).toString('latin1'),
    pageCount: doc.getPageCount(),
    mediaBox: [m.x, m.y, m.width, m.height],
    otherBoxes: `Crop=${oneLine(page.node.CropBox())} Trim=${oneLine(page.node.TrimBox())} Bleed=${oneLine(page.node.BleedBox())} Art=${oneLine(page.node.ArtBox())}`,
    rotate: page.getRotation().angle,
    resourceKeys: res.keys().map((k) => k.toString()),
    xobjects,
    content: {
      length: stream.length,
      sha256: sha256(Buffer.from(stream, 'latin1')),
      doCount: (stream.match(/\sDo(\s|$)/g) ?? []).length,
      clipCount: (stream.match(/W\s+n/g) ?? []).length,
      saveRestore: `${(stream.match(/(^|\s)q(\s|$)/g) ?? []).length}/${(stream.match(/(^|\s)Q(\s|$)/g) ?? []).length}`,
      hasText: /\b(BT|ET|Tj|TJ)\b/.test(stream),
      lineCount: lines.length,
      firstDraw: lines.slice(0, lines.findIndex((l) => l.trim() === 'Q') + 1).slice(0, 16),
      lastLines: lines.slice(-4),
    },
    info: {
      title: doc.getTitle(),
      subject: doc.getSubject(),
      author: doc.getAuthor(),
      keywords: doc.getKeywords(),
      producer: doc.getProducer(),
      creator: doc.getCreator(),
    },
    indirectObjects: ctx.enumerateIndirectObjects().length,
  };
}

async function dates(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return { creationDate: doc.getCreationDate()?.toISOString(), modificationDate: doc.getModificationDate()?.toISOString() };
}

const D = DEFAULT_SETTINGS.layout;
const ROT: LayoutSettings = { ...D, allowRotate: true };
/**
 * Rotation on at the old 7 mm margin: cases 4 and 7 keep the mixed arrangement they were recorded with.
 * Cases 9 and 10 cover the default 3 mm margin where the dots decide the arrangement.
 */
const ROT7: LayoutSettings = { ...ROT, marginUm: 7_000 };

function layoutFor(spec: StickerSpec, settings: LayoutSettings): LayoutResult {
  const out = computeLayout(spec, layoutParamsFor(spec, settings));
  if (!out.ok) throw new Error(`layout failed: ${out.reason}`);
  return out.layout;
}

async function artworkFor(fixture: (typeof FIXTURES)[number], spec: StickerSpec): Promise<NormalisedArtwork> {
  const r = await normaliseArtwork(fx(fixture), { spec, targetDpi: DEFAULT_SETTINGS.quality.targetDpi, blockDpi: DEFAULT_SETTINGS.quality.blockDpi });
  if (!r.ok) throw new Error(`normalise failed: ${r.error}`);
  return r.artwork;
}

type Sheet = { name: string; fixture: (typeof FIXTURES)[number]; spec: StickerSpec; settings: LayoutSettings };
const SHEETS: Sheet[] = [
  { name: '1 circle 30mm, alpha PNG', fixture: 'padded-400x400.png', spec: circle(30), settings: D },
  { name: '2 rect rounded 50x50, JPEG (same aspect, no clip)', fixture: 'opaque-300x300.jpg', spec: rect(50, 50, 'rounded'), settings: D },
  { name: '3 rect sharp 120x90 rotated layout, EXIF JPEG (cover clip)', fixture: 'exif6-600x400.jpg', spec: rect(120, 90), settings: ROT },
  { name: '4 rect rounded 100x40 mixed-orientation layout, JPEG', fixture: 'opaque-300x300.jpg', spec: rect(100, 40, 'rounded'), settings: ROT7 },
  { name: '5 custom 50x25, trimmed alpha PNG', fixture: 'padded-400x400.png', spec: custom(50, 25), settings: D },
  { name: '6 rect sharp 30x40, vector PDF with CropBox and /Rotate 90', fixture: 'cropbox-rot90.pdf', spec: rect(30, 40), settings: D },
  { name: '7 rect rounded 100x50 mixed layout, vector PDF (page 1 of 2)', fixture: 'two-page.pdf', spec: rect(100, 50, 'rounded'), settings: ROT7 },
  { name: '8 circle 60mm, non-square EXIF JPEG (centre crop)', fixture: 'exif6-600x400.jpg', spec: circle(60), settings: D },
  { name: '9 rect sharp 51x58 at 3 mm, no rotation: top and bottom moved in past the dots (4x4), JPEG', fixture: 'opaque-300x300.jpg', spec: rect(51, 58), settings: D },
  { name: '10 rect sharp 100x40 at 3 mm, rotation on: mixed layout clear of the dots (13), JPEG', fixture: 'opaque-300x300.jpg', spec: rect(100, 40), settings: ROT },
];

const metaFor = (spec: StickerSpec, layout: LayoutResult) => ({
  displayNo: 'EP-261110-GD2N',
  // Same recipe as POST /api/orders.
  description: `${spec.shape} ${spec.widthUm / 1000}x${spec.heightUm / 1000}mm x${layout.countPerSheet}`,
});

describe('golden: buildSheetPdf', () => {
  beforeEach(() => {
    vi.setSystemTime(FROZEN);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const sheet of SHEETS) {
    it(sheet.name, async () => {
      const layout = layoutFor(sheet.spec, sheet.settings);
      const artwork = await artworkFor(sheet.fixture, sheet.spec);
      const input = { layout, artwork, meta: metaFor(sheet.spec, layout) };
      const first = await buildSheetPdf(input);
      const second = await buildSheetPdf(input);
      // Byte-level determinism under the frozen clock.
      expect(sha256(second.bytes)).toBe(sha256(first.bytes));
      expect(canon(second.report)).toBe(canon(first.report));

      const { placementsPt, ...report } = first.report;
      expect({
        layout: `n=${layout.countPerSheet} grid=${layout.cols}x${layout.rows} rotated=${layout.rotated} turned=${layout.turnedCount} cell=${layout.cell.widthUm}x${layout.cell.heightUm} clip=${layout.clip.kind}`,
        artwork: artwork.kind === 'raster' ? `${artwork.mime} ${artwork.pxWidth}x${artwork.pxHeight} alpha=${artwork.hasAlpha}` : `pdf box=${canon(artwork.box)} rotate=${artwork.rotate}`,
        report: {
          ...report,
          placementsPt: {
            count: placementsPt.length,
            sha256: sha256(canon(placementsPt)),
            first: placementsPt[0],
            second: placementsPt[1] ?? null,
            last: placementsPt[placementsPt.length - 1],
          },
          bytesMatchesLength: first.report.bytes === first.bytes.byteLength,
          keys: Object.keys(first.report).join(','),
        },
        pdfSha256AtFrozenClock: sha256(first.bytes),
        dates: await dates(first.bytes),
        structure: await structure(first.bytes),
      }).toMatchSnapshot();
    });
  }

  it('only the Info dates depend on the clock', async () => {
    const sheet = SHEETS[0];
    const layout = layoutFor(sheet.spec, sheet.settings);
    const artwork = await artworkFor(sheet.fixture, sheet.spec);
    const input = { layout, artwork, meta: metaFor(sheet.spec, layout) };
    const a = await buildSheetPdf(input);
    vi.setSystemTime(new Date('2027-03-04T05:06:07.000Z'));
    const b = await buildSheetPdf(input);
    expect({
      rawBytesDiffer: sha256(a.bytes) !== sha256(b.bytes),
      structureIdentical: canon(await structure(a.bytes)) === canon(await structure(b.bytes)),
      placementsIdentical: canon(a.report.placementsPt) === canon(b.report.placementsPt),
      datesA: await dates(a.bytes),
      datesB: await dates(b.bytes),
    }).toMatchSnapshot();
  });

  it('layouts from src/lib/__fixtures__/layout-cases.json with a fixed in-memory JPEG', async () => {
    type Case = { name: string; spec: StickerSpec; expected: { ok: boolean; layout?: LayoutResult } };
    const artwork = await artworkFor('opaque-300x300.jpg', rect(25, 25));
    const rows: string[] = [];
    for (const c of cases as Case[]) {
      if (!c.expected.layout) {
        rows.push(`${c.name} -> (no layout in fixture)`);
        continue;
      }
      const out = await buildSheetPdf({ layout: c.expected.layout, artwork, meta: { displayNo: 'EP-261110-GD2N', description: c.name } });
      const s = await structure(out.bytes);
      rows.push(
        `${c.name} -> draws=${out.report.drawCount} clipped=${out.report.clipped} bytes=${out.report.bytes} placements=${sha16(canon(out.report.placementsPt))}` +
          ` content=${s.content.length}:${s.content.sha256.slice(0, 16)} clips=${s.content.clipCount} pdf=${sha16(out.bytes)}`,
      );
    }
    expect(rows).toMatchSnapshot();
  });

  it('empty layout (no placements) still produces a one-page PDF', async () => {
    const layout: LayoutResult = { ...layoutFor(circle(30), D), placements: [], countPerSheet: 0 };
    const out = await buildSheetPdf({ layout, artwork: await artworkFor('opaque-300x300.jpg', circle(30)), meta: { displayNo: '', description: '' } });
    const s = await structure(out.bytes);
    expect({ report: out.report, pageCount: s.pageCount, content: s.content, xobjects: s.xobjects.length, info: s.info, pdfSha256AtFrozenClock: sha256(out.bytes) }).toMatchSnapshot();
  });
});
