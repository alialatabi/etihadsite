/**
 * The multi-design sheet drawer (src/lib/pdf/multi-sheet-page.ts) and builder
 * (src/lib/pdf/build-multi-sheet.ts). The layouts are built by hand: no dependency on the packer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFRef, PrintScaling } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildMultiSheetPdf } from '@/lib/pdf/build-multi-sheet';
import { drawMultiSheetPage } from '@/lib/pdf/multi-sheet-page';
import { PDF_PRODUCER, drawSheetPage } from '@/lib/pdf/sheet-page';
import { A4_PT, A4_UM, umToPt } from '@/lib/units';
import type { MultiLayoutResult, MultiPlacement, NormalisedArtwork, StickerSpec } from '@/lib/types';
import { contentOf, layoutFor, raster } from './pdf-helpers';

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', n)));

const MM = 1000;
const CIRCLE = { widthUm: 30 * MM, heightUm: 30 * MM };
const ROUNDED = { widthUm: 40 * MM, heightUm: 30 * MM };
const PLAIN = { widthUm: 30 * MM, heightUm: 40 * MM };
const RADIUS_UM = 4 * MM;

/** 3 designs (circle, rounded rect, plain rect), 2 copies of each, one turned cell, with the cutter dots. */
function handLayout(withMarks: boolean): MultiLayoutResult {
  const placements: MultiPlacement[] = [
    { designIndex: 0, xUm: 20 * MM, yUm: 20 * MM },
    { designIndex: 0, xUm: 60 * MM, yUm: 20 * MM },
    { designIndex: 1, xUm: 20 * MM, yUm: 70 * MM },
    { designIndex: 1, xUm: 70 * MM, yUm: 70 * MM, turned: true },
    { designIndex: 2, xUm: 20 * MM, yUm: 120 * MM },
    { designIndex: 2, xUm: 70 * MM, yUm: 120 * MM },
  ];
  const marks = withMarks ? layoutFor({ shape: 'circle', corners: 'sharp', widthUm: 30 * MM, heightUm: 30 * MM }).marks : undefined;
  return {
    kind: 'multi',
    page: { widthUm: A4_UM.widthUm, heightUm: A4_UM.heightUm },
    marginUm: 3 * MM,
    usable: { xUm: 3 * MM, yUm: 3 * MM, widthUm: A4_UM.widthUm - 6 * MM, heightUm: A4_UM.heightUm - 6 * MM },
    gapXUm: 2 * MM,
    gapYUm: 2 * MM,
    designs: [
      { cell: CIRCLE, clip: { kind: 'circle' } },
      { cell: ROUNDED, clip: { kind: 'roundedRect', radiusUm: RADIUS_UM } },
      { cell: PLAIN, clip: { kind: 'none' } },
    ],
    perDesign: 2,
    countPerSheet: 6,
    block: { xUm: 20 * MM, yUm: 20 * MM, widthUm: 90 * MM, heightUm: 140 * MM },
    placements,
    ...(marks ? { marks } : {}),
  };
}

let artworks: NormalisedArtwork[];
beforeAll(async () => {
  const png = await raster(300, 300, true);
  const jpeg = await raster(400, 300, false);
  const pdf: NormalisedArtwork = {
    kind: 'pdf',
    bytes: fx('cropbox-rot90.pdf'),
    box: { x: 100, y: 100, width: 400, height: 300 },
    rotate: 90,
    pageCount: 1,
  };
  artworks = [png, jpeg, pdf];
});

function xobjectRefs(page: ReturnType<PDFDocument['getPage']>): PDFRef[] {
  const xo = (page.node.Resources() as PDFDict).lookup(PDFName.of('XObject'), PDFDict);
  return xo.entries().map(([, v]) => v as PDFRef);
}

/** Circle path = `cx+r cy m` then 4 curves; rounded-rect path has `l` segments. */
const countOps = (stream: string, op: string) => stream.split(/\s+/).filter((t) => t === op).length;

describe('drawMultiSheetPage', () => {
  it('draws every placement with its design, embeds each artwork once, matches placements', async () => {
    const layout = handLayout(true);
    const doc = await PDFDocument.create();
    const res = await drawMultiSheetPage(doc, layout, artworks);

    expect(res.drawCount).toBe(layout.countPerSheet);
    expect(res.placementsPt).toHaveLength(layout.placements.length);
    expect(res.clipped).toBe(true);

    layout.placements.forEach((p, i) => {
      const cell = layout.designs[p.designIndex].cell;
      const w = p.turned ? cell.heightUm : cell.widthUm;
      const h = p.turned ? cell.widthUm : cell.heightUm;
      expect(res.placementsPt[i].x).toBeCloseTo(umToPt(p.xUm), 6);
      expect(res.placementsPt[i].y).toBeCloseTo(A4_PT.heightPt - umToPt(p.yUm + h), 6);
      expect(res.placementsPt[i].w).toBeCloseTo(umToPt(w), 6);
      expect(res.placementsPt[i].h).toBeCloseTo(umToPt(h), 6);
    });

    const loaded = await PDFDocument.load(await doc.save(), { updateMetadata: false });
    const page = loaded.getPage(0);
    expect(page.getSize()).toEqual({ width: A4_PT.widthPt, height: A4_PT.heightPt });

    // one XObject per design, each drawn exactly twice
    const refs = xobjectRefs(page);
    expect(new Set(refs.map((r) => r.toString())).size).toBe(3);
    const stream = contentOf(page);
    const doNames = [...stream.matchAll(/\/(\S+) Do/g)].map((m) => m[1]);
    expect(doNames).toHaveLength(6);
    const counts = new Map<string, number>();
    for (const n of doNames) counts.set(n, (counts.get(n) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([2, 2, 2]);
    // placements are drawn in order: design 0, 0, 1, 1, 2, 2
    expect(doNames[0]).toBe(doNames[1]);
    expect(doNames[2]).toBe(doNames[3]);
    expect(doNames[4]).toBe(doNames[5]);
    expect(new Set(doNames).size).toBe(3);
  });

  it('clips the circle design as a circle and the rounded design as a rounded rectangle', async () => {
    const doc = await PDFDocument.create();
    await drawMultiSheetPage(doc, handLayout(false), artworks);
    const loaded = await PDFDocument.load(await doc.save(), { updateMetadata: false });
    const stream = contentOf(loaded.getPage(0));
    const blocks = stream.split(/\bq\b/).slice(1);
    expect(blocks).toHaveLength(6);
    const [c0, c1, r0, r1, p0] = blocks;
    // circle: 4 curves, no line segments; rounded: 4 corner curves + 4 straight segments
    for (const b of [c0, c1]) {
      expect(countOps(b, 'c')).toBe(4);
      expect(countOps(b, 'l')).toBe(0);
      expect(countOps(b, 'W')).toBe(1);
    }
    for (const b of [r0, r1]) {
      expect(countOps(b, 'c')).toBe(4);
      expect(countOps(b, 'l')).toBe(4);
      expect(countOps(b, 'W')).toBe(1);
    }
    // the plain rect design: 400x300 pdf box turned by /Rotate 90 -> 300x400 = the 30x40 cell, no overflow, no clip
    expect(countOps(p0, 'W')).toBe(0);
  });

  it('adds a rectangle clip for a rect design whose artwork aspect differs from the cell', async () => {
    const layout = handLayout(false);
    layout.designs[2] = { cell: { widthUm: 40 * MM, heightUm: 40 * MM }, clip: { kind: 'none' } };
    const doc = await PDFDocument.create();
    await drawMultiSheetPage(doc, layout, artworks);
    const loaded = await PDFDocument.load(await doc.save(), { updateMetadata: false });
    const blocks = contentOf(loaded.getPage(0)).split(/\bq\b/).slice(1);
    expect(countOps(blocks[4], 'W')).toBe(1);
    expect(countOps(blocks[4], 'l')).toBe(3);
  });

  it('draws the cutter dots in the sk_marks layer when the layout has marks, and not otherwise', async () => {
    const withDots = await PDFDocument.create();
    await drawMultiSheetPage(withDots, handLayout(true), artworks);
    const loaded = await PDFDocument.load(await withDots.save(), { updateMetadata: false });
    const stream = contentOf(loaded.getPage(0));
    const blocks = [...stream.matchAll(/\/OC \/(\S+) BDC([\s\S]*?)EMC/g)];
    expect(blocks).toHaveLength(1);
    expect(blocks[0][2]).toContain('0 0 0 1 k');
    expect(blocks[0][2]).toContain('f*');
    expect(countOps(blocks[0][2], 'c')).toBe(16);
    expect(loaded.catalog.has(PDFName.of('OCProperties'))).toBe(true);

    const without = await PDFDocument.create();
    await drawMultiSheetPage(without, handLayout(false), artworks);
    const l2 = await PDFDocument.load(await without.save(), { updateMetadata: false });
    expect(contentOf(l2.getPage(0))).not.toContain('BDC');
    expect(l2.catalog.has(PDFName.of('OCProperties'))).toBe(false);
  });

  it('rejects a mismatch between designs and artworks', async () => {
    const doc = await PDFDocument.create();
    await expect(drawMultiSheetPage(doc, handLayout(false), artworks.slice(0, 2))).rejects.toThrow();
  });

  it('with ONE design and a layout equivalent to a computeLayout result draws the same cells and content', async () => {
    const spec: StickerSpec = { shape: 'rect', corners: 'sharp', widthUm: 30 * MM, heightUm: 40 * MM };
    const single = layoutFor(spec);
    expect(single.rotated).toBe(false);
    const art = await raster(300, 400, false);
    const equivalent: MultiLayoutResult = {
      kind: 'multi',
      page: single.page,
      marginUm: single.marginUm,
      usable: single.usable,
      gapXUm: single.gapXUm,
      gapYUm: single.gapYUm,
      designs: [{ cell: single.cell, clip: single.clip }],
      perDesign: single.countPerSheet,
      countPerSheet: single.countPerSheet,
      block: single.block,
      placements: single.placements.map((p) => ({ designIndex: 0, xUm: p.xUm, yUm: p.yUm, ...(p.turned ? { turned: true as const } : {}) })),
      ...(single.marks ? { marks: single.marks } : {}),
    };

    const docA = await PDFDocument.create();
    const a = await drawSheetPage(docA, single, art);
    const docB = await PDFDocument.create();
    const b = await drawMultiSheetPage(docB, equivalent, [art]);

    expect(b.drawCount).toBe(a.drawCount);
    expect(b.drawCount).toBe(single.countPerSheet);
    expect(b.placementsPt).toEqual(a.placementsPt);
    expect(b.clipped).toBe(a.clipped);
    const sa = contentOf((await PDFDocument.load(await docA.save(), { updateMetadata: false })).getPage(0));
    const sb = contentOf((await PDFDocument.load(await docB.save(), { updateMetadata: false })).getPage(0));
    expect(sb).toBe(sa);
  });
});

describe('buildMultiSheetPdf', () => {
  it('builds an A4 PDF with the order metadata and a consistent report', async () => {
    const layout = handLayout(true);
    const out = await buildMultiSheetPdf({ layout, artworks, meta: { displayNo: 'EP-TEST-1', description: 'multi 3 designs x2' } });
    const doc = await PDFDocument.load(out.bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: A4_PT.widthPt, height: A4_PT.heightPt });
    expect(doc.getTitle()).toBe('EP-TEST-1');
    expect(doc.getSubject()).toBe('multi 3 designs x2');
    expect(doc.getProducer()).toBe(PDF_PRODUCER);
    expect(doc.getCreator()).toBe(PDF_PRODUCER);
    expect(out.report.pageWidthPt).toBe(A4_PT.widthPt);
    expect(out.report.pageHeightPt).toBe(A4_PT.heightPt);
    expect(out.report.drawCount).toBe(layout.countPerSheet);
    expect(out.report.placementsPt).toHaveLength(layout.placements.length);
    expect(out.report.clipped).toBe(true);
    expect(out.report.bytes).toBe(out.bytes.byteLength);
    expect(doc.catalog.getOrCreateViewerPreferences().getPrintScaling()).toBe(PrintScaling.None);
  });
});
