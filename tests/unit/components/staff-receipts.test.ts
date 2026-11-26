/**
 * The receipts tab's markup (vitest runs in node, the glob is *.test.ts): no JSX and no DOM, the
 * components render to static markup. The reducer and the download are in
 * tests/unit/receipts/receipt-logic.test.ts.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { builder, staff } from '@/content/ar';
import { ReceiptCard } from '@/components/staff/receipts/ReceiptCard';
import { StaffReceipts } from '@/components/staff/receipts/StaffReceipts';
import { StaffSheets } from '@/components/staff/StaffSheets';
import { StaffTabs } from '@/components/staff/StaffTabs';
import { cardView, receiptReducer, type ReceiptAction, type ReceiptCardState } from '@/components/staff/receipts/receipt-logic';
import { RECEIPT_FORMATS, RECEIPT_FORMAT_IDS, type ReceiptFormat } from '@/lib/receipts/formats';
import type { DesignSource } from '@/lib/types';

const QUALITY = DEFAULT_SETTINGS.quality;
const LAYOUT = DEFAULT_SETTINGS.layout;
const noop = () => {};
const handlers = { onFormat: noop, onTurn: noop, onWhite: noop, onRemove: noop, onDownload: noop, busy: false };

function card(name: string, w: number, h: number, actions: ReceiptAction[] = [], extra: Partial<DesignSource> = {}): ReceiptCardState {
  const file = new File([new Uint8Array([1])], name);
  const source: DesignSource = { kind: 'png', file, pxWidth: w, pxHeight: h, hasAlpha: false, previewUrl: 'blob:preview', ...extra };
  const base: ReceiptAction[] = [
    { type: 'add', items: [{ id: 'r1', file }] },
    { type: 'decoded', id: 'r1', outcome: { ok: true, source } },
  ];
  return [...base, ...actions].reduce(receiptReducer, [] as ReceiptCardState[])[0];
}
const render = (c: ReceiptCardState) => renderToStaticMarkup(createElement(ReceiptCard, { card: c, view: cardView(c, QUALITY), ...handlers }));
const countOf = (html: string, needle: string) => html.split(needle).length - 1;

describe('ReceiptCard', () => {
  for (const f of RECEIPT_FORMAT_IDS) {
    it(`${f}: the A4 sketch has one slot (and one image) per receipt on the sheet`, () => {
      const html = render(card(`x ${f}.png`, 1000, 1400, [{ type: 'format', id: 'r1', format: f }]));
      const per = RECEIPT_FORMATS[f].perSheet;
      expect(countOf(html, 'data-receipt-slot=')).toBe(per);
      expect(countOf(html, '<image ')).toBe(per);
      expect(html).toContain('viewBox="0 0 210 297"');
      expect(html).toContain('role="img"');
      expect(html).toContain(`aria-label="${staff.receipts.previewAria}"`);
      expect(html).toContain('preserveAspectRatio="none"');
      expect(html).toContain('bg-white');
    });
    it(`${f}: the picker shows the name and the size and count`, () => {
      const html = render(card(`x ${f}.png`, 1000, 1400, [{ type: 'format', id: 'r1', format: f }]));
      expect(html).toContain(`<bdi dir="ltr" class="tabular-nums">${staff.receipts.formats[f]}</bdi>`);
      expect(html).toContain(`<bdi dir="ltr" class="tabular-nums">${staff.receipts.sizes[f]}</bdi> سم، <bdi dir="ltr" class="tabular-nums">${RECEIPT_FORMATS[f].perSheet}</bdi> بالورقة`);
      expect(html).toContain(`for="receipt-format-r1"`);
      expect(html).toContain(staff.receipts.formatLabel);
      expect(html).toContain('id="receipt-format-r1"');
    });
  }

  it('the white switch is only for A6, two buttons with aria-pressed', () => {
    for (const f of RECEIPT_FORMAT_IDS) {
      const html = render(card(`x ${f}.png`, 1000, 1400, [{ type: 'format', id: 'r1', format: f }]));
      if (f === 'a6') {
        expect(html).toContain(`aria-label="${staff.receipts.whiteLabel}"`);
        expect(html).toContain(staff.receipts.whiteTop);
        expect(html).toContain(staff.receipts.whiteBottom);
        expect(countOf(html, 'aria-pressed=')).toBe(2);
      } else {
        expect(html).not.toContain(staff.receipts.whiteTop);
        expect(html).not.toContain(staff.receipts.whiteBottom);
        expect(html).not.toContain('aria-pressed');
      }
    }
  });

  it('A6: the pressed button is the card\'s white side (top for an upright design, bottom after a turn)', () => {
    const pressed = (html: string) => [...html.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((m) => `${m[2]}:${m[1]}`);
    expect(pressed(render(card('x a6.png', 1000, 1400)))).toEqual([`${staff.receipts.whiteTop}:true`, `${staff.receipts.whiteBottom}:false`]);
    const turned = card('x a6.png', 1000, 1400, [{ type: 'turn', id: 'r1' }]);
    expect(turned.white).toBe('bottom');
    expect(pressed(render(turned))).toEqual([`${staff.receipts.whiteTop}:false`, `${staff.receipts.whiteBottom}:true`]);
    const switched = card('x a6.png', 1000, 1400, [{ type: 'white', id: 'r1', white: 'bottom' }]);
    expect(pressed(render(switched))).toEqual([`${staff.receipts.whiteTop}:false`, `${staff.receipts.whiteBottom}:true`]);
  });

  it('A6 sketch: the slots follow the white side', () => {
    const rows = (html: string) => [...html.matchAll(/<rect x="0" y="([\d.]+)"/g)].map((m) => m[1]);
    expect(rows(render(card('x a6.png', 1000, 1400)))).toEqual(['7', '155.68']);
    expect(rows(render(card('x a6.png', 1000, 1400, [{ type: 'white', id: 'r1', white: 'bottom' }])))).toEqual(['0', '148.68']);
  });

  it('a turned design is rotated about each slot centre; an upright one is not', () => {
    const upright = render(card('x a5.png', 1950, 1000));
    expect(upright).not.toContain('rotate(');
    // portrait design in a landscape a5 slot: auto turn 270, drawn with its sides swapped (144.5 wide, 195 high), centred on the slot (112.5, 72.25)
    const turned = render(card('x a5.png', 1000, 1950));
    expect(countOf(turned, 'rotate(270 112.5 72.25)')).toBe(1);
    expect(turned).toContain('width="144.5" height="195"');
    expect(turned).toContain('rotate(270 112.5 224.75)');
  });

  it('has the turn button, the remove button and the download-one button', () => {
    const html = render(card('x a4.png', 1000, 1400));
    expect(html).toContain(staff.receipts.turn);
    expect(html).toContain('lucide-rotate-cw');
    expect(html).toContain('aria-label="احذف x a4.png"');
    expect(html).toContain('aria-label="نزّل PDF لـ x a4.png"');
    expect(html).toContain('data-receipt-card="r1"');
  });

  it('while decoding: no preview image, no download-one, the turn button is disabled', () => {
    const file = new File([new Uint8Array([1])], 'x.png');
    const c = receiptReducer([], { type: 'add', items: [{ id: 'r1', file }] })[0];
    const html = render(c);
    expect(countOf(html, '<image ')).toBe(0);
    expect(html).not.toContain('نزّل PDF لـ');
    const turn = [...html.matchAll(/<button[^>]*>(?:(?!<\/button>).)*<\/button>/g)].map((m) => m[0]).find((b) => b.includes(staff.receipts.turn));
    expect(turn).toContain('disabled');
  });

  it('a file that could not be read shows the error', () => {
    const file = new File([new Uint8Array([1])], 'bad.png');
    const failed: ReceiptAction[] = [
      { type: 'add', items: [{ id: 'r1', file }] },
      { type: 'decoded', id: 'r1', outcome: { ok: false, error: 'corrupt' } },
    ];
    const c = failed.reduce(receiptReducer, [] as ReceiptCardState[])[0];
    const html = render(c);
    expect(html).toContain('role="alert"');
    expect(html).toContain(builder.upload.errors.corrupt);
  });

  it('a PDF with several pages carries the note; one page does not', () => {
    const pdf = (pageCount: number) => card('x a4.pdf', 595, 842, [], { kind: 'pdf', pdf: { pageCount, pageWidthPt: 595, pageHeightPt: 842 } });
    expect(render(pdf(3))).toContain(staff.receipts.multiPage);
    expect(render(pdf(1))).not.toContain(staff.receipts.multiPage);
  });

  it('low resolution is the sticker tab\'s warning; a sharp design has none', () => {
    expect(render(card('tiny a4.png', 200, 285))).toContain(staff.lowDpi);
    expect(render(card('big a4.png', 3000, 4000))).not.toContain(staff.lowDpi);
  });

  it('shows the resolution over the slot', () => {
    const html = render(card('big a4.png', 3000, 4000));
    expect(html).toContain('جودة الطباعة: <bdi dir="ltr" class="tabular-nums">');
  });
});

describe('StaffReceipts', () => {
  it('empty: the hint, the drop zone, a disabled download and the print reminder', () => {
    const html = renderToStaticMarkup(createElement(StaffReceipts, { quality: QUALITY }));
    expect(html).toContain(staff.receipts.empty);
    expect(html).toContain(staff.drop);
    expect(html).toContain('id="receipt-files"');
    expect(countOf(html, 'data-receipt-card')).toBe(0);
    const button = /<button[^>]*>(?:(?!<\/button>).)*<\/button>/g;
    const download = [...html.matchAll(button)].map((m) => m[0]).find((b) => b.includes(staff.download));
    expect(download).toBeDefined();
    expect(download).toContain('disabled');
    const [before, after] = staff.receipts.printHint.split('{percent}');
    expect(html).toContain(before + '<bdi dir="ltr" class="tabular-nums">100</bdi>' + after);
    // not the sticker tab's hints: they speak of the cutter dots
    expect(html).not.toContain(staff.printActualSize.slice(0, 30));
  });
});

describe('StaffTabs', () => {
  const html = renderToStaticMarkup(createElement(StaffTabs, { layoutSettings: LAYOUT, quality: QUALITY }));

  it('two tabs, stickers selected first', () => {
    expect(countOf(html, 'role="tab"')).toBe(2);
    expect(html).toContain(`>${staff.tabs.stickers}</button>`);
    expect(html).toContain(`>${staff.tabs.receipts}</button>`);
    expect(html).toContain(`aria-label="${staff.tabs.label}"`);
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*aria-selected="(true|false)"[^>]*>([^<]+)</g)].map((m) => `${m[2]}:${m[1]}`);
    expect(tabs).toEqual([`${staff.tabs.stickers}:true`, `${staff.tabs.receipts}:false`]);
  });

  it('both panels are in the markup (kept mounted); the receipts one is hidden', () => {
    expect(countOf(html, 'role="tabpanel"')).toBe(2);
    expect(html).toContain(staff.intro);
    expect(html).toContain(staff.receipts.intro);
    expect(html).toContain(staff.empty);
    expect(html).toContain(staff.receipts.empty);
    const panels = [...html.matchAll(/<div[^>]*role="tabpanel"[^>]*>/g)].map((m) => m[0]);
    expect(panels[0]).not.toContain('hidden');
    expect(panels[1]).toContain('hidden');
  });

  it('each tab has its own file input (distinct ids)', () => {
    expect(countOf(html, 'id="staff-files"')).toBe(1);
    expect(countOf(html, 'id="receipt-files"')).toBe(1);
  });

  it('the sticker tab is the unchanged StaffSheets', () => {
    const sheets = renderToStaticMarkup(createElement(StaffSheets, { layoutSettings: LAYOUT, quality: QUALITY }));
    expect(html).toContain(sheets);
  });

  it('every format is offered by the receipts copy', () => {
    for (const f of RECEIPT_FORMAT_IDS as readonly ReceiptFormat[]) {
      expect(staff.receipts.formats[f]).toBeTruthy();
      expect(staff.receipts.sizes[f]).toBeTruthy();
    }
  });
});
