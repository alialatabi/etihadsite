/**
 * The multi-design pieces that render: the sheet preview with every design's cells, the size inputs with unique ids,
 * the summary card with its design lines, and the WhatsApp fallback text. No JSX here (the glob is *.test.ts).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { builder, fill, order } from '@/content/ar';
import { MultiSheetPreview } from '@/components/builder/MultiSheetPreview';
import { MultiSizes } from '@/components/builder/PreviewPanels';
import { SummaryCard } from '@/components/builder/SummaryCard';
import { degradedText } from '@/components/builder/degraded';
import { FIRST_SIZE_IDS, SizeInputs, sizeIdsFor } from '@/components/builder/steps/SizeFields';
import { safeMultiLayout } from '@/components/builder/safe';
import type { MultiLayoutResult, StickerSpec } from '@/lib/types';

function layoutOf(specs: StickerSpec[]): MultiLayoutResult {
  const out = safeMultiLayout(specs, DEFAULT_SETTINGS.layout);
  if (!out.ok) throw new Error('layout failed');
  return out.layout;
}

const rect = (w: number, h: number): StickerSpec => ({ shape: 'rect', corners: 'rounded', widthUm: w, heightUm: h });
const attr = (tag: string, name: string) => new RegExp(String.raw`\s${name}="([^"]*)"`).exec(tag)?.[1];
const tagsOf = (html: string, name: string) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((m) => m[0]);

describe('MultiSheetPreview', () => {
  const layout = layoutOf([rect(40_000, 30_000), rect(30_000, 30_000), rect(60_000, 25_000)]);
  const urls = ['blob:one', 'blob:two', 'blob:three'];
  const html = renderToStaticMarkup(createElement(MultiSheetPreview, { layout, previewUrls: urls }));

  it('draws one cell per placement (countPerSheet), each a <use> of its own design', () => {
    const uses = tagsOf(html, 'use');
    expect(uses).toHaveLength(layout.countPerSheet);
    const perDesign = [0, 0, 0];
    for (const u of uses) {
      const id = attr(u, 'href')!;
      const i = Number(/-(\d+)$/.exec(id)![1]);
      perDesign[i]++;
    }
    expect(perDesign).toEqual([layout.perDesign, layout.perDesign, layout.perDesign]);
  });

  it('declares each design once with its own image, cell size and clip', () => {
    const images = tagsOf(html, 'image');
    expect(images.map((t) => attr(t, 'href'))).toEqual(urls);
    expect(images.map((t) => [Number(attr(t, 'width')), Number(attr(t, 'height'))])).toEqual([
      [40_000, 30_000],
      [30_000, 30_000],
      [60_000, 25_000],
    ]);
    // rounded rectangles: one clipPath per design
    expect(tagsOf(html, 'clipPath')).toHaveLength(3);
    expect(images.every((t) => /clip-path="url\(#/.test(t) || /clipPath="url\(#/.test(t))).toBe(true);
  });

  it('draws the 4 cutter dots and the count badge', () => {
    expect(tagsOf(html, 'circle').filter((t) => t.includes('data-mark'))).toHaveLength(4);
    expect(html).toContain(builder.preview.perSheet);
  });

  it('exactly the turned placements of a real layout carry the rotate(90) transform', () => {
    const wide = layoutOf([rect(120_000, 20_000), rect(120_000, 20_000)]);
    const uses = tagsOf(renderToStaticMarkup(createElement(MultiSheetPreview, { layout: wide, previewUrls: [null, null] })), 'use');
    const rotated = uses.filter((u) => attr(u, 'transform')!.includes('rotate(90)'));
    expect(rotated).toHaveLength(wide.placements.filter((p) => p.turned).length);
  });

  it('a placement that is turned uses rotate(90) around its box centre', () => {
    const fake: MultiLayoutResult = {
      ...layout,
      designs: [{ cell: { widthUm: 40_000, heightUm: 20_000 }, clip: { kind: 'none' } }],
      perDesign: 1,
      countPerSheet: 1,
      placements: [{ designIndex: 0, xUm: 10_000, yUm: 20_000, turned: true }],
    };
    const out = renderToStaticMarkup(createElement(MultiSheetPreview, { layout: fake, previewUrls: ['blob:a'] }));
    const use = tagsOf(out, 'use')[0];
    // turned box = 20_000 × 40_000 at (10_000, 20_000): centre (20_000, 40_000)
    expect(attr(use, 'transform')).toBe('translate(20000 40000) rotate(90) translate(-20000 -10000)');
  });

  it('an unturned placement is a plain translate', () => {
    const fake: MultiLayoutResult = {
      ...layout,
      designs: [{ cell: { widthUm: 40_000, heightUm: 20_000 }, clip: { kind: 'circle' } }],
      perDesign: 1,
      countPerSheet: 1,
      placements: [{ designIndex: 0, xUm: 10_000, yUm: 20_000 }],
    };
    const out = renderToStaticMarkup(createElement(MultiSheetPreview, { layout: fake, previewUrls: [null] }));
    expect(attr(tagsOf(out, 'use')[0], 'transform')).toBe('translate(10000 20000)');
    expect(tagsOf(out, 'ellipse').length).toBeGreaterThan(0); // circle clip
  });

  it('without a layout it shows the empty text, and plain cells without a preview url', () => {
    const empty = renderToStaticMarkup(createElement(MultiSheetPreview, { layout: null, previewUrls: [], emptyText: 'EMPTY' }));
    expect(empty).toContain('EMPTY');
    expect(tagsOf(empty, 'use')).toHaveLength(0);
    const plain = renderToStaticMarkup(createElement(MultiSheetPreview, { layout, previewUrls: [null, null, null] }));
    expect(tagsOf(plain, 'image')).toHaveLength(0);
  });

  it('ids are unique per instance and per design (two previews on one page do not clash)', () => {
    const a = renderToStaticMarkup(createElement('div', null, createElement(MultiSheetPreview, { layout, previewUrls: urls }), createElement(MultiSheetPreview, { layout, previewUrls: urls })));
    const ids = [...a.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('size inputs of each design', () => {
  const render = (ids: ReturnType<typeof sizeIdsFor>, isCircle = false) =>
    renderToStaticMarkup(
      createElement(SizeInputs, { ids, isCircle, widthText: '3', heightText: '4', onWidth: () => {}, onHeight: () => {}, invalid: false }),
    );

  it('design 1 keeps the DOM ids the page always had', () => {
    expect(FIRST_SIZE_IDS).toEqual({ width: 'size-width', height: 'size-height', msg: 'size-msg' });
    expect(sizeIdsFor(1)).toEqual(FIRST_SIZE_IDS);
    const html = render(sizeIdsFor(1));
    expect(html).toContain('id="size-width"');
    expect(html).toContain('id="size-height"');
    expect(html).toContain('aria-describedby="size-msg"');
  });

  it('the other designs get unique ids', () => {
    expect(sizeIdsFor(2)).toEqual({ width: 'size-width-2', height: 'size-height-2', msg: 'size-msg-2' });
    const all = Array.from({ length: 8 }, (_, i) => sizeIdsFor(i + 1)).flatMap((x) => [x.width, x.height, x.msg]);
    expect(new Set(all).size).toBe(all.length);
    expect(render(sizeIdsFor(3))).toContain('id="size-width-3"');
  });

  it('a multi-design row names its group after the design heading; design 1 alone has no group', () => {
    const grouped = renderToStaticMarkup(
      createElement(SizeInputs, { ids: sizeIdsFor(2), isCircle: false, widthText: '3', heightText: '4', onWidth: () => {}, onHeight: () => {}, invalid: false, labelledBy: 'size-title-2' }),
    );
    expect(grouped).toContain('role="group"');
    expect(grouped).toContain('aria-labelledby="size-title-2"');
    const plain = render(sizeIdsFor(1));
    expect(plain).not.toContain('role="group"');
    expect(plain).not.toContain('aria-labelledby');
  });

  it('a circle has the diameter only', () => {
    const html = render(sizeIdsFor(2), true);
    expect(html).toContain('id="size-width-2"');
    expect(html).not.toContain('size-height-2');
  });
});

describe('the summary of a multi-design order', () => {
  const base = {
    shape: 'rect' as const,
    corners: 'rounded' as const,
    widthUm: 40_000,
    heightUm: 30_000,
    countPerSheet: 12,
    sheets: 5,
    material: 'paper' as const,
    totalStickers: 60,
    unitPriceIqd: 1000,
    discountPercent: 0,
    subtotalIqd: 5000,
    deliveryFeeIqd: 0,
    totalIqd: 5000,
  };

  it('lists every design with its size and how many of each are received', () => {
    const html = renderToStaticMarkup(
      createElement(SummaryCard, {
        summary: { ...base, designs: [{ widthUm: 40_000, heightUm: 30_000 }, { widthUm: 30_000, heightUm: 30_000 }, { widthUm: 60_000, heightUm: 25_000 }], perDesign: 4 },
      }),
    );
    expect(html).toContain(fill(builder.multi.designN, { n: 1 }));
    expect(html).toContain(fill(builder.multi.designN, { n: 3 }));
    expect(html).toContain(builder.multi.perDesign);
    expect(html).toContain('>20<'); // 5 sheets × 4 copies of each design
    expect(html).not.toContain(`>${builder.summary.size}<`); // one line per design instead
  });

  it('a single-design summary is untouched', () => {
    const html = renderToStaticMarkup(createElement(SummaryCard, { summary: base }));
    expect(html).toContain(builder.summary.size);
    expect(html).not.toContain(builder.multi.perDesign);
  });

  it('the WhatsApp fallback text lists the designs only for a multi-design order', () => {
    const single = degradedText({ ...base });
    expect(single).not.toContain(fill(builder.multi.designN, { n: 1 }));
    const multi = degradedText({ ...base, designs: [{ widthUm: 40_000, heightUm: 30_000 }, { widthUm: 30_000, heightUm: 30_000 }], perDesign: 4 });
    // The shared order text writes the designs block (count, "n) size", copies of each); it is not repeated by the page.
    expect(multi).toContain(`${order.text.designs}:`);
    expect(multi).toContain('2) ');
    expect(multi).toContain(`${order.text.perDesign}:`);
    expect(multi.split(order.text.perDesign).length).toBe(2);
  });
});

describe('MultiSizes in the pinned strip', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ index: i, id: i === 0 ? 'main' : `s${i}`, spec: rect(30_000 + i * 1000, 30_000) }));
  const b = { rows } as unknown as Parameters<typeof MultiSizes>[0]['b'];

  it('lists every design in the card and the dialog', () => {
    expect(tagsOf(renderToStaticMarkup(createElement(MultiSizes, { b })), 'li')).toHaveLength(8);
  });

  it('shows only the first lines and «+N» in the strip, so it does not grow with the designs', () => {
    const html = renderToStaticMarkup(createElement(MultiSizes, { b, limit: 2 }));
    expect(tagsOf(html, 'li')).toHaveLength(3);
    expect(html).toContain('+6');
    const few = renderToStaticMarkup(createElement(MultiSizes, { b: { rows: rows.slice(0, 2) } as never, limit: 2 }));
    expect(tagsOf(few, 'li')).toHaveLength(2);
    expect(few).not.toContain('+');
  });
});
