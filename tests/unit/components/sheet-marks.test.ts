/**
 * The 4 cutter dots on screen: SheetPreview (µm viewBox) and SheetIllustration (mm viewBox) draw
 * them only when the layout carries `marks`. No JSX here (the glob is *.test.ts).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { common } from '@/content/ar';
import { SheetPreview } from '@/components/builder/SheetPreview';
import { SheetIllustration } from '@/app/how-it-works/SheetIllustration';
import { computeLayout, layoutParamsFor } from '@/lib/layout';
import type { LayoutResult, StickerSpec } from '@/lib/types';

const CIRCLE_58: StickerSpec = { shape: 'circle', widthUm: 58_000, heightUm: 58_000 };

function layoutOf(spec: StickerSpec, withMarks: boolean): LayoutResult {
  const params = layoutParamsFor(spec, DEFAULT_SETTINGS.layout);
  if (!withMarks) delete params.marks;
  const out = computeLayout(spec, params);
  if (!out.ok) throw new Error('layout failed');
  return out.layout;
}

const dotsOf = (html: string) => [...html.matchAll(/<circle\b[^>]*data-mark[^>]*>/g)].map((m) => m[0]);
const attr = (tag: string, name: string) => new RegExp(String.raw`\s${name}="([^"]*)"`).exec(tag)?.[1];

describe('SheetPreview dots', () => {
  it('draws 4 black dots (r 2500 µm) at the mark centres', () => {
    const layout = layoutOf(CIRCLE_58, true);
    const dots = dotsOf(renderToStaticMarkup(createElement(SheetPreview, { layout, previewUrl: null })));
    expect(dots).toHaveLength(4);
    const got = dots.map((d) => [Number(attr(d, 'cx')), Number(attr(d, 'cy'))]);
    expect(got).toEqual(layout.marks!.centres.map((c) => [c.xUm, c.yUm]));
    for (const d of dots) {
      expect(attr(d, 'r')).toBe('2500');
      expect(attr(d, 'fill')).toBe('#000');
    }
  });

  it('draws none without marks', () => {
    const layout = layoutOf(CIRCLE_58, false);
    expect(layout.marks).toBeUndefined();
    expect(dotsOf(renderToStaticMarkup(createElement(SheetPreview, { layout, previewUrl: null })))).toHaveLength(0);
  });
});

describe('SheetIllustration dots', () => {
  const spec: StickerSpec = { shape: 'circle', widthUm: 30_000, heightUm: 30_000 };

  it('draws 4 dots in mm (r 2.5 at 7/203 x 7/290)', () => {
    const layout = layoutOf(spec, true);
    const dots = dotsOf(renderToStaticMarkup(createElement(SheetIllustration, { layout, label: 'x' })));
    expect(dots).toHaveLength(4);
    expect(dots.map((d) => [Number(attr(d, 'cx')), Number(attr(d, 'cy'))])).toEqual([
      [7, 7],
      [203, 7],
      [7, 290],
      [203, 290],
    ]);
    for (const d of dots) expect(attr(d, 'r')).toBe('2.5');
  });

  it('draws none without marks', () => {
    const layout = layoutOf(spec, false);
    expect(dotsOf(renderToStaticMarkup(createElement(SheetIllustration, { layout, label: 'x' })))).toHaveLength(0);
  });
});

describe('defaults and copy', () => {
  it('default margin is 3 mm', () => {
    expect(DEFAULT_SETTINGS.layout.marginUm).toBe(3000);
  });

  it('marksHint is the agreed sentence', () => {
    expect(common.marksHint).toBe('النقاط السودة بالزوايا علامات لمكينة القص، ما تطلع على الستيكر.');
  });

  it('default settings + rotation: circle 5.8 cm gives 15 per sheet (example.pdf)', () => {
    const settings = { ...DEFAULT_SETTINGS.layout, allowRotate: true };
    const out = computeLayout(CIRCLE_58, layoutParamsFor(CIRCLE_58, settings));
    expect(out.ok && out.layout.countPerSheet).toBe(15);
  });
});
