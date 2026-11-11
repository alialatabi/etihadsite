/**
 * The staff page: cards per file, size rules (the builder's), the download button and the PDF
 * hand-over. No JSX and no DOM here (vitest runs in node, the glob is *.test.ts): the state is a
 * pure reducer (staff-logic.ts), the cards render to static markup, and the browser image APIs
 * are the sharp-backed stand-in from tests/unit/design/browser-mock.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { builder, staff } from '@/content/ar';
import type { DesignSource } from '@/lib/types';
import { installBrowserMock, type BrowserMock } from '../design/browser-mock';

type Item = { layout: { countPerSheet: number }; artwork: { pxWidth: number } };
const built = vi.hoisted(() => ({ calls: [] as { items: unknown[]; now: Date }[] }));
vi.mock('@/lib/pdf/build-staff-pdf', () => ({
  buildStaffPdf: async (items: unknown[], now: Date) => {
    built.calls.push({ items, now });
    return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  },
}));
vi.mock('@/lib/design/prepare.client', () => ({
  prepareArtwork: async (source: DesignSource): Promise<unknown> => {
    if (source.file.name === 'locked.pdf') return { ok: false, error: 'encrypted' };
    const artwork = { kind: 'raster', bytes: new Uint8Array([1]), mime: 'image/png', pxWidth: source.pxWidth, pxHeight: source.pxHeight, hasAlpha: true, effectiveDpi: 300 };
    return { ok: true, artwork, effectiveDpi: 300 };
  },
}));

import { StaffCard } from '@/components/staff/StaffCard';
import { StaffSheets } from '@/components/staff/StaffSheets';
import { decodeDesign } from '@/lib/design/decode.client';
import {
  MAX_STAFF_FILES,
  buildStaffDownload,
  canDownload,
  cardView,
  createViewCache,
  staffFileName,
  staffReducer,
  type StaffAction,
  type StaffCardState,
} from '@/components/staff/staff-logic';

const LAYOUT = DEFAULT_SETTINGS.layout;
const QUALITY = DEFAULT_SETTINGS.quality;
const file = (name: string, type = 'image/png') => new File([new Uint8Array([1, 2, 3])], name, { type });
const design = (name: string, w: number, h: number): DesignSource => ({
  kind: 'png',
  file: file(name),
  pxWidth: w,
  pxHeight: h,
  hasAlpha: true,
  previewUrl: `blob:${name}`,
});
const run = (actions: StaffAction[], from: StaffCardState[] = []) => actions.reduce(staffReducer, from);
const add = (...names: string[]): StaffAction => ({ type: 'add', items: names.map((n) => ({ id: `${n}-0`, file: file(n) })) });
const noop = { onShape() {}, onWidth() {}, onHeight() {}, onRemove() {} };

/** A card that is decoded and has the typed width (cm). */
function ready(name: string, w: number, h: number, widthCm: string, shape: 'circle' | 'rounded' | 'sharp' = 'circle'): StaffCardState[] {
  const id = `${name}-0`;
  return run([add(name), { type: 'shape', id, shape }, { type: 'width', id, text: widthCm }, { type: 'decoded', id, seq: 1, outcome: { ok: true, source: design(name, w, h) } }]);
}

describe('staff cards', () => {
  it('adding 2 files makes 2 cards, in order, each decoding with a circle shape', () => {
    const cards = run([add('a.png', 'b.png')]);
    expect(cards.map((c) => c.file.name)).toEqual(['a.png', 'b.png']);
    expect(cards.every((c) => c.shape === 'circle' && c.status === 'decoding' && c.sizeUm === null)).toBe(true);
  });

  it('never holds more than 30 cards', () => {
    const names = Array.from({ length: MAX_STAFF_FILES + 5 }, (_, i) => `f${i}.png`);
    const full = run([add(...names)]);
    expect(full).toHaveLength(MAX_STAFF_FILES);
    expect(run([add('x.png')], full)).toHaveLength(MAX_STAFF_FILES);
  });

  it('remove drops one card and keeps the others untouched', () => {
    const before = run([add('a.png', 'b.png')]);
    const after = run([{ type: 'remove', id: 'a.png-0' }], before);
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(before[1]);
  });

  it('size lock: a 2:1 design typed 6 cm wide gets 3 cm high, and typing the height moves the width', () => {
    let cards = ready('wide.png', 600, 300, '6', 'sharp');
    expect(cards[0].sizeUm).toEqual({ widthUm: 60_000, heightUm: 30_000 });
    expect(cards[0].heightText).toBe('3');
    cards = run([{ type: 'height', id: 'wide.png-0', text: '5' }], cards);
    expect(cards[0].sizeUm).toEqual({ widthUm: 100_000, heightUm: 50_000 });
    expect(cards[0].widthText).toBe('10');
  });

  it('a circle has one field: the height text stays empty and the spec is square', () => {
    const cards = ready('c.png', 600, 300, '5');
    expect(cards[0].heightText).toBe('');
    expect(cardView(cards[0], LAYOUT, QUALITY).spec).toMatchObject({ shape: 'circle', widthUm: 50_000, heightUm: 50_000 });
  });

  it('switching to custom or back asks for a new decode (a newer seq); circle to rounded does not', () => {
    const base = ready('s.png', 400, 400, '4');
    const toRounded = run([{ type: 'shape', id: 's.png-0', shape: 'rounded' }], base);
    expect(toRounded[0].seq).toBe(1);
    const toCustom = run([{ type: 'shape', id: 's.png-0', shape: 'custom' }], toRounded);
    expect(toCustom[0]).toMatchObject({ status: 'decoding', seq: 2 });
    // The answer of the first decode (seq 1) is stale and ignored.
    const stale = run([{ type: 'decoded', id: 's.png-0', seq: 1, outcome: { ok: false, error: 'corrupt' } }], toCustom);
    expect(stale[0]).toBe(toCustom[0]);
  });

  it('a PDF design prefills its page size when nothing was typed', () => {
    const pdf: DesignSource = { ...design('p.pdf', 595, 842), kind: 'pdf', hasAlpha: false, pdf: { pageCount: 1, pageWidthPt: 283.465, pageHeightPt: 283.465 } };
    const cards = run([add('p.pdf'), { type: 'decoded', id: 'p.pdf-0', seq: 1, outcome: { ok: true, source: pdf } }]);
    expect(cards[0].widthText).toBe('10');
  });
});

describe('the download button', () => {
  it('is off with no card, on when every card is valid, off when one size is invalid', () => {
    expect(canDownload([])).toBe(false);
    const good = ready('a.png', 400, 400, '4');
    const views = createViewCache(LAYOUT, QUALITY);
    expect(canDownload(good.map(views))).toBe(true);

    const bad = run([{ type: 'width', id: 'a.png-0', text: 'abc' }], good);
    const badView = views(bad[0]);
    expect(badView.problem).toEqual({ kind: 'size', reason: 'invalid' });
    expect(canDownload([views(good[0]), badView])).toBe(false);

    const tooBig = run([{ type: 'width', id: 'a.png-0', text: '30' }], good);
    expect(views(tooBig[0]).problem).toEqual({ kind: 'size', reason: 'too_big_for_page' });
    expect(views(tooBig[0]).maxWidthUm).toBeGreaterThan(0);
    expect(canDownload(run([add('d.png')]).map(views))).toBe(false);
  });

  it('renders disabled with no card, with the print reminder and the dots hint', () => {
    const html = renderToStaticMarkup(createElement(StaffSheets, { layoutSettings: LAYOUT, quality: QUALITY }));
    const button = /<button[^>]*>(?:(?!<\/button>).)*<\/button>/g;
    const download = [...html.matchAll(button)].map((m) => m[0]).find((b) => b.includes(staff.download));
    expect(download).toBeDefined();
    expect(download).toContain('disabled');
    expect(html).toContain(staff.printActualSize);
    expect(html).toContain(staff.empty);
  });

  it('low resolution is a warning that never blocks', () => {
    const cards = ready('tiny.png', 200, 200, '10'); // 200 px over 10 cm = 50 dpi
    const v = cardView(cards[0], LAYOUT, QUALITY);
    expect(v.dpi).toBeLessThan(QUALITY.blockDpi);
    expect(v.lowDpi).toBe(true);
    expect(v.valid).toBe(true);
    const html = renderToStaticMarkup(createElement(StaffCard, { card: cards[0], view: v, ...noop }));
    expect(html).toContain(staff.lowDpi);
  });
});

describe('download', () => {
  beforeEach(() => {
    built.calls.length = 0;
  });

  it('calls buildStaffPdf once with one item per card in card order, and names the file in Baghdad time', async () => {
    const cards = [...ready('a.png', 400, 400, '5'), ...ready('b.png', 300, 300, '4', 'sharp')];
    const now = new Date('2026-11-12T10:05:00Z');
    const out = await buildStaffDownload(cards, LAYOUT, QUALITY, now);
    if (!out.ok) throw new Error(JSON.stringify(out));
    expect(out.fileName).toMatch(/^softy-sheets-\d{8}-\d{4}\.pdf$/);
    expect(out.fileName).toBe('softy-sheets-20261112-1305.pdf');
    expect(built.calls).toHaveLength(1);
    const items = built.calls[0].items as Item[];
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.artwork.pxWidth)).toEqual([400, 300]);
    expect(items[0].layout.countPerSheet).not.toBe(items[1].layout.countPerSheet);
    expect(built.calls[0].now).toBe(now);
  });

  it('names the card whose artwork could not be prepared, and builds nothing', async () => {
    const out = await buildStaffDownload([...ready('a.png', 400, 400, '5'), ...ready('locked.pdf', 400, 400, '5')], LAYOUT, QUALITY);
    expect(out).toMatchObject({ ok: false, reason: 'prepare', fileName: 'locked.pdf', error: 'encrypted' });
    expect(built.calls).toHaveLength(0);
  });

  it('file name: 24 h clock, zero padded, next day in Baghdad', () => {
    expect(staffFileName(new Date('2026-01-02T21:09:00Z'))).toBe('softy-sheets-20260103-0009.pdf');
  });
});

describe('custom shape with a JPEG', () => {
  let mock: BrowserMock;
  beforeEach(() => {
    mock = installBrowserMock();
  });
  afterEach(() => {
    mock.restore();
  });

  it('shows the no_alpha message on the card', async () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', 'opaque-300x300.jpg')));
    const f = new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
    const out = await decodeDesign(f, { shape: 'custom', maxBytes: 50 * 1024 * 1024 });
    expect(out).toEqual({ ok: false, error: 'no_alpha' });

    let cards = run([{ type: 'add', items: [{ id: 'j', file: f }] }, { type: 'shape', id: 'j', shape: 'custom' }]);
    cards = run([{ type: 'decoded', id: 'j', seq: 2, outcome: out }], cards);
    const v = cardView(cards[0], LAYOUT, QUALITY);
    expect(v.valid).toBe(false);
    const html = renderToStaticMarkup(createElement(StaffCard, { card: cards[0], view: v, ...noop }));
    expect(html).toContain(builder.upload.errors.no_alpha);
  });
});
