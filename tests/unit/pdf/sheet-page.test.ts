/**
 * The isomorphic sheet-page drawer (src/lib/pdf/sheet-page.ts): the 4 cutter dots in the
 * `sk_marks` optional-content layer, the rounded-corner clip, and the print-scaling entry.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  PDFHexString,
  decodePDFRawStream,
  type PDFPage,
} from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { computeLayout, layoutParamsFor } from '@/lib/layout';
import { buildSheetPdf } from '@/lib/pdf/build-sheet';
import { drawSheetPage, setPrintAtActualSize } from '@/lib/pdf/sheet-page';
import type { LayoutResult, LayoutSettings, NormalisedArtwork, StickerSpec } from '@/lib/types';
import cases from '@/lib/__fixtures__/layout-cases.json';

const SETTINGS: LayoutSettings = { ...DEFAULT_SETTINGS.layout, marginUm: 3_000 };

function layoutFor(spec: StickerSpec, settings: LayoutSettings = SETTINGS): LayoutResult {
  const out = computeLayout(spec, layoutParamsFor(spec, settings));
  if (!out.ok) throw new Error(`layout failed: ${out.reason}`);
  return out.layout;
}

type Case = { name: string; spec: StickerSpec; expected: { ok: boolean; layout?: LayoutResult } };
const fixtureLayout = (prefix: string): LayoutResult => {
  const c = (cases as Case[]).find((x) => x.name.startsWith(prefix));
  if (!c?.expected.layout) throw new Error('missing fixture ' + prefix);
  return c.expected.layout;
};

async function raster(w: number, h: number, alpha = false): Promise<NormalisedArtwork> {
  const img = sharp({ create: { width: w, height: h, channels: 4, background: { r: 30, g: 120, b: 220, alpha: 1 } } });
  const bytes = alpha ? await img.png().toBuffer() : await img.flatten().jpeg({ quality: 90 }).toBuffer();
  return { kind: 'raster', bytes: new Uint8Array(bytes), mime: alpha ? 'image/png' : 'image/jpeg', pxWidth: w, pxHeight: h, hasAlpha: alpha, effectiveDpi: 300 };
}

function contentOf(page: PDFPage): string {
  const ctx = page.doc.context;
  const contents = page.node.Contents();
  if (!contents) return '';
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];
  return streams
    .map((s) => {
      if (!(s instanceof PDFRawStream)) throw new Error('unexpected stream type');
      return Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
    })
    .join('\n');
}

/** Operator tokens only (no operands): letters, plus `f*`. */
const operatorsOf = (stream: string): string[] => stream.split(/\s+/).filter((t) => /^([A-Za-z]+|f\*)$/.test(t));

const nameText = (o: unknown): string | undefined =>
  o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined;

/** The dots block(s): `/OC /<prop> BDC … EMC`, with the property's OCG name. */
function marksBlocks(page: PDFPage): { prop: string; ocgName: string | undefined; body: string }[] {
  const stream = contentOf(page);
  const out: { prop: string; ocgName: string | undefined; body: string }[] = [];
  const props = (page.node.Resources() as PDFDict).lookupMaybe(PDFName.of('Properties'), PDFDict);
  for (const m of stream.matchAll(/\/OC \/(\S+) BDC([\s\S]*?)EMC/g)) {
    const ref = props?.get(PDFName.of(m[1]));
    const ocg = ref instanceof PDFRef ? page.doc.context.lookup(ref, PDFDict) : undefined;
    out.push({ prop: m[1], ocgName: nameText(ocg?.get(PDFName.of('Name'))), body: m[2] });
  }
  return out;
}

/** Circles in a path built by circlePath(): `cx+r cy m`, then 4 curves; centre and radius from the m point and the 2nd curve end. */
function circlesIn(body: string): { cx: number; cy: number; r: number }[] {
  const out: { cx: number; cy: number; r: number }[] = [];
  const re = /([-\d.e]+) ([-\d.e]+) m\s+(?:[-\d.e]+ ){4}([-\d.e]+) ([-\d.e]+) c\s+(?:[-\d.e]+ ){4}([-\d.e]+) ([-\d.e]+) c\s+(?:[-\d.e]+ ){4}[-\d.e]+ [-\d.e]+ c\s+(?:[-\d.e]+ ){4}[-\d.e]+ [-\d.e]+ c\s+h/g;
  for (const m of body.matchAll(re)) {
    const [x0, y0, , , x2, y2] = m.slice(1, 7).map(Number);
    out.push({ cx: (x0 + x2) / 2, cy: (y0 + y2) / 2, r: (x0 - x2) / 2 });
  }
  return out;
}

async function onePage(layout: LayoutResult, artwork: NormalisedArtwork) {
  const doc = await PDFDocument.create();
  const result = await drawSheetPage(doc, layout, artwork);
  const bytes = await doc.save();
  const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
  return { result, doc: loaded, page: loaded.getPage(0), stream: contentOf(loaded.getPage(0)) };
}

const EXPECTED_CENTRES = [
  [19.8425, 822.0473],
  [575.4331, 822.0473],
  [19.8425, 19.8425],
  [575.4331, 19.8425],
];

describe('drawSheetPage', () => {
  let jpg: NormalisedArtwork;
  beforeAll(async () => {
    jpg = await raster(300, 300);
  });

  it('draws the 4 dots once, in the sk_marks layer, K black, even-odd fill, at 7 mm from the edges, 5 mm wide', async () => {
    const layout = layoutFor({ shape: 'circle', widthUm: 58_000, heightUm: 58_000 });
    expect(layout.marks?.centres).toHaveLength(4);
    const { page, doc, stream } = await onePage(layout, jpg);
    const blocks = marksBlocks(page);
    expect(blocks).toHaveLength(1);
    expect((stream.match(/BDC/g) ?? []).length).toBe(1);
    expect(blocks[0].ocgName).toBe('sk_marks');
    expect(blocks[0].body).toContain('0 0 0 1 k');
    expect(blocks[0].body).toMatch(/\sf\*\s*$/);
    // The block sits after every sticker, inside its own q … Q.
    expect(stream.lastIndexOf(' Do')).toBeLessThan(stream.indexOf('BDC'));
    expect(operatorsOf(stream).slice(-30)).toEqual(['q', 'BDC', 'k', ...Array.from({ length: 4 }, () => ['m', 'c', 'c', 'c', 'c', 'h']).flat(), 'f*', 'EMC', 'Q']);

    const circles = circlesIn(blocks[0].body);
    expect(circles).toHaveLength(4);
    circles.forEach((c, i) => {
      expect(Math.abs(c.cx - EXPECTED_CENTRES[i][0])).toBeLessThan(0.001);
      expect(Math.abs(c.cy - EXPECTED_CENTRES[i][1])).toBeLessThan(0.001);
      expect(Math.abs(c.r - 7.0866)).toBeLessThan(0.001);
    });

    const ocProps = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict);
    const ocgs = ocProps.lookup(PDFName.of('OCGs'), PDFArray);
    expect(ocgs.size()).toBe(1);
    const ocg = doc.context.lookup(ocgs.get(0), PDFDict);
    expect(ocg.get(PDFName.of('Type'))?.toString()).toBe('/OCG');
    expect(nameText(ocg.get(PDFName.of('Name')))).toBe('sk_marks');
    const d = ocProps.lookup(PDFName.of('D'), PDFDict);
    expect(d.lookup(PDFName.of('ON'), PDFArray).get(0).toString()).toBe(ocgs.get(0).toString());
    expect(d.lookup(PDFName.of('Order'), PDFArray).get(0).toString()).toBe(ocgs.get(0).toString());
  });

  it('drawCount and placementsPt count the stickers only (dots are paths, not XObject draws)', async () => {
    const layout = layoutFor({ shape: 'circle', widthUm: 58_000, heightUm: 58_000 });
    expect(layout.countPerSheet).toBe(15);
    const { result, stream } = await onePage(layout, jpg);
    expect(result.drawCount).toBe(layout.countPerSheet);
    expect(result.placementsPt).toHaveLength(layout.countPerSheet);
    expect((stream.match(/\sDo(\s|$)/g) ?? []).length).toBe(layout.countPerSheet);
    expect(result.clipped).toBe(true);
  });

  it('roundedRect cells are clipped to a rounded rectangle (lines + Bezier corners, then W n)', async () => {
    const layout = layoutFor({ shape: 'rect', corners: 'rounded', widthUm: 50_000, heightUm: 50_000 });
    expect(layout.clip).toEqual({ kind: 'roundedRect', radiusUm: 3_000 });
    const { result, stream } = await onePage(layout, await raster(500, 500, true));
    expect(result.clipped).toBe(true);
    const ops = operatorsOf(stream);
    const perCell = ['q', 'm', 'l', 'c', 'l', 'c', 'l', 'c', 'l', 'c', 'h', 'W', 'n', 'cm', 'Do', 'Q'];
    expect(ops.slice(0, perCell.length * layout.countPerSheet)).toEqual(Array.from({ length: layout.countPerSheet }, () => perCell).flat());
    // The first cell's clip: starts radius in from the corner, curve ends on the next side.
    const first = result.placementsPt[0];
    const r = (3_000 / 25_400) * 72;
    const m = /([-\d.e]+) ([-\d.e]+) m\s+([-\d.e]+) ([-\d.e]+) l\s+(?:[-\d.e]+ ){4}([-\d.e]+) ([-\d.e]+) c/.exec(stream);
    expect(m).not.toBeNull();
    const [mx, my, lx, ly, cx, cy] = m!.slice(1, 7).map(Number);
    expect(mx).toBeCloseTo(first.x + r, 6);
    expect(my).toBeCloseTo(first.y, 6);
    expect(lx).toBeCloseTo(first.x + first.w - r, 6);
    expect(ly).toBeCloseTo(first.y, 6);
    expect(cx).toBeCloseTo(first.x + first.w, 6);
    expect(cy).toBeCloseTo(first.y + r, 6);
  });

  it('roundedRect radius is capped at half the shorter side', async () => {
    const base = fixtureLayout('rect-rounded-50x50');
    const layout: LayoutResult = { ...base, clip: { kind: 'roundedRect', radiusUm: 1_000_000 } };
    const { result, stream } = await onePage(layout, await raster(500, 500));
    const first = result.placementsPt[0];
    const m = /([-\d.e]+) ([-\d.e]+) m\s+([-\d.e]+) ([-\d.e]+) l/.exec(stream);
    const [mx, , lx] = m!.slice(1, 4).map(Number);
    expect(mx).toBeCloseTo(first.x + first.w / 2, 6);
    expect(lx).toBeCloseTo(first.x + first.w / 2, 6);
  });

  it('circle and none cells keep their operators; the dots come after them', async () => {
    const circle = layoutFor({ shape: 'circle', widthUm: 30_000, heightUm: 30_000 });
    const sharp = layoutFor({ shape: 'rect', corners: 'sharp', widthUm: 50_000, heightUm: 50_000 });
    const dots = ['q', 'BDC', 'k', ...Array.from({ length: 4 }, () => ['m', 'c', 'c', 'c', 'c', 'h']).flat(), 'f*', 'EMC', 'Q'];
    const c = await onePage(circle, jpg);
    expect(operatorsOf(c.stream)).toEqual([...Array.from({ length: circle.countPerSheet }, () => ['q', 'm', 'c', 'c', 'c', 'c', 'h', 'W', 'n', 'cm', 'Do', 'Q']).flat(), ...dots]);
    const s = await onePage(sharp, await raster(500, 500));
    expect(operatorsOf(s.stream)).toEqual([...Array.from({ length: sharp.countPerSheet }, () => ['q', 'cm', 'Do', 'Q']).flat(), ...dots]);
    expect(s.result.clipped).toBe(false);
  });

  it('a layout without marks has no dots block and no /OCProperties', async () => {
    const layout = fixtureLayout('circle-30mm-gapX2-gapY0');
    expect(layout.marks).toBeUndefined();
    const { page, doc, stream } = await onePage(layout, jpg);
    expect(stream).not.toMatch(/BDC|EMC|f\*/);
    expect(marksBlocks(page)).toHaveLength(0);
    expect(doc.catalog.get(PDFName.of('OCProperties'))).toBeUndefined();
    expect((page.node.Resources() as PDFDict).get(PDFName.of('Properties'))).toBeUndefined();
  });

  it('several pages in one document share one sk_marks layer; each page maps it', async () => {
    const doc = await PDFDocument.create();
    await drawSheetPage(doc, layoutFor({ shape: 'circle', widthUm: 30_000, heightUm: 30_000 }), jpg);
    await drawSheetPage(doc, layoutFor({ shape: 'rect', corners: 'rounded', widthUm: 40_000, heightUm: 20_000 }), await raster(400, 200));
    const loaded = await PDFDocument.load(await doc.save(), { updateMetadata: false });
    expect(loaded.getPageCount()).toBe(2);
    const ocgs = loaded.catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('OCGs'), PDFArray);
    expect(ocgs.size()).toBe(1);
    for (const page of loaded.getPages()) {
      const blocks = marksBlocks(page);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].ocgName).toBe('sk_marks');
      expect(circlesIn(blocks[0].body)).toHaveLength(4);
    }
  });

  it('an empty layout with marks still draws the dots', async () => {
    const layout: LayoutResult = { ...layoutFor({ shape: 'circle', widthUm: 30_000, heightUm: 30_000 }), placements: [], countPerSheet: 0 };
    const { result, page } = await onePage(layout, jpg);
    expect(result.drawCount).toBe(0);
    expect(marksBlocks(page)).toHaveLength(1);
  });
});

describe('setPrintAtActualSize', () => {
  it('sets /ViewerPreferences << /PrintScaling /None >>', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    setPrintAtActualSize(doc);
    const loaded = await PDFDocument.load(await doc.save(), { updateMetadata: false });
    const vp = loaded.catalog.lookup(PDFName.of('ViewerPreferences'), PDFDict);
    expect(vp.get(PDFName.of('PrintScaling'))?.toString()).toBe('/None');
  });
});

describe('buildSheetPdf uses the shared drawer', () => {
  it('customer sheet: dots, print at actual size, same report', async () => {
    const layout = layoutFor({ shape: 'circle', widthUm: 58_000, heightUm: 58_000 });
    const art = await raster(300, 300);
    const out = await buildSheetPdf({ layout, artwork: art, meta: { displayNo: 'EP-261112-TEST', description: 'dots' } });
    const doc = await PDFDocument.load(out.bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
    expect(marksBlocks(doc.getPage(0))).toHaveLength(1);
    expect(doc.catalog.lookup(PDFName.of('ViewerPreferences'), PDFDict).get(PDFName.of('PrintScaling'))?.toString()).toBe('/None');
    expect(out.report.drawCount).toBe(15);
    expect(out.report.placementsPt).toHaveLength(15);
    expect(doc.getTitle()).toBe('EP-261112-TEST');
  });

  it('PDF artwork is embedded the same way as before (form XObject, box kept)', async () => {
    const pdf = new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', 'cropbox-rot90.pdf')));
    const art: NormalisedArtwork = { kind: 'pdf', bytes: pdf, box: { x: 100, y: 100, width: 400, height: 300 }, rotate: 90, pageCount: 1 };
    const { page } = await onePage(layoutFor({ shape: 'rect', corners: 'sharp', widthUm: 30_000, heightUm: 40_000 }), art);
    const xo = (page.node.Resources() as PDFDict).lookup(PDFName.of('XObject'), PDFDict);
    expect(xo.keys()).toHaveLength(1);
    const form = xo.lookup(xo.keys()[0]) as PDFRawStream;
    expect(form.dict.get(PDFName.of('BBox'))?.toString()).toBe('[ 100 100 500 400 ]');
  });
});
