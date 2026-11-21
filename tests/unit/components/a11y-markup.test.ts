/**
 * Accessibility attributes of the builder steps, checked on the server-rendered markup
 * (the unit-test glob is *.test.ts, so elements are built with createElement).
 */
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { builder, common } from '@/content/ar';
import { DesignStep } from '@/components/builder/steps/DesignStep';
import { DetailsStep } from '@/components/builder/steps/DetailsStep';
import { ShapeStep } from '@/components/builder/steps/ShapeStep';
import { EMPTY_FIELDS } from '@/components/builder/logic';

type Props = Record<string, unknown>;
const render = (C: ComponentType<never>, props: Props) => renderToStaticMarkup(createElement(C as ComponentType<Props>, props));
const noop = () => {};

const baseB = {
  mode: 'upload',
  shape: null,
  corners: 'rounded',
  design: null,
  decoding: false,
  designError: null,
  settings: DEFAULT_SETTINGS,
  setShape: noop,
  setCorners: noop,
  onFile: noop,
  summary: null,
  fields: EMPTY_FIELDS,
  customerErrors: {},
  setField: noop,
  marketingOptIn: false,
  setMarketingOptIn: noop,
};

const tabIndexes = (html: string) => [...html.matchAll(/role="radio"[^>]*?tabindex="(-?\d)"|tabindex="(-?\d)"[^>]*?role="radio"/g)].map((m) => Number(m[1] ?? m[2]));

describe('ShapeStep radio group', () => {
  it('keeps role=radio with a roving tabindex (first option while nothing is chosen)', () => {
    const html = render(ShapeStep as never, { b: baseB });
    expect(html).toContain('role="radiogroup"');
    expect(tabIndexes(html)).toEqual([0, -1, -1]);
  });
  it('makes the chosen option the only Tab stop', () => {
    const html = render(ShapeStep as never, { b: { ...baseB, shape: 'rect' } });
    expect(tabIndexes(html).slice(0, 3)).toEqual([-1, 0, -1]);
  });
});

describe('DesignStep upload', () => {
  it('hides the file input from assistive tech and always renders an empty status region', () => {
    const html = render(DesignStep as never, { b: baseB, ai: {} });
    expect(html).toMatch(/<input[^>]*id="design-file"[^>]*aria-hidden="true"/);
    expect(html).toContain('<p role="status" class="sr-only"></p>');
  });
  it('puts the loading text in that region while a file is being read', () => {
    const html = render(DesignStep as never, { b: { ...baseB, decoding: true }, ai: {} });
    expect(html).toContain(`<p role="status" class="sr-only">${common.status.loading}</p>`);
    // the old status role inside the disabled button is gone
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });
});

describe('DetailsStep', () => {
  const idle = { phase: 'idle', progress: 0, message: null };
  it('marks the required delivery fields and keeps an empty status region while idle', () => {
    const html = render(DetailsStep as never, { b: baseB, submit: idle, onSubmit: noop });
    expect(html.match(/aria-required="true"/g)).toHaveLength(3);
    expect(html).toMatch(/<p id="submit-status" role="status" class="sr-only"><\/p>/);
    expect(html).not.toContain('role="progressbar"');
  });
  it('names the progress bar after the phase text and keeps the percent out of the live region', () => {
    const html = render(DetailsStep as never, { b: baseB, submit: { phase: 'uploading', progress: 0.42, message: null }, onSubmit: noop });
    expect(html).toContain(`<p id="submit-status" role="status" class="sr-only">${common.status.uploading}</p>`);
    expect(html).toMatch(/role="progressbar"[^>]*aria-labelledby="submit-status"|aria-labelledby="submit-status"[^>]*role="progressbar"/);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('42%');
  });
});

describe('copy', () => {
  it('has the screen-reader prefix for the struck-through price', () => {
    expect(builder.quantity.beforeDiscountSr).toBe('السعر قبل الخصم:');
  });
});

describe('DesignStep AI result', () => {
  const aiB = { ...baseB, mode: 'ai', shape: 'circle' };
  const result = { previewUrl: 'blob:x', lines: [], madeFor: { shape: 'circle' } };
  const ai = { phase: 'result', result, remainingToday: 3, error: null, off: false };

  it('gives the design image a meaningful alt', () => {
    const html = render(DesignStep as never, { b: aiB, ai });
    expect(html).toContain(`alt="${builder.ai.resultAlt}"`);
    expect(html).not.toContain('alt=""');
  });
  it('makes the live region focusable (programmatically) so focus can return to it', () => {
    const html = render(DesignStep as never, { b: aiB, ai });
    expect(html).toMatch(/<div[^>]*tabindex="-1"[^>]*aria-live="polite"|<div[^>]*aria-live="polite"[^>]*tabindex="-1"/);
  });
});
