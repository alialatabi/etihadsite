/**
 * Markup of the estimated progress bar and its two hosts, checked on the server-rendered HTML
 * (effects never run there, so the timer wrapper shows the first frame; the pure view takes elapsedMs).
 */
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { builder } from '@/content/ar';
import { AiProgress, AiProgressView } from '@/components/builder/ai/AiProgress';
import { AiResult } from '@/components/builder/ai/AiResult';
import { StartStep } from '@/components/builder/steps/StartStep';

type Props = Record<string, unknown>;
const render = (C: ComponentType<never>, props: Props) => renderToStaticMarkup(createElement(C as ComponentType<Props>, props));
const noop = () => {};

/** The text of the polite stage element; it must hold no tags (the bar is not inside it). */
const politeText = (html: string) => /<p aria-live="polite" aria-atomic="true"[^>]*>([^<]*)<\/p>/.exec(html)?.[1];

describe('AiProgressView', () => {
  it('image at 30 s: a progressbar outside the live stage text, brand fill, no physical sides', () => {
    const html = render(AiProgressView, { kind: 'image', elapsedMs: 30_000 });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain(`aria-label="${builder.ai.progress.label}"`);
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuenow="60"');
    expect(politeText(html)).toBe(builder.ai.progress.image[2]);
    expect(html.startsWith('<div aria-live="off"')).toBe(true);
    expect(html).toContain(builder.ai.progress.wait);
    expect(html).toMatch(/style="width:[\d.]+%"/);
    expect(html).toContain('motion-reduce:transition-none');
    expect(html).not.toMatch(/\b(left|right)\b/);
  });

  it('image at 70 s: the slow text replaces the stage text', () => {
    expect(politeText(render(AiProgressView, { kind: 'image', elapsedMs: 70_000 }))).toBe(builder.ai.progress.slow);
  });

  it('brief at 0: first stage, empty bar, no «can take a minute» line', () => {
    const html = render(AiProgressView, { kind: 'brief', elapsedMs: 0 });
    expect(politeText(html)).toBe(builder.ai.progress.brief[0]);
    expect(html).toContain('aria-valuenow="0"');
    expect(html).not.toContain(builder.ai.progress.wait);
  });
});

describe('AiProgress (timer wrapper)', () => {
  it('renders its first frame without a timer', () => {
    const html = render(AiProgress, { kind: 'brief' });
    expect(politeText(html)).toBe(builder.ai.progress.brief[0]);
    expect(html).toContain('aria-valuenow="0"');
  });

  it('a remount with a start in the past paints its real place on the first frame (not 0 %)', () => {
    const html = render(AiProgress, { kind: 'image', startedAt: Date.now() - 30_000 });
    expect(politeText(html)).toBe(builder.ai.progress.image[2]);
    expect(html).not.toContain('aria-valuenow="0"');
  });
});

describe('AiResult while generating', () => {
  it('shows the heading and the image progress inside the outer polite region', () => {
    const b = { shape: 'rect', mode: 'ai', aiLines: null, aiFileId: null, fileId: null, settings: DEFAULT_SETTINGS, chooseUpload: noop };
    const ai = { phase: 'generating', off: false, remainingToday: null, error: undefined, editIdea: noop };
    const html = render(AiResult, { b, ai });
    expect(html).toContain(builder.ai.generating);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain(builder.ai.progress.image[0]);
    expect(html).toContain(builder.ai.progress.wait);
    expect(html.indexOf('aria-live="polite"')).toBeLessThan(html.indexOf('aria-live="off"'));
  });
});

describe('StartStep while briefing', () => {
  const b = { mode: 'upload', shape: null, corners: 'rounded', settings: DEFAULT_SETTINGS, idea: '', setShape: noop, setCorners: noop, chooseUpload: noop, startAi: noop, showDesignStep: noop };
  const aiBase = {
    off: false,
    phase: 'idle',
    error: undefined,
    refs: [],
    refRejected: false,
    result: undefined,
    onIdeaChange: noop,
    addRefFiles: noop,
    removeRef: noop,
    review: noop,
  };

  it('shows the brief progress under the button', () => {
    const html = render(StartStep, { b, ai: { ...aiBase, block: 'busy', briefing: true } });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain(builder.ai.progress.brief[0]);
    expect(html).not.toContain(builder.ai.progress.wait);
  });

  it('shows no progress when idle', () => {
    const html = render(StartStep, { b, ai: { ...aiBase, block: null, briefing: false } });
    expect(html).not.toContain('role="progressbar"');
  });
});
