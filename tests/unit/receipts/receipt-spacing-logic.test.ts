/**
 * Editable spacing on a receipt card (src/components/staff/receipts/receipt-logic.ts): where the
 * spacing is reset, where it must be kept, what blocks the download, and which slot the DPI and
 * the prepared artwork follow. The artwork preparation and the PDF builder are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { defaultSpacing, receiptSlots, type ReceiptSpacing } from '@/lib/receipts/formats';
import type { DesignSource, StickerSpec } from '@/lib/types';

const calls = vi.hoisted(() => ({
  prepared: [] as StickerSpec[],
  built: [] as { format: string; spacing: ReceiptSpacing; turnCw: number }[],
}));
vi.mock('@/lib/design/original.client', () => ({
  prepareOriginalArtwork: async (source: DesignSource, spec: StickerSpec): Promise<unknown> => {
    calls.prepared.push(spec);
    const artwork = { kind: 'raster', bytes: new Uint8Array([1]), mime: 'image/png', pxWidth: source.pxWidth, pxHeight: source.pxHeight, hasAlpha: true, effectiveDpi: 300 };
    return { ok: true, artwork, effectiveDpi: 300 };
  },
}));
vi.mock('@/lib/pdf/build-receipt-pdf', () => ({
  buildReceiptPdf: async (input: { format: string; spacing: ReceiptSpacing; turnCw: number }) => {
    calls.built.push({ format: input.format, spacing: input.spacing, turnCw: input.turnCw });
    return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  },
}));

import {
  buildReceiptFile,
  canDownload,
  cardView,
  designSpec,
  downloadReceiptFiles,
  receiptReducer,
  type ReceiptAction,
  type ReceiptCardState,
} from '@/components/staff/receipts/receipt-logic';
import { dpiFor } from '@/components/builder/logic';
import { formatMm } from '@/lib/parse/mm';

const QUALITY = DEFAULT_SETTINGS.quality;
const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
const design = (name: string, w: number, h: number): DesignSource => ({ kind: 'png', file: file(name), pxWidth: w, pxHeight: h, hasAlpha: false, previewUrl: `blob:${name}` });
const run = (actions: ReceiptAction[], from: ReceiptCardState[] = []) => actions.reduce(receiptReducer, from);
const ID = 'c-0';
/** A decoded card named so that its format is guessed (e.g. "x a6.png" -> a6). */
const ready = (name: string, w: number, h: number): ReceiptCardState[] =>
  run([
    { type: 'add', items: [{ id: ID, file: file(name) }] },
    { type: 'decoded', id: ID, outcome: { ok: true, source: design(name, w, h) } },
  ]);
const type = (key: Parameters<typeof receiptReducer>[1] extends infer A ? (A extends { type: 'spacing'; key: infer K } ? K : never) : never, text: string): ReceiptAction => ({ type: 'spacing', id: ID, key, text });
const texts = (c: ReceiptCardState) => Object.fromEntries(Object.entries(c.spacing).map(([k, v]) => [k, formatMm(v)]));

beforeEach(() => {
  calls.prepared.length = 0;
  calls.built.length = 0;
});

describe('spacing: where it is set', () => {
  it('a new card starts with the a4 defaults, text included', () => {
    const [c] = run([{ type: 'add', items: [{ id: ID, file: file('a.png') }] }]);
    expect(c.spacing).toEqual(defaultSpacing('a4'));
    expect(c.spacingText).toEqual(texts(c));
    expect(c.spacingText.topUm).toBe('12');
  });

  it('decoded: the format default after the auto rules (a6 turned: white at the bottom)', () => {
    expect(ready('menu a5.png', 1950, 1000)[0].spacing).toEqual(defaultSpacing('a5'));
    const [turned] = ready('x a6.png', 1500, 1000); // landscape in a portrait slot: turn 270, white bottom
    expect(turned).toMatchObject({ format: 'a6', turn: 270, white: 'bottom' });
    expect(turned.spacing).toEqual(defaultSpacing('a6', 'bottom'));
    expect(turned.spacingText).toEqual(texts(turned));
  });

  it('a different format resets the spacing to that format\'s defaults and text', () => {
    let cards = ready('x a4.png', 1000, 1400);
    cards = run([type('topUm', '30'), type('leftUm', '5')], cards);
    expect(cards[0].spacing.topUm).toBe(30_000);
    cards = run([{ type: 'format', id: ID, format: 'a5' }], cards);
    expect(cards[0].spacing).toEqual(defaultSpacing('a5'));
    expect(cards[0].spacingText).toEqual(texts(cards[0]));
    cards = run([type('gapYUm', '3'), { type: 'format', id: ID, format: 'a6' }], cards);
    expect(cards[0].spacing).toEqual(defaultSpacing('a6', cards[0].white));
  });

  it('picking the same format again keeps the spacing, the text and the turn', () => {
    let cards = ready('x a5.png', 1000, 1400);
    cards = run([{ type: 'turn', id: ID }, type('leftUm', '10'), type('gapYUm', '2.5')], cards);
    const before = cards[0];
    const after = run([{ type: 'format', id: ID, format: 'a5' }], cards)[0];
    expect(after).toMatchObject({ spacing: before.spacing, spacingText: before.spacingText, turn: before.turn, white: before.white, formatPicked: true });
  });

  it('a format picked while the file still decodes gets that format\'s defaults; decoding then sets them again', () => {
    let cards = run([
      { type: 'add', items: [{ id: ID, file: file('x.png') }] },
      { type: 'format', id: ID, format: 'a5' },
    ]);
    expect(cards[0].spacing).toEqual(defaultSpacing('a5'));
    cards = run([{ type: 'decoded', id: ID, outcome: { ok: true, source: design('x.png', 1950, 1000) } }], cards);
    expect(cards[0]).toMatchObject({ format: 'a5', spacing: defaultSpacing('a5') });
  });
});

describe('spacing: the white of an A6 card', () => {
  it('the white action swaps top and bottom (numbers and text) and keeps the other values', () => {
    let cards = ready('x a6.png', 1000, 1400);
    cards = run([type('leftUm', '4'), type('topUm', '6')], cards);
    cards = run([{ type: 'white', id: ID, white: 'bottom' }], cards);
    expect(cards[0].spacing).toEqual({ ...defaultSpacing('a6', 'top'), leftUm: 4_000, topUm: 0, bottomUm: 6_000 });
    expect(cards[0].spacingText).toMatchObject({ topUm: '0', bottomUm: '6', leftUm: '4' });
    // switching back swaps back
    cards = run([{ type: 'white', id: ID, white: 'top' }], cards);
    expect(cards[0].spacing).toMatchObject({ topUm: 6_000, bottomUm: 0, leftUm: 4_000 });
    // the same white again changes nothing
    expect(run([{ type: 'white', id: ID, white: 'top' }], cards)).toBe(cards);
  });

  it('turn on A6 swaps when the white flips, and not when it stays', () => {
    let cards = ready('x a6.png', 1000, 1400);
    cards = run([{ type: 'turn', id: ID }], cards); // 90 -> white bottom
    expect(cards[0]).toMatchObject({ turn: 90, white: 'bottom' });
    expect(cards[0].spacing).toEqual(defaultSpacing('a6', 'bottom'));
    cards = run([{ type: 'turn', id: ID }], cards); // 180 -> white top
    expect(cards[0].spacing).toEqual(defaultSpacing('a6', 'top'));
    // the employee already chose the bottom: the next turn to 270 keeps it (white is bottom either way)
    cards = run([{ type: 'white', id: ID, white: 'bottom' }], cards);
    const chosen = cards[0].spacing;
    cards = run([{ type: 'turn', id: ID }], cards);
    expect(cards[0]).toMatchObject({ turn: 270, white: 'bottom' });
    expect(cards[0].spacing).toEqual(chosen);
  });

  it('turn on a4, a5 and dl never moves a margin (a4 keeps its 12 mm on top)', () => {
    for (const [name, w, h] of [['x a4.png', 1000, 1400], ['x a5.png', 1950, 1000], ['x dl.png', 1950, 1000]] as const) {
      let cards = ready(name, w, h);
      const spacing = cards[0].spacing;
      const texts0 = cards[0].spacingText;
      for (let i = 0; i < 4; i++) {
        cards = run([{ type: 'turn', id: ID }], cards);
        expect(cards[0].spacing).toEqual(spacing);
        expect(cards[0].spacingText).toEqual(texts0);
      }
    }
    const [a4] = run([{ type: 'turn', id: ID }], ready('x a4.png', 1000, 1400));
    expect(a4.spacing.topUm).toBe(12_000);
    expect(a4.spacing.bottomUm).toBe(0);
  });

  it('the white action on a4, a5 and dl keeps the spacing', () => {
    for (const f of ['a4', 'a5', 'dl'] as const) {
      const cards = run([{ type: 'white', id: ID, white: 'bottom' }], ready(`x ${f}.png`, 1000, 1400));
      expect(cards[0].spacing).toEqual(defaultSpacing(f));
    }
  });
});

describe('spacing: editing', () => {
  it('a valid number is committed in micrometres and the text stays as typed', () => {
    const cards = run([type('leftUm', '٧٫٥ ملم')], ready('x a5.png', 1950, 1000));
    expect(cards[0].spacing.leftUm).toBe(7_500);
    expect(cards[0].spacingText.leftUm).toBe('٧٫٥ ملم');
    expect(cardView(cards[0], QUALITY)).toMatchObject({ valid: true, problem: null, invalidSpacing: [] });
  });

  it('text that is not a number blocks the card and never prints the previous number', async () => {
    let cards = ready('x a5.png', 1950, 1000);
    cards = run([type('leftUm', '10'), type('leftUm', '10x')], cards);
    expect(cards[0].spacing.leftUm).toBe(10_000); // the last good number is kept in the state...
    const v = cardView(cards[0], QUALITY);
    expect(v).toMatchObject({ valid: false, problem: { kind: 'spacing', reason: 'invalid' }, invalidSpacing: ['leftUm'] }); // ...but the card is blocked
    expect(canDownload([v])).toBe(false);
    // the download itself refuses too
    const out = await buildReceiptFile(cards[0], 'x-A5.pdf');
    expect(out).toMatchObject({ ok: false, reason: 'build' });
    expect(calls.built).toHaveLength(0);
    // typing a good number again unblocks it
    cards = run([type('leftUm', '12')], cards);
    expect(cardView(cards[0], QUALITY)).toMatchObject({ valid: true, problem: null });
  });

  it('empty, negative and more than 100 mm are invalid', () => {
    for (const bad of ['', ' ', '-1', '100.5', '101', 'abc', '1e2']) {
      const cards = run([type('topUm', bad)], ready('x a4.png', 1000, 1400));
      const v = cardView(cards[0], QUALITY);
      expect(v.valid, JSON.stringify(bad)).toBe(false);
      expect(v.problem).toEqual({ kind: 'spacing', reason: 'invalid' });
    }
    expect(cardView(run([type('topUm', '100')], ready('x a4.png', 1000, 1400))[0], QUALITY).valid).toBe(true);
    expect(cardView(run([type('topUm', '0')], ready('x a4.png', 1000, 1400))[0], QUALITY).valid).toBe(true);
  });

  it('a gap the format does not use is not shown, but its text still counts when it is garbage', () => {
    // (the UI never offers it; the state is still checked as a whole)
    const cards = run([type('gapXUm', 'x')], ready('x a4.png', 1000, 1400));
    expect(cardView(cards[0], QUALITY).invalidSpacing).toEqual(['gapXUm']);
  });

  it('no room: valid numbers that leave less than 20 mm block the card', () => {
    const cards = run([type('leftUm', '100'), type('rightUm', '95')], ready('x a4.png', 1000, 1400));
    const v = cardView(cards[0], QUALITY);
    expect(v).toMatchObject({ valid: false, problem: { kind: 'spacing', reason: 'noRoom' }, invalidSpacing: [], dpi: null });
    expect(canDownload([v])).toBe(false);
  });

  it('spacing edits never re-run the auto turn', () => {
    let cards = ready('x a5.png', 1000, 1400); // portrait in a landscape slot: turn 270
    cards = run([{ type: 'turn', id: ID }, { type: 'turn', id: ID }], cards); // 90, 180: the employee's own turn
    const turn = cards[0].turn;
    cards = run([type('leftUm', '3'), type('gapYUm', '1'), { type: 'spacingReset', id: ID }], cards);
    expect(cards[0].turn).toBe(turn);
  });

  it('the same text again changes nothing; other cards keep their identity', () => {
    const a = ready('x a4.png', 1000, 1400);
    expect(run([type('topUm', '12')], a)).toBe(a);
    const two = run(
      [
        { type: 'add', items: [{ id: 'd-0', file: file('y a4.png') }] },
        { type: 'decoded', id: 'd-0', outcome: { ok: true, source: design('y a4.png', 1000, 1400) } },
      ],
      a,
    );
    const after = run([type('topUm', '5')], two);
    expect(after[1]).toBe(two[1]);
    expect(after[0]).not.toBe(two[0]);
  });

  it('inputs are for a ready card: a spacing action on a decoding card does nothing', () => {
    const cards = run([{ type: 'add', items: [{ id: ID, file: file('x.png') }] }]);
    expect(run([type('topUm', '5'), { type: 'spacingReset', id: ID }], cards)).toBe(cards);
  });

  it('reset restores the defaults for the card\'s format and white, and rewrites the text', () => {
    let cards = ready('x a6.png', 1500, 1000); // turned: white bottom
    cards = run([type('leftUm', '9'), type('topUm', 'zzz'), type('gapXUm', '1')], cards);
    cards = run([{ type: 'spacingReset', id: ID }], cards);
    expect(cards[0].spacing).toEqual(defaultSpacing('a6', 'bottom'));
    expect(cards[0].spacingText).toEqual(texts(cards[0]));
    expect(cardView(cards[0], QUALITY).valid).toBe(true);
    // an a4 card whose white field says bottom keeps the a4 default (12 mm on top)
    let a4 = ready('x a4.png', 1500, 1000);
    a4 = run([type('topUm', '1'), { type: 'spacingReset', id: ID }], a4);
    expect(a4[0].white).toBe('bottom');
    expect(a4[0].spacing).toEqual(defaultSpacing('a4'));
  });
});

describe('spacing: the slot the card prints in', () => {
  it('designSpec follows the edited slot, with the sides swapped for a quarter turn', () => {
    const s: ReceiptSpacing = { ...defaultSpacing('a5'), leftUm: 10_000, gapYUm: 5_000 };
    expect(designSpec('a5', s, 0)).toEqual({ shape: 'rect', corners: 'sharp', widthUm: 200_000, heightUm: 146_000 });
    expect(designSpec('a5', s, 270)).toEqual({ shape: 'rect', corners: 'sharp', widthUm: 146_000, heightUm: 200_000 });
    const [slot] = receiptSlots('a5', s);
    expect([slot.widthUm, slot.heightUm]).toEqual([200_000, 146_000]);
  });

  it('the DPI follows the edited slot (a smaller slot is sharper)', () => {
    let cards = ready('x a4.png', 3000, 3000);
    const base = cardView(cards[0], QUALITY).dpi as number;
    cards = run([type('topUm', '100')], cards); // slot height 285000 -> 197000
    const smaller = cardView(cards[0], QUALITY).dpi as number;
    expect(smaller).toBeGreaterThan(base);
    expect(base).toBeLessThan(270);
    // the same number the layout helper gives for the edited spec
    const spec = designSpec('a4', cards[0].spacing, cards[0].turn);
    expect(spec.heightUm).toBe(197_000);
    expect(dpiFor(cards[0].design as DesignSource, spec)).not.toBeNull();
  });

  it('the download prepares the artwork for the edited slot and hands the spacing to the PDF builder', async () => {
    let cards = ready('x a5.png', 1950, 1000);
    cards = run([type('leftUm', '10'), type('gapYUm', '5')], cards);
    const out = await downloadReceiptFiles(cards, { save: () => {}, wait: async () => {} });
    expect(out.failed).toEqual([]);
    expect(calls.prepared).toEqual([{ shape: 'rect', corners: 'sharp', widthUm: 200_000, heightUm: 146_000 }]);
    expect(calls.built).toHaveLength(1);
    expect(calls.built[0]).toEqual({ format: 'a5', spacing: { ...defaultSpacing('a5'), leftUm: 10_000, gapYUm: 5_000 }, turnCw: 0 });
  });

  it('the spacing of one card does not reach another', async () => {
    const one = ready('x a5.png', 1950, 1000);
    const two = run(
      [
        { type: 'add', items: [{ id: 'd-0', file: file('y a5.png') }] },
        { type: 'decoded', id: 'd-0', outcome: { ok: true, source: design('y a5.png', 1950, 1000) } },
        type('leftUm', '1'),
      ],
      one,
    );
    expect(two[0].spacing.leftUm).toBe(1_000);
    expect(two[1].spacing).toEqual(defaultSpacing('a5'));
    await downloadReceiptFiles(two, { save: () => {}, wait: async () => {} });
    expect(calls.built.map((b) => b.spacing.leftUm)).toEqual([1_000, 15_000]);
  });
});
