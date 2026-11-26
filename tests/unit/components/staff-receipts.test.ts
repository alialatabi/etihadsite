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
const handlers = { onFormat: noop, onTurn: noop, onWhite: noop, onSpacing: noop, onSpacingReset: noop, onRemove: noop, onDownload: noop, busy: false };

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
        // «فوق» and «تحت» are also the labels of the spacing fields, so look for the white group itself.
        expect(html).not.toContain(`aria-label="${staff.receipts.whiteLabel}"`);
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

  describe('spacing section', () => {
    const sp = staff.receipts.spacing;
    const inputs = (html: string) => [...html.matchAll(/<input id="receipt-sp-(\w+)-r1"[^>]*>/g)].map((m) => ({ key: m[1], tag: m[0] }));
    const value = (tag: string) => /value="([^"]*)"/.exec(tag)?.[1];

    it('a4: four margin fields and no gap; a5 and dl: one gap; a6: both gaps and the hint', () => {
      const keys = (f: ReceiptFormat) => inputs(render(card(`x ${f}.png`, 1000, 1400, [{ type: 'format', id: 'r1', format: f }]))).map((i) => i.key);
      expect(keys('a4')).toEqual(['topUm', 'bottomUm', 'rightUm', 'leftUm']);
      expect(keys('a5')).toEqual(['topUm', 'bottomUm', 'rightUm', 'leftUm', 'gapYUm']);
      expect(keys('dl')).toEqual(['topUm', 'bottomUm', 'rightUm', 'leftUm', 'gapYUm']);
      expect(keys('a6')).toEqual(['topUm', 'bottomUm', 'rightUm', 'leftUm', 'gapXUm', 'gapYUm']);
    });

    it('title, labels, reset button; the gap is named by the format', () => {
      const a5 = render(card('x a5.png', 1950, 1000));
      expect(a5).toContain(sp.title);
      for (const label of [sp.top, sp.bottom, sp.right, sp.left, sp.gap, sp.reset]) expect(a5).toContain(label);
      expect(a5).not.toContain(sp.gapX);
      expect(a5).not.toContain(sp.a6Hint.slice(0, 8));
      const a6 = render(card('x a6.png', 1000, 1400));
      for (const label of [sp.gapX, sp.gapY]) expect(a6).toContain(label);
      expect(a6).not.toContain(`>${sp.gap}<`);
      expect(a6).toContain('بالـ <bdi dir="ltr" class="tabular-nums">A6</bdi> المسافة بين الصفوف هي بياض الصف الثاني.');
      expect(a6).not.toContain('بياض الصف الأول');
      expect(render(card('x a4.png', 1000, 1400))).not.toContain(sp.gap);
    });

    it('the A6 hint names the row whose white is the gap: the second with white on top, the first with white at the bottom', () => {
      const top = render(card('x a6.png', 1000, 1400));
      const bottom = render(card('x a6.png', 1000, 1400, [{ type: 'white', id: 'r1', white: 'bottom' }]));
      const turned = render(card('x a6.png', 1500, 1000)); // landscape turns 270 and takes the white at the bottom by itself
      expect(top).toContain('بياض الصف الثاني');
      expect(top).not.toContain('بياض الصف الأول');
      for (const html of [bottom, turned]) {
        expect(html).toContain('بالـ <bdi dir="ltr" class="tabular-nums">A6</bdi> المسافة بين الصفوف هي بياض الصف الأول.');
        expect(html).not.toContain('بياض الصف الثاني');
      }
    });

    it('the labels point at their inputs; the fields are numeric, left-to-right, tall enough to touch', () => {
      for (const i of inputs(render(card('x a6.png', 1000, 1400)))) {
        expect(i.tag).toContain('type="text"');
        expect(i.tag).toContain('inputMode="decimal"');
        expect(i.tag).toContain('dir="ltr"');
        expect(i.tag).toContain('h-11');
      }
      expect(render(card('x a4.png', 1000, 1400))).toContain('for="receipt-sp-topUm-r1"');
    });

    it('shows the card\'s numbers in millimetres with Western digits', () => {
      const v = (f: ReceiptFormat) => Object.fromEntries(inputs(render(card(`x ${f}.png`, 1000, 1400, [{ type: 'format', id: 'r1', format: f }]))).map((i) => [i.key, value(i.tag)]));
      expect(v('a4')).toEqual({ topUm: '12', bottomUm: '0', rightUm: '0', leftUm: '0' });
      expect(v('a5')).toEqual({ topUm: '0', bottomUm: '0', rightUm: '0', leftUm: '15', gapYUm: '8' });
      expect(v('a6')).toMatchObject({ topUm: '7', gapXUm: '7.22', gapYUm: '7.36' });
    });

    it('right comes before left, so the physical sides are on the right place in RTL', () => {
      const html = render(card('x a4.png', 1000, 1400));
      expect(html.indexOf('receipt-sp-rightUm-r1')).toBeLessThan(html.indexOf('receipt-sp-leftUm-r1'));
    });

    it('a decoding card has no spacing section; a card with a design has it enabled', () => {
      const file = new File([new Uint8Array([1])], 'x.png');
      const decoding = receiptReducer([], { type: 'add', items: [{ id: 'r1', file }] })[0];
      expect(render(decoding)).not.toContain('receipt-sp-');
      const html = render(card('x a4.png', 1000, 1400));
      expect(inputs(html).every((i) => !i.tag.includes('disabled=""'))).toBe(true);
    });

    it('while a download runs the fields and the reset button wait', () => {
      const c = card('x a4.png', 1000, 1400);
      const html = renderToStaticMarkup(createElement(ReceiptCard, { card: c, view: cardView(c, QUALITY), ...handlers, busy: true }));
      expect(inputs(html).every((i) => i.tag.includes('disabled=""'))).toBe(true);
      const reset = [...html.matchAll(/<button[^>]*>(?:(?!<\/button>).)*<\/button>/g)].map((m) => m[0]).find((b) => b.includes(sp.reset));
      expect(reset).toContain('disabled=""');
    });

    it('text that is not a number: the field is marked, the message is under it, no download button', () => {
      const html = render(card('x a5.png', 1950, 1000, [{ type: 'spacing', id: 'r1', key: 'leftUm', text: '1x' }]));
      const left = inputs(html).find((i) => i.key === 'leftUm');
      expect(left?.tag).toContain('aria-invalid="true"');
      expect(left?.tag).toContain('aria-describedby="receipt-sp-leftUm-r1-error"');
      expect(value(left?.tag ?? '')).toBe('1x');
      expect(html).toContain('id="receipt-sp-leftUm-r1-error"');
      expect(html).toContain('اكتب رقم من <bdi dir="ltr" class="tabular-nums">0</bdi> إلى <bdi dir="ltr" class="tabular-nums">100</bdi> ملم.');
      expect(inputs(html).filter((i) => i.tag.includes('aria-invalid="true"'))).toHaveLength(1);
      expect(html).not.toContain('نزّل PDF لـ');
      expect(countOf(html, 'role="alert"')).toBe(0); // the message is on the field, not in the card's alert
    });

    it('valid text: no error, the download button is there', () => {
      const html = render(card('x a5.png', 1950, 1000, [{ type: 'spacing', id: 'r1', key: 'leftUm', text: '10' }]));
      expect(html).not.toContain('aria-invalid="true"');
      expect(html).toContain('نزّل PDF لـ');
    });

    it('no room: the alert in the card, no preview slots, no resolution, no download button', () => {
      const html = render(
        card('x a4.png', 1000, 1400, [
          { type: 'spacing', id: 'r1', key: 'leftUm', text: '100' },
          { type: 'spacing', id: 'r1', key: 'rightUm', text: '95' },
        ]),
      );
      expect(html).toContain(sp.noRoom);
      expect(html).toContain('role="alert"');
      expect(countOf(html, 'data-receipt-slot=')).toBe(0);
      expect(html).not.toContain('جودة الطباعة');
      expect(html).not.toContain('نزّل PDF لـ');
      expect(html).not.toContain('aria-invalid="true"');
    });

    it('the A4 sketch follows the spacing', () => {
      const rects = (html: string) => [...html.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => m.slice(1, 5).join(' '));
      const edited = card('x a5.png', 1950, 1000, [
        { type: 'spacing', id: 'r1', key: 'leftUm', text: '10' },
        { type: 'spacing', id: 'r1', key: 'gapYUm', text: '5' },
      ]);
      expect(rects(render(edited))).toEqual(['10 0 200 146', '10 151 200 146']);
      const reset = receiptReducer([edited], { type: 'spacingReset', id: 'r1' })[0];
      expect(rects(render(reset))).toEqual(['15 0 195 144.5', '15 152.5 195 144.5']);
    });
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
