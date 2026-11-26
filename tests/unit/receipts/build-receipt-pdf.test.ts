/**
 * The receipt sheet PDF (src/lib/pdf/build-receipt-pdf.ts). The content stream is read back with
 * pdfjs (operator list, ctm composition): per slot one clip rectangle equal to the owner's table
 * (±0.01 mm), the image / form covering exactly that rectangle, a turned design mapping its top
 * edge to the side the turn says, and the artwork embedded once.
 */
import sharp from 'sharp';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { buildReceiptPdf } from '@/lib/pdf/build-receipt-pdf';
import { RECEIPT_FORMAT_IDS, defaultSpacing, receiptSlots, type ReceiptFormat, type ReceiptSlot, type ReceiptSpacing, type ReceiptWhite } from '@/lib/receipts/formats';
import { A4_PT, umToPt } from '@/lib/units';
import type { NormalisedArtwork } from '@/lib/types';

const NOW = new Date('2026-11-26T10:00:00.000Z');
const TOL_PT = umToPt(10); // 0.01 mm

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** Apply `m1` first, then `m2` (PDF row-vector convention). */
const mul = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[1] * m2[2],
  m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2],
  m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
  m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

interface Drawn {
  /** Clip rectangle (pt, y up): x0, y0, x1, y1. */
  clip: [number, number, number, number];
  /** The four corners of the drawn object (unit square or form bbox) in page space: bl, br, tl, tr of the object's own space. */
  corners: { bl: [number, number]; br: [number, number]; tl: [number, number]; tr: [number, number] };
  kind: 'image' | 'form';
  ctm: Matrix;
}

/** Walks the operator list of page 1 and returns one entry per drawn artwork. */
async function dump(bytes: Uint8Array): Promise<{ drawn: Drawn[]; pageW: number; pageH: number }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const [x0, y0, x1, y1] = page.view;
  const ops = await page.getOperatorList();
  const OPS = pdfjs.OPS;
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  let clip: Drawn['clip'] | null = null;
  const drawn: Drawn[] = [];
  const corners = (m: Matrix, w: number, h: number, ox = 0, oy = 0) => ({
    bl: apply(m, ox, oy),
    br: apply(m, ox + w, oy),
    tl: apply(m, ox, oy + h),
    tr: apply(m, ox + w, oy + h),
  });
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i] as unknown[] | null;
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) {
      ctm = stack.pop() ?? IDENTITY;
      clip = null;
    } else if (fn === OPS.transform) ctm = mul(args as unknown as Matrix, ctm);
    else if (fn === OPS.constructPath && args && args[0] === OPS.endPath) {
      const mm = args[2] as ArrayLike<number>;
      clip = [mm[0], mm[1], mm[2], mm[3]];
    } else if (fn === OPS.paintImageXObject) {
      if (!clip) throw new Error('image drawn without a clip');
      drawn.push({ clip, corners: corners(ctm, 1, 1), kind: 'image', ctm });
    } else if (fn === OPS.paintFormXObjectBegin) {
      if (!clip) throw new Error('form drawn without a clip');
      const [matrix, bbox] = args as unknown as [Matrix, [number, number, number, number]];
      const full = mul(matrix, ctm);
      drawn.push({ clip, corners: corners(full, bbox[2] - bbox[0], bbox[3] - bbox[1], bbox[0], bbox[1]), kind: 'form', ctm: full });
      // pdfjs replays the form's own content here; it keeps its own save/restore balance.
    }
  });
  return { drawn, pageW: x1 - x0, pageH: y1 - y0 };
}

const rectPt = (s: ReceiptSlot, pageH: number) => ({ x0: umToPt(s.xUm), y0: pageH - umToPt(s.yUm + s.heightUm), x1: umToPt(s.xUm + s.widthUm), y1: pageH - umToPt(s.yUm) });

/** Bounding box of an object's four corners. */
function bounds(c: Drawn['corners']) {
  const xs = [c.bl[0], c.br[0], c.tl[0], c.tr[0]];
  const ys = [c.bl[1], c.br[1], c.tl[1], c.tr[1]];
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

async function rasterArt(w: number, h: number, mime: 'image/jpeg' | 'image/png' = 'image/jpeg'): Promise<Extract<NormalisedArtwork, { kind: 'raster' }>> {
  const img = sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 40 } } });
  const bytes = mime === 'image/png' ? await img.png().toBuffer() : await img.jpeg({ quality: 90 }).toBuffer();
  return { kind: 'raster', bytes: new Uint8Array(bytes), mime, pxWidth: w, pxHeight: h, hasAlpha: false, effectiveDpi: 300 };
}

/** A vector PDF page (200 x 100 pt, content box offset by 20/10) made with pdf-lib. */
async function vectorArt(rotate: 0 | 90 | 180 | 270 = 0): Promise<Extract<NormalisedArtwork, { kind: 'pdf' }>> {
  const src = await PDFDocument.create();
  const page = src.addPage([300, 200]);
  page.drawRectangle({ x: 20, y: 10, width: 200, height: 100 });
  const bytes = await src.save();
  return { kind: 'pdf', bytes, box: { x: 20, y: 10, width: 200, height: 100 }, rotate, pageCount: 1 };
}

function expectCoversSlots(d: { drawn: Drawn[]; pageH: number }, format: ReceiptFormat, white: ReceiptWhite) {
  const slots = receiptSlots(format, defaultSpacing(format, white));
  expect(d.drawn).toHaveLength(slots.length);
  slots.forEach((slot, i) => {
    const want = rectPt(slot, d.pageH);
    const got = d.drawn[i];
    expect(Math.abs(got.clip[0] - want.x0)).toBeLessThan(TOL_PT);
    expect(Math.abs(got.clip[1] - want.y0)).toBeLessThan(TOL_PT);
    expect(Math.abs(got.clip[2] - want.x1)).toBeLessThan(TOL_PT);
    expect(Math.abs(got.clip[3] - want.y1)).toBeLessThan(TOL_PT);
    const b = bounds(got.corners);
    expect(Math.abs(b.x0 - want.x0)).toBeLessThan(TOL_PT);
    expect(Math.abs(b.y0 - want.y0)).toBeLessThan(TOL_PT);
    expect(Math.abs(b.x1 - want.x1)).toBeLessThan(TOL_PT);
    expect(Math.abs(b.y1 - want.y1)).toBeLessThan(TOL_PT);
  });
}

const CASES: { format: ReceiptFormat; white: ReceiptWhite }[] = [
  ...RECEIPT_FORMAT_IDS.filter((f) => f !== 'a6').map((format) => ({ format, white: 'top' as const })),
  { format: 'a6', white: 'top' },
  { format: 'a6', white: 'bottom' },
];

describe('buildReceiptPdf: clip rectangles and coverage', () => {
  for (const { format, white } of CASES) {
    for (const turnCw of [0, 270]) {
      it(`${format}${format === 'a6' ? ` (white ${white})` : ''}, turn ${turnCw}: raster fills every slot exactly`, async () => {
        const bytes = await buildReceiptPdf({ format, spacing: defaultSpacing(format, white), turnCw, artwork: await rasterArt(40, 20) }, NOW);
        const d = await dump(bytes);
        expect(d.pageW).toBeCloseTo(A4_PT.widthPt, 3);
        expect(d.pageH).toBeCloseTo(A4_PT.heightPt, 3);
        expect(d.drawn.every((x) => x.kind === 'image')).toBe(true);
        expectCoversSlots(d, format, white);
      });
      it(`${format}${format === 'a6' ? ` (white ${white})` : ''}, turn ${turnCw}: vector page fills every slot exactly`, async () => {
        const bytes = await buildReceiptPdf({ format, spacing: defaultSpacing(format, white), turnCw, artwork: await vectorArt() }, NOW);
        const d = await dump(bytes);
        expect(d.drawn.every((x) => x.kind === 'form')).toBe(true);
        expectCoversSlots(d, format, white);
      });
    }
  }

  it('a PNG artwork works the same way', async () => {
    const bytes = await buildReceiptPdf({ format: 'dl', spacing: defaultSpacing('dl', 'top'), turnCw: 0, artwork: await rasterArt(60, 30, 'image/png') }, NOW);
    expectCoversSlots(await dump(bytes), 'dl', 'top');
  });

  it('stretches to fill: a 4:1 design in a 1.35:1 slot is not proportion-kept', async () => {
    const bytes = await buildReceiptPdf({ format: 'a4', spacing: defaultSpacing('a4', 'top'), turnCw: 0, artwork: await rasterArt(400, 100) }, NOW);
    expectCoversSlots(await dump(bytes), 'a4', 'top');
  });
});

describe('buildReceiptPdf: turns', () => {
  const slot = receiptSlots('a5', defaultSpacing('a5'))[0];
  const sheet = () => rectPt(slot, A4_PT.heightPt);

  async function one(artwork: NormalisedArtwork, turnCw: number) {
    const d = await dump(await buildReceiptPdf({ format: 'a5', spacing: defaultSpacing('a5', 'top'), turnCw, artwork }, NOW));
    return d.drawn[0];
  }
  /** Where the design's top edge ended up: the x / y shared by both top corners. */
  const topEdge = (d: Drawn) => ({ x: [d.corners.tl[0], d.corners.tr[0]], y: [d.corners.tl[1], d.corners.tr[1]] });

  it('turn 0: the top edge is the slot top', async () => {
    const d = await one(await rasterArt(40, 20), 0);
    const e = topEdge(d);
    for (const y of e.y) expect(Math.abs(y - sheet().y1)).toBeLessThan(TOL_PT);
  });
  it('turn 270 (counter-clockwise): the top edge is the slot left', async () => {
    const d = await one(await rasterArt(20, 40), 270);
    for (const x of topEdge(d).x) expect(Math.abs(x - sheet().x0)).toBeLessThan(TOL_PT);
  });
  it('turn 90 (clockwise): the top edge is the slot right', async () => {
    const d = await one(await rasterArt(20, 40), 90);
    for (const x of topEdge(d).x) expect(Math.abs(x - sheet().x1)).toBeLessThan(TOL_PT);
  });
  it('turn 180: the top edge is the slot bottom', async () => {
    const d = await one(await rasterArt(40, 20), 180);
    for (const y of topEdge(d).y) expect(Math.abs(y - sheet().y0)).toBeLessThan(TOL_PT);
  });
  it('the left edge of a turned design follows: turn 270 puts the left edge at the slot bottom', async () => {
    const d = await one(await rasterArt(20, 40), 270);
    for (const y of [d.corners.bl[1], d.corners.tl[1]]) expect(Math.abs(y - sheet().y0)).toBeLessThan(TOL_PT);
  });
  it('a vector page turned 270 maps its top edge to the slot left too', async () => {
    const d = await one(await vectorArt(), 270);
    for (const x of topEdge(d).x) expect(Math.abs(x - sheet().x0)).toBeLessThan(TOL_PT);
  });
  it('the PDF page /Rotate adds to the card turn: rotate 90 + turn 180 = rotate 0 + turn 270', async () => {
    const a = await one(await vectorArt(90), 180);
    const b = await one(await vectorArt(0), 270);
    a.ctm.forEach((v, i) => expect(v).toBeCloseTo(b.ctm[i], 6));
    const c = await one(await vectorArt(270), 360);
    c.ctm.forEach((v, i) => expect(v).toBeCloseTo(b.ctm[i], 6));
  });
  it('a turn beyond 360 or negative is taken modulo 360', async () => {
    const a = await one(await rasterArt(20, 40), 270);
    const b = await one(await rasterArt(20, 40), -90);
    const c = await one(await rasterArt(20, 40), 630);
    for (const m of [b, c]) m.ctm.forEach((v, i) => expect(v).toBeCloseTo(a.ctm[i], 6));
  });
});

describe('buildReceiptPdf: custom spacing', () => {
  const CUSTOM: { name: string; format: ReceiptFormat; spacing: ReceiptSpacing }[] = [
    { name: 'a5, left 10 mm, gap 5 mm', format: 'a5', spacing: { ...defaultSpacing('a5'), leftUm: 10_000, gapYUm: 5_000 } },
    { name: 'a6, no gaps', format: 'a6', spacing: { ...defaultSpacing('a6'), gapXUm: 0, gapYUm: 0 } },
    { name: 'a6, odd margins on every side', format: 'a6', spacing: { topUm: 3_500, rightUm: 2_250, bottomUm: 11_000, leftUm: 4_001, gapXUm: 1_234, gapYUm: 5_678 } },
    { name: 'dl, 5 mm top and bottom', format: 'dl', spacing: { ...defaultSpacing('dl'), topUm: 5_000, bottomUm: 5_000 } },
    { name: 'a4, margins on all four sides', format: 'a4', spacing: { topUm: 8_000, rightUm: 6_000, bottomUm: 9_000, leftUm: 7_000, gapXUm: 0, gapYUm: 0 } },
  ];
  for (const { name, format, spacing } of CUSTOM) {
    for (const turnCw of [0, 270]) {
      it(`${name}, turn ${turnCw}: clip rects and the drawn art equal the slots (raster and vector)`, async () => {
        for (const artwork of [await rasterArt(40, 20), await vectorArt()]) {
          const d = await dump(await buildReceiptPdf({ format, spacing, turnCw, artwork }, NOW));
          const slots = receiptSlots(format, spacing);
          expect(d.drawn).toHaveLength(slots.length);
          slots.forEach((slot, i) => {
            const want = rectPt(slot, d.pageH);
            const got = d.drawn[i];
            expect(Math.abs(got.clip[0] - want.x0)).toBeLessThan(TOL_PT);
            expect(Math.abs(got.clip[1] - want.y0)).toBeLessThan(TOL_PT);
            expect(Math.abs(got.clip[2] - want.x1)).toBeLessThan(TOL_PT);
            expect(Math.abs(got.clip[3] - want.y1)).toBeLessThan(TOL_PT);
            const b = bounds(got.corners);
            expect(Math.abs(b.x0 - want.x0)).toBeLessThan(TOL_PT);
            expect(Math.abs(b.y0 - want.y0)).toBeLessThan(TOL_PT);
            expect(Math.abs(b.x1 - want.x1)).toBeLessThan(TOL_PT);
            expect(Math.abs(b.y1 - want.y1)).toBeLessThan(TOL_PT);
          });
        }
      });
    }
  }

  it('the default spacing gives the live numbers (a6, white bottom)', async () => {
    const d = await dump(await buildReceiptPdf({ format: 'a6', spacing: defaultSpacing('a6', 'bottom'), turnCw: 0, artwork: await rasterArt(40, 20) }, NOW));
    expect(d.drawn).toHaveLength(4);
    const want = receiptSlots('a6', defaultSpacing('a6', 'bottom'));
    expect(want.map((s) => s.yUm)).toEqual([0, 0, 148_680, 148_680]);
    d.drawn.forEach((x, i) => expect(Math.abs(x.clip[3] - rectPt(want[i], d.pageH).y1)).toBeLessThan(TOL_PT));
  });

  it('spacing that does not fit is refused, not printed', async () => {
    const artwork = await rasterArt(40, 20);
    const noRoom: ReceiptSpacing = { ...defaultSpacing('a4'), leftUm: 100_000, rightUm: 95_000 };
    await expect(buildReceiptPdf({ format: 'a4', spacing: noRoom, turnCw: 0, artwork }, NOW)).rejects.toThrow();
    await expect(buildReceiptPdf({ format: 'a4', spacing: { ...defaultSpacing('a4'), topUm: -1 }, turnCw: 0, artwork }, NOW)).rejects.toThrow();
    await expect(buildReceiptPdf({ format: 'a4', spacing: { ...defaultSpacing('a4'), topUm: 100_001 }, turnCw: 0, artwork }, NOW)).rejects.toThrow();
  });
});

describe('buildReceiptPdf: one embedded object, metadata', () => {
  async function objects(bytes: Uint8Array, subtype: string) {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return doc.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype'))?.toString() === subtype);
  }

  it('the raster is embedded once for 4 slots, with the uploaded bytes (DCT) and size', async () => {
    const art = await rasterArt(40, 20);
    const bytes = await buildReceiptPdf({ format: 'a6', spacing: defaultSpacing('a6', 'top'), turnCw: 0, artwork: art }, NOW);
    const images = await objects(bytes, '/Image');
    expect(images).toHaveLength(1);
    expect(images[0].dict.get(PDFName.of('Filter'))?.toString()).toBe('/DCTDecode');
    expect(images[0].dict.get(PDFName.of('Width'))?.toString()).toBe('40');
    expect(images[0].dict.get(PDFName.of('Height'))?.toString()).toBe('20');
    expect(Buffer.from(images[0].contents).equals(Buffer.from(art.bytes))).toBe(true);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const xo = (doc.getPage(0).node.Resources() as PDFDict).lookup(PDFName.of('XObject'), PDFDict);
    expect(xo.keys()).toHaveLength(1);
  });
  it('the vector page is embedded once for 3 slots', async () => {
    const bytes = await buildReceiptPdf({ format: 'dl', spacing: defaultSpacing('dl', 'top'), turnCw: 0, artwork: await vectorArt() }, NOW);
    expect(await objects(bytes, '/Form')).toHaveLength(1);
    expect(await objects(bytes, '/Image')).toHaveLength(0);
  });
  it('one A4 page, title, producer and creator, dated now, print at actual size', async () => {
    const bytes = await buildReceiptPdf({ format: 'a5', spacing: defaultSpacing('a5', 'top'), turnCw: 0, artwork: await rasterArt(40, 20) }, NOW);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Softy receipts');
    expect(doc.getProducer()).toBe('Softy Printing');
    expect(doc.getCreator()).toBe('Softy Printing');
    expect(doc.getCreationDate()?.toISOString()).toBe(NOW.toISOString());
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.catalog.lookup(PDFName.of('ViewerPreferences'), PDFDict).get(PDFName.of('PrintScaling'))?.toString()).toBe('/None');
  });
  it('is deterministic for the same input and date', async () => {
    const artwork = await rasterArt(40, 20);
    const a = await buildReceiptPdf({ format: 'a6', spacing: defaultSpacing('a6', 'bottom'), turnCw: 270, artwork }, NOW);
    const b = await buildReceiptPdf({ format: 'a6', spacing: defaultSpacing('a6', 'bottom'), turnCw: 270, artwork }, NOW);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
