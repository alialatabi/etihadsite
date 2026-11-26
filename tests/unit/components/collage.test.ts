import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  MarkerCircle,
  PaperCard,
  PriceTag,
  ScrapHeadline,
  SectionTitle,
  StepNumber,
  Tag,
  Tape,
  ctaCls,
  scrapCls,
} from '@/components/collage';

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (markup: string) => markup.replace(/<[^>]*>/g, '');
const count = (markup: string, needle: string) => markup.split(needle).length - 1;

describe('collage kit: ScrapHeadline', () => {
  it('keeps the heading text exactly (one word per scrap, real spaces between)', () => {
    const t = 'من الفكرة للطباعة بثلاث خطوات';
    const m = html(h(ScrapHeadline, { text: t }));
    expect(text(m)).toBe(t);
    expect(count(m, '<h1')).toBe(1);
  });

  it('groups words over maxScraps and still round-trips', () => {
    const t = 'واحد اثنين ثلاثة اربعة خمسة ستة سبعة';
    const m = html(h(ScrapHeadline, { text: t, maxScraps: 5 }));
    expect(text(m)).toBe(t);
    expect(count(m, '<span class="scrap ')).toBe(5);
  });

  it('has exactly one red scrap by default and none with red="none"', () => {
    const t = 'صمّم ستيكرك الحين';
    expect(count(html(h(ScrapHeadline, { text: t })), 'scrap-red')).toBe(1);
    expect(count(html(h(ScrapHeadline, { text: t, red: 'none' })), 'scrap-red')).toBe(0);
    expect(count(html(h(ScrapHeadline, { text: t, red: 'first' })), 'scrap-red')).toBe(1);
  });
});

describe('collage kit: SectionTitle', () => {
  it('renders an h2 with its id and tabindex', () => {
    const m = html(h(SectionTitle, { id: 'x', tabIndex: -1, children: 'عنوان' }));
    expect(m).toContain('<h2');
    expect(m).toContain('id="x"');
    expect(m).toContain('tabindex="-1"');
    expect(text(m)).toBe('عنوان');
  });
});

describe('collage kit: class helpers', () => {
  it('builds scrap and cta classes from static names', () => {
    expect(scrapCls({ tone: 'red', edge: 'torn4' })).toContain('scrap-red');
    expect(scrapCls({ tone: 'red', edge: 'torn4' })).toContain('scrap-torn4');
    expect(ctaCls('sm')).toContain('min-h-11');
    expect(ctaCls('lg')).toContain('min-h-14');
  });
});

describe('collage kit: markup rules', () => {
  const pieces: Record<string, ReactElement> = {
    ScrapHeadline: h(ScrapHeadline, { text: 'كلمة اخرى هنا', animate: true }),
    SectionTitle: h(SectionTitle, { children: 'عنوان' }),
    Tag: h(Tag, null, 'وسم'),
    TapeLabel: h(Tape, null, 'شريط'),
    TapeStrip: h(Tape, { strip: 'clear' }),
    StepNumber: h(StepNumber, { n: 3 }),
    PaperCard: h(PaperCard, { tape: 'start' }, 'بطاقة'),
    MarkerCircle: h(MarkerCircle, null, '1,000'),
    PriceTag: h(PriceTag, { label: 'السعر', marker: true, tape: true, children: '1,000' }),
  };
  for (const [name, el] of Object.entries(pieces)) {
    it(`${name}: no rounded-full and no left/right words`, () => {
      const m = html(el);
      expect(m).not.toContain('rounded-full');
      expect(m).not.toMatch(/\b(left|right)\b/);
    });
  }

  it('StepNumber wraps the digit in an LTR island', () => {
    expect(html(h(StepNumber, { n: 12 }))).toContain('dir="ltr"');
  });
});
