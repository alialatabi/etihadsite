/**
 * The receipts tab's state and download (src/components/staff/receipts/receipt-logic.ts): the
 * reducer, what a card shows, the file names and the sequential download. The artwork preparation
 * and the PDF builder are mocked; the real builder is covered by build-receipt-pdf.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { DesignSource, StickerSpec } from '@/lib/types';

const calls = vi.hoisted(() => ({
  prepared: [] as { name: string; spec: StickerSpec }[],
  built: [] as { input: { format: string; white: string; turnCw: number; artwork: unknown }; now: Date }[],
}));
vi.mock('@/lib/design/original.client', () => ({
  prepareOriginalArtwork: async (source: DesignSource, spec: StickerSpec): Promise<unknown> => {
    calls.prepared.push({ name: source.file.name, spec });
    if (source.file.name === 'locked.pdf') return { ok: false, error: 'encrypted' };
    const artwork = { kind: 'raster', bytes: new Uint8Array([1]), mime: 'image/png', pxWidth: source.pxWidth, pxHeight: source.pxHeight, hasAlpha: true, effectiveDpi: 300 };
    return { ok: true, artwork, effectiveDpi: 300 };
  },
}));
vi.mock('@/lib/pdf/build-receipt-pdf', () => ({
  buildReceiptPdf: async (input: { format: string; white: string; turnCw: number; artwork: unknown }, now: Date) => {
    if (input.artwork && (input.artwork as { pxWidth: number }).pxWidth === 666) throw new Error('boom');
    calls.built.push({ input, now });
    return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  },
}));

import {
  MAX_RECEIPT_FILES,
  SAVE_GAP_MS,
  buildReceiptFile,
  canDownload,
  cardView,
  createViewCache,
  designSpec,
  downloadReceiptFiles,
  receiptPdfName,
  receiptPdfNames,
  receiptReducer,
  type ReceiptAction,
  type ReceiptCardState,
} from '@/components/staff/receipts/receipt-logic';
import { fileBaseName, staffPdfName } from '@/components/staff/staff-logic';

const QUALITY = DEFAULT_SETTINGS.quality;
const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
const design = (name: string, w: number, h: number, extra: Partial<DesignSource> = {}): DesignSource => ({
  kind: 'png',
  file: file(name),
  pxWidth: w,
  pxHeight: h,
  hasAlpha: false,
  previewUrl: `blob:${name}`,
  ...extra,
});
const run = (actions: ReceiptAction[], from: ReceiptCardState[] = []) => actions.reduce(receiptReducer, from);
const add = (...names: string[]): ReceiptAction => ({ type: 'add', items: names.map((n) => ({ id: `${n}-0`, file: file(n) })) });
const decoded = (name: string, w: number, h: number, extra: Partial<DesignSource> = {}): ReceiptAction => ({
  type: 'decoded',
  id: `${name}-0`,
  outcome: { ok: true, source: design(name, w, h, extra) },
});
/** A decoded card. */
const ready = (name: string, w: number, h: number, extra: Partial<DesignSource> = {}) => run([add(name), decoded(name, w, h, extra)]);
const noWait = async () => {};

beforeEach(() => {
  calls.prepared.length = 0;
  calls.built.length = 0;
});

describe('receipt cards: reducer', () => {
  it('adding files makes decoding cards in order, a4 by default, upright, white on top', () => {
    const cards = run([add('a.png', 'b.png')]);
    expect(cards.map((c) => c.file.name)).toEqual(['a.png', 'b.png']);
    expect(cards.every((c) => c.status === 'decoding' && c.format === 'a4' && !c.formatPicked && c.turn === 0 && c.white === 'top' && c.design === null)).toBe(true);
  });

  it('never holds more than 30 cards', () => {
    const names = Array.from({ length: MAX_RECEIPT_FILES + 5 }, (_, i) => `f${i}.png`);
    const full = run([add(...names)]);
    expect(full).toHaveLength(MAX_RECEIPT_FILES);
    expect(MAX_RECEIPT_FILES).toBe(30);
    expect(run([add('x.png')], full)).toHaveLength(MAX_RECEIPT_FILES);
  });

  it('remove drops one card and keeps the others untouched', () => {
    const before = run([add('a.png', 'b.png')]);
    const after = run([{ type: 'remove', id: 'a.png-0' }], before);
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(before[1]);
    expect(run([{ type: 'remove', id: 'nope' }], before)).toBe(before);
  });

  it('decoded: the format comes from the file name, the turn matches the slot, white follows the turn', () => {
    // A portrait design named a5: an a5 slot is landscape, so it turns 270 and a6's white would go to the bottom.
    const [c] = ready('10 a5 mk.png', 1000, 1400);
    expect(c).toMatchObject({ status: 'ready', format: 'a5', formatPicked: false, turn: 270, white: 'bottom' });
    const [p] = ready('x a6.png', 1000, 1400);
    expect(p).toMatchObject({ format: 'a6', turn: 0, white: 'top' });
    const [d] = ready('15 dl.png', 1950, 1000);
    expect(d).toMatchObject({ format: 'dl', turn: 0, white: 'top' });
  });

  it('decoded: without a name hint the aspect decides', () => {
    expect(ready('plain.png', 1950, 1000)[0].format).toBe('dl');
    expect(ready('plain.png', 1500, 1000)[0].format).toBe('a6');
    // 1.5 landscape in a portrait a6 slot: turned 270
    expect(ready('plain.png', 1500, 1000)[0]).toMatchObject({ turn: 270, white: 'bottom' });
  });

  it('decoded: a format the employee already picked is kept, with its own auto turn', () => {
    const cards = run([add('10 a5.png'), { type: 'format', id: '10 a5.png-0', format: 'a6' }, decoded('10 a5.png', 1000, 1400)]);
    expect(cards[0]).toMatchObject({ format: 'a6', formatPicked: true, turn: 0, white: 'top' });
  });

  it('decoded: an error shows the error and no design', () => {
    const cards = run([add('bad.png'), { type: 'decoded', id: 'bad.png-0', outcome: { ok: false, error: 'corrupt' } }]);
    expect(cards[0]).toMatchObject({ status: 'error', error: 'corrupt', design: null });
    expect(cardView(cards[0], QUALITY)).toMatchObject({ problem: { kind: 'decode', error: 'corrupt' }, valid: false });
  });

  it('decoded: a second answer for a card that already has one is ignored', () => {
    const once = ready('a.png', 1000, 1400);
    expect(run([decoded('a.png', 10, 10)], once)).toBe(once);
  });

  it('changing the format re-applies the auto turn and white', () => {
    let cards = ready('plain.png', 1000, 1400); // portrait: guessed a4 (1.4 is nearest to 1.357)
    expect(cards[0]).toMatchObject({ format: 'a4', turn: 0 });
    cards = run([{ type: 'format', id: 'plain.png-0', format: 'dl' }], cards);
    expect(cards[0]).toMatchObject({ format: 'dl', formatPicked: true, turn: 270, white: 'bottom' });
    cards = run([{ type: 'format', id: 'plain.png-0', format: 'a6' }], cards);
    expect(cards[0]).toMatchObject({ format: 'a6', turn: 0, white: 'top' });
    // the same format again changes nothing
    expect(run([{ type: 'format', id: 'plain.png-0', format: 'a6' }], cards)).toBe(cards);
  });

  it('turn adds 90 clockwise per press and re-applies the white (top for 0/180, bottom for 90/270)', () => {
    let cards = ready('x a6.png', 1000, 1400);
    const turns: number[] = [];
    const whites: string[] = [];
    for (let i = 0; i < 4; i++) {
      cards = run([{ type: 'turn', id: 'x a6.png-0' }], cards);
      turns.push(cards[0].turn);
      whites.push(cards[0].white);
    }
    expect(turns).toEqual([90, 180, 270, 0]);
    expect(whites).toEqual(['bottom', 'top', 'bottom', 'top']);
  });

  it('the employee can switch the white; the next turn re-applies the auto value', () => {
    let cards = ready('x a6.png', 1000, 1400);
    cards = run([{ type: 'white', id: 'x a6.png-0', white: 'bottom' }], cards);
    expect(cards[0].white).toBe('bottom');
    expect(run([{ type: 'white', id: 'x a6.png-0', white: 'bottom' }], cards)).toBe(cards);
    cards = run([{ type: 'turn', id: 'x a6.png-0' }], cards); // 90 -> auto bottom
    expect(cards[0]).toMatchObject({ turn: 90, white: 'bottom' });
    cards = run([{ type: 'turn', id: 'x a6.png-0' }], cards); // 180 -> auto top
    expect(cards[0]).toMatchObject({ turn: 180, white: 'top' });
  });

  it('turn before the design is decoded does nothing', () => {
    const cards = run([add('a.png')]);
    expect(run([{ type: 'turn', id: 'a.png-0' }], cards)).toBe(cards);
  });

  it('an update keeps every other card object identical', () => {
    const before = [...ready('a.png', 1000, 1400), ...ready('b.png', 1000, 1400)];
    const after = run([{ type: 'turn', id: 'a.png-0' }], before);
    expect(after[1]).toBe(before[1]);
    expect(after[0]).not.toBe(before[0]);
  });
});

describe('receipt cards: what a card shows', () => {
  it('designSpec: the slot in the design\'s own orientation (sides swapped for a quarter turn)', () => {
    expect(designSpec('a5', 0)).toEqual({ shape: 'rect', corners: 'sharp', widthUm: 195_000, heightUm: 144_500 });
    expect(designSpec('a5', 270)).toEqual({ shape: 'rect', corners: 'sharp', widthUm: 144_500, heightUm: 195_000 });
    expect(designSpec('a6', 90)).toEqual({ shape: 'rect', corners: 'sharp', widthUm: 141_320, heightUm: 101_390 });
    expect(designSpec('a6', 180)).toEqual({ shape: 'rect', corners: 'sharp', widthUm: 101_390, heightUm: 141_320 });
  });

  it('resolution is the poorer axis over the slot after the card turn', () => {
    // 1000 x 1950 in an a5 slot: auto turn 270, so the 1000 px span the 14.45 cm side: 175 dpi; the 1950 px span 19.5 cm: 254 dpi.
    let cards = run([add('x a5.png'), decoded('x a5.png', 1000, 1950)]);
    expect(cards[0].turn).toBe(270);
    let v = cardView(cards[0], QUALITY);
    expect(v.dpi).toBeGreaterThanOrEqual(175);
    expect(v.dpi).toBeLessThanOrEqual(176);
    // Turned back to upright (one more press: 270 -> 0): the 1000 px now span 19.5 cm: 130 dpi.
    cards = run([{ type: 'turn', id: 'x a5.png-0' }], cards);
    v = cardView(cards[0], QUALITY);
    expect(v.dpi).toBeGreaterThanOrEqual(130);
    expect(v.dpi).toBeLessThanOrEqual(131);
  });

  it('low resolution is a warning that never blocks', () => {
    const cards = ready('tiny a4.png', 200, 285);
    const v = cardView(cards[0], QUALITY);
    expect(v.dpi).toBeLessThan(QUALITY.blockDpi);
    expect(v.lowDpi).toBe(true);
    expect(v.valid).toBe(true);
    expect(v.problem).toBeNull();
  });

  it('a sharp design has no warning', () => {
    const v = cardView(ready('big a4.png', 3000, 4000)[0], QUALITY);
    expect(v.lowDpi).toBe(false);
    expect(v.valid).toBe(true);
  });

  it('a vector PDF has no dpi and no warning; more than one page is flagged', () => {
    const one = cardView(ready('v a4.pdf', 595, 842, { kind: 'pdf', pdf: { pageCount: 1, pageWidthPt: 595, pageHeightPt: 842 } })[0], QUALITY);
    expect(one).toMatchObject({ dpi: null, lowDpi: false, multiPage: false, valid: true });
    const many = cardView(ready('v a4.pdf', 595, 842, { kind: 'pdf', pdf: { pageCount: 3, pageWidthPt: 595, pageHeightPt: 842 } })[0], QUALITY);
    expect(many.multiPage).toBe(true);
  });

  it('a decoding card is not valid; canDownload needs every card ready', () => {
    const decoding = run([add('a.png')]);
    const views = [cardView(decoding[0], QUALITY)];
    expect(views[0].valid).toBe(false);
    expect(canDownload([])).toBe(false);
    expect(canDownload(views)).toBe(false);
    expect(canDownload([cardView(ready('a.png', 1000, 1400)[0], QUALITY)])).toBe(true);
    expect(canDownload([cardView(ready('a.png', 1000, 1400)[0], QUALITY), ...views])).toBe(false);
  });

  it('views are cached per card object', () => {
    const viewOf = createViewCache(QUALITY);
    const [a] = ready('a.png', 1000, 1400);
    expect(viewOf(a)).toBe(viewOf(a));
    const [b] = run([{ type: 'turn', id: 'a.png-0' }], [a]);
    expect(viewOf(b)).not.toBe(viewOf(a));
  });
});

describe('file names', () => {
  it('<name without extension>-<FORMAT>.pdf', () => {
    expect(receiptPdfName('15 dl mk.pdf', 'dl')).toBe('15 dl mk-DL.pdf');
    expect(receiptPdfName('وصل دار بغداد.png', 'a5')).toBe('وصل دار بغداد-A5.pdf');
    expect(receiptPdfName('a.b.c.jpg', 'a6')).toBe('a.b.c-A6.pdf');
  });
  it('characters Windows forbids are dropped; an empty name becomes design', () => {
    expect(receiptPdfName('a:b*c?.png', 'a4')).toBe('abc-A4.pdf');
    expect(receiptPdfName('???.png', 'a4')).toBe('design-A4.pdf');
  });
  it('a repeated name gets -2, -3 before .pdf; the same name in another format is not a repeat', () => {
    const cards = [...ready('a.png', 1000, 1400), ...ready('a.png', 1000, 1400), ...ready('a.png', 1000, 1400), ...ready('b.png', 1000, 1400)];
    // all guessed a4 (card ids are equal here only because the helper reuses them; names are what matter)
    expect(receiptPdfNames(cards)).toEqual(['a-A4.pdf', 'a-A4-2.pdf', 'a-A4-3.pdf', 'b-A4.pdf']);
    const mixed = [...ready('a.png', 1000, 1400), ...run([{ type: 'format', id: 'a.png-0', format: 'a5' }], ready('a.png', 1000, 1400))];
    expect(receiptPdfNames(mixed)).toEqual(['a-A4.pdf', 'a-A5.pdf']);
  });
  it('shares its sanitiser with the sticker names (their behaviour is unchanged)', () => {
    expect(fileBaseName('logo.png')).toBe('logo');
    expect(fileBaseName('..x..png')).toBe('x');
    const spec = { shape: 'rect', widthUm: 50_000, heightUm: 30_000 } as StickerSpec;
    expect(staffPdfName('a:b.jpg', spec)).toBe(`${fileBaseName('a:b.jpg')}-5x3cm.pdf`);
    expect(Array.from(fileBaseName('x'.repeat(200)))).toHaveLength(80);
  });
});

describe('download', () => {
  it('one PDF per card, in order, with the card\'s format, white and turn; the artwork is prepared for the slot', async () => {
    const cards = [
      ...ready('a a5.png', 1000, 1950), // a5, turn 270
      ...ready('b a6.png', 1000, 1400), // a6, turn 0
      ...ready('c dl.png', 1950, 1000), // dl, turn 0
    ];
    const saved: { name: string; bytes: Uint8Array }[] = [];
    const progress: number[] = [];
    const now = new Date('2026-11-26T09:00:00.000Z');
    const out = await downloadReceiptFiles(cards, { save: (bytes, name) => saved.push({ name, bytes }), onProgress: (n) => progress.push(n), now, wait: noWait });
    expect(out.failed).toEqual([]);
    expect(saved.map((f) => f.name)).toEqual(['a a5-A5.pdf', 'b a6-A6.pdf', 'c dl-DL.pdf']);
    expect(out.saved).toEqual(saved.map((f) => f.name));
    expect(progress).toEqual([1, 2, 3]);
    expect(calls.built.map((c) => [c.input.format, c.input.white, c.input.turnCw])).toEqual([
      ['a5', 'bottom', 270],
      ['a6', 'top', 0],
      ['dl', 'top', 0],
    ]);
    for (const c of calls.built) expect(c.now).toBe(now);
    expect(calls.prepared.map((p) => p.spec)).toEqual([
      { shape: 'rect', corners: 'sharp', widthUm: 144_500, heightUm: 195_000 }, // a5 turned 270: sides swapped
      { shape: 'rect', corners: 'sharp', widthUm: 101_390, heightUm: 141_320 },
      { shape: 'rect', corners: 'sharp', widthUm: 195_000, heightUm: 93_666 },
    ]);
  });

  it('prepares, builds and saves one file before it starts the next, and waits between saves', async () => {
    const cards = [...ready('a.png', 1000, 1400), ...ready('b.png', 1000, 1400)];
    const log: string[] = [];
    await downloadReceiptFiles(cards, {
      save: (_b, name) => log.push(`save ${name} after ${calls.built.length} builds`),
      wait: async (ms) => void log.push(`wait ${ms}`),
    });
    expect(log).toEqual(['save a-A4.pdf after 1 builds', `wait ${SAVE_GAP_MS}`, 'save b-A4.pdf after 2 builds']);
    expect(SAVE_GAP_MS).toBe(400);
  });

  it('one design that cannot be prepared does not stop the others, and is reported', async () => {
    const cards = [...ready('a.png', 1000, 1400), ...ready('locked.pdf', 1000, 1400), ...ready('c.png', 1000, 1400)];
    const saved: string[] = [];
    const out = await downloadReceiptFiles(cards, { save: (_b, n) => saved.push(n), wait: noWait });
    expect(saved).toEqual(['a-A4.pdf', 'c-A4.pdf']);
    expect(out.failed).toEqual([{ ok: false, reason: 'prepare', cardId: 'locked.pdf-0', fileName: 'locked.pdf', error: 'encrypted' }]);
  });

  it('a builder that throws is reported as a build failure and the rest carry on', async () => {
    const cards = [...ready('boom.png', 666, 1400), ...ready('ok.png', 1000, 1400)];
    const saved: string[] = [];
    const out = await downloadReceiptFiles(cards, { save: (_b, n) => saved.push(n), wait: noWait });
    expect(saved).toEqual(['ok-A4.pdf']);
    expect(out.failed).toEqual([{ ok: false, reason: 'build', cardId: 'boom.png-0', fileName: 'boom.png' }]);
  });

  it('a save that throws is reported and the next file is still saved', async () => {
    const cards = [...ready('a.png', 1000, 1400), ...ready('b.png', 1000, 1400)];
    const saved: string[] = [];
    const out = await downloadReceiptFiles(cards, {
      save: (_b, n) => {
        if (n === 'a-A4.pdf') throw new Error('blocked');
        saved.push(n);
      },
      wait: noWait,
    });
    expect(saved).toEqual(['b-A4.pdf']);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0]).toMatchObject({ reason: 'build', fileName: 'a.png' });
  });

  it('a card that is not decoded cannot be built', async () => {
    const [card] = run([add('a.png')]);
    expect(await buildReceiptFile(card, 'a-A4.pdf')).toEqual({ ok: false, reason: 'build', cardId: 'a.png-0', fileName: 'a.png' });
    expect(calls.prepared).toHaveLength(0);
  });
});
