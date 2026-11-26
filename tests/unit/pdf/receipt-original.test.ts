/**
 * End to end for the receipts tab's original-quality export: prepareOriginalArtwork (the browser
 * image APIs come from ../design/browser-mock.ts) -> buildReceiptPdf. The Image XObject of the
 * sheet must be the uploaded JPEG itself, embedded once and drawn once per slot; an EXIF-turned
 * JPEG is drawn with the EXIF turn plus the card's turn, filling every slot exactly.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareOriginalArtwork } from '@/lib/design/original.client';
import { buildReceiptPdf } from '@/lib/pdf/build-receipt-pdf';
import { autoTurn, autoWhite, defaultSpacing, receiptSlots, type ReceiptFormat, type ReceiptTurn } from '@/lib/receipts/formats';
import { designSpec } from '@/components/staff/receipts/receipt-logic';
import { A4_PT, umToPt } from '@/lib/units';
import type { DesignSource } from '@/lib/types';
import { installBrowserMock, type BrowserMock } from '../design/browser-mock';
import { contentOf } from './pdf-helpers';

const NOW = new Date('2026-11-26T10:00:00.000Z');
const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', n)));
const TOL = umToPt(10); // 0.01 mm

let mock: BrowserMock;
beforeEach(() => {
  mock = installBrowserMock();
});
afterEach(() => {
  mock.restore();
});

function jpegSource(bytes: Uint8Array, px: [number, number]): DesignSource {
  return { kind: 'jpeg', file: new File([new Uint8Array(bytes)], 'receipt.jpg', { type: 'image/jpeg' }), pxWidth: px[0], pxHeight: px[1], hasAlpha: false, previewUrl: 'blob:preview' };
}

/** What the receipts download does for one card: auto turn, spec, prepare the original, build the sheet. */
async function receiptSheet(src: DesignSource, format: ReceiptFormat, turn: ReceiptTurn = autoTurn(format, src)) {
  const white = autoWhite(turn);
  const prepared = await prepareOriginalArtwork(src, designSpec(format, defaultSpacing(format, white), turn));
  if (!prepared.ok) throw new Error(prepared.error);
  const out = await buildReceiptPdf({ format, spacing: defaultSpacing(format, white), turnCw: turn, artwork: prepared.artwork }, NOW);
  const doc = await PDFDocument.load(out, { updateMetadata: false });
  const page = doc.getPage(0);
  const xo = (page.node.Resources() as PDFDict).lookup(PDFName.of('XObject'), PDFDict);
  const names = xo.keys();
  expect(names).toHaveLength(1); // embedded once
  const image = xo.lookup(names[0]) as PDFRawStream;
  const num = '(-?[\\d.]+(?:e-?\\d+)?)';
  const draws = [...contentOf(page).matchAll(new RegExp(`${num} ${num} ${num} ${num} ${num} ${num} cm\\s+/${names[0].decodeText()} Do`, 'g'))].map((m) => m.slice(1, 7).map(Number));
  return { image, draws, slots: receiptSlots(format, defaultSpacing(format, white)), prepared: prepared.artwork, pageH: page.getHeight(), pageW: page.getWidth() };
}

const nameOf = (d: PDFDict, key: string) => d.get(PDFName.of(key))?.toString();
const numOf = (d: PDFDict, key: string) => (d.get(PDFName.of(key)) as PDFNumber).asNumber();
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

describe('receipts PDF carries the uploaded JPEG as it is', () => {
  it('a CMYK Adobe JPEG on a5: same stream bytes, DeviceCMYK, embedded once, drawn twice', async () => {
    const bytes = new Uint8Array(
      await sharp({ create: { width: 400, height: 280, channels: 3, background: { r: 200, g: 40, b: 40 } } })
        .toColourspace('cmyk')
        .jpeg()
        .toBuffer(),
    );
    const src = jpegSource(bytes, [400, 280]);
    expect(autoTurn('a5', src)).toBe(0); // landscape design on a landscape slot
    const { image, draws, slots, pageH, pageW } = await receiptSheet(src, 'a5');

    expect(pageW).toBeCloseTo(A4_PT.widthPt, 3);
    expect(nameOf(image.dict, 'Subtype')).toBe('/Image');
    expect(nameOf(image.dict, 'Filter')).toBe('/DCTDecode');
    expect(nameOf(image.dict, 'ColorSpace')).toBe('/DeviceCMYK');
    expect([numOf(image.dict, 'Width'), numOf(image.dict, 'Height')]).toEqual([400, 280]);
    expect(image.dict.lookup(PDFName.of('Decode'), PDFArray).size()).toBe(8); // Adobe CMYK is stored inverted
    expect(same(image.contents, bytes)).toBe(true);

    expect(slots).toHaveLength(2);
    expect(draws).toHaveLength(2);
    draws.forEach(([a, b, c, d, e, f], i) => {
      // No turn: the unit square (scaled to pixels) is stretched to the slot exactly.
      expect(b).toBeCloseTo(0, 6);
      expect(c).toBeCloseTo(0, 6);
      expect(Math.abs(a - umToPt(slots[i].widthUm))).toBeLessThan(TOL);
      expect(Math.abs(d - umToPt(slots[i].heightUm))).toBeLessThan(TOL);
      expect(Math.abs(e - umToPt(slots[i].xUm))).toBeLessThan(TOL);
      expect(Math.abs(f - (pageH - umToPt(slots[i].yUm + slots[i].heightUm)))).toBeLessThan(TOL);
    });
  });

  it('an EXIF-6 JPEG (stored 600x400, shown 400x600) on a6: auto turn 0, total turn is the EXIF 90, top edge at the slot top', async () => {
    const bytes = fx('exif6-600x400.jpg');
    const src = jpegSource(bytes, [400, 600]);
    const turn = autoTurn('a6', src);
    expect(turn).toBe(0); // displayed portrait on a portrait slot
    const { image, draws, slots, pageH, prepared } = await receiptSheet(src, 'a6', turn);

    expect(prepared.kind === 'raster' && prepared.rotate).toBe(90);
    expect([numOf(image.dict, 'Width'), numOf(image.dict, 'Height')]).toEqual([600, 400]);
    expect(same(image.contents, bytes)).toBe(true); // stored bytes untouched

    expect(slots).toHaveLength(4);
    expect(draws).toHaveLength(4);
    draws.forEach(([a, b, c, d, e, f], i) => {
      const s = slots[i];
      const left = umToPt(s.xUm);
      const right = umToPt(s.xUm + s.widthUm);
      const top = pageH - umToPt(s.yUm);
      const bottom = pageH - umToPt(s.yUm + s.heightUm);
      // Total turn 90 + 0 = 90 clockwise: [cos, -sin, sin, cos] = [0, -, +, 0] (unit square scaled by 600 x 400 px).
      expect(a).toBeCloseTo(0, 6);
      expect(d).toBeCloseTo(0, 6);
      expect(b).toBeLessThan(0);
      expect(c).toBeGreaterThan(0);
      // The corners of the stored image land on the slot's corners: the whole slot is covered, nothing spills.
      const at = (x: number, y: number) => [a * x + c * y + e, b * x + d * y + f];
      const corners = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)];
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      expect(Math.abs(Math.min(...xs) - left)).toBeLessThan(TOL);
      expect(Math.abs(Math.max(...xs) - right)).toBeLessThan(TOL);
      expect(Math.abs(Math.min(...ys) - bottom)).toBeLessThan(TOL);
      expect(Math.abs(Math.max(...ys) - top)).toBeLessThan(TOL);
      // EXIF 6: the displayed top edge is the stored LEFT edge (x = 0); it sits on the slot's top, spanning its width.
      const [t0, t1] = [at(0, 0), at(0, 1)];
      expect(Math.abs(t0[1] - top)).toBeLessThan(TOL);
      expect(Math.abs(t1[1] - top)).toBeLessThan(TOL);
      expect(Math.abs(Math.abs(t1[0] - t0[0]) - (right - left))).toBeLessThan(TOL);
    });
  });

  it('the same EXIF-6 JPEG on a5 (auto turn 270): total turn is EXIF 90 + 270 = 0, the displayed top edge is the slot left edge', async () => {
    const bytes = fx('exif6-600x400.jpg');
    const src = jpegSource(bytes, [400, 600]);
    const turn = autoTurn('a5', src);
    expect(turn).toBe(270); // displayed portrait on a landscape slot
    const { draws, slots, pageH } = await receiptSheet(src, 'a5', turn);
    expect(draws).toHaveLength(2);
    draws.forEach(([a, b, c, d, e, f], i) => {
      const s = slots[i];
      // 90 + 270 = 360: the stored image upright, stretched to the slot.
      expect(b).toBeCloseTo(0, 6);
      expect(c).toBeCloseTo(0, 6);
      expect(Math.abs(a - umToPt(s.widthUm))).toBeLessThan(TOL);
      expect(Math.abs(d - umToPt(s.heightUm))).toBeLessThan(TOL);
      // The stored LEFT edge (the displayed top) is the slot's left edge, as in the owner's samples.
      expect(Math.abs(e - umToPt(s.xUm))).toBeLessThan(TOL);
      expect(Math.abs(f - (pageH - umToPt(s.yUm + s.heightUm)))).toBeLessThan(TOL);
    });
  });
});
