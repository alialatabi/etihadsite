/**
 * The daily AI limit on the customer pages: the notice with the WhatsApp link (AiLimitNotice), its pure helpers, and
 * where it replaces the plain error (AiResult, StartStep). The staff page keeps its own texts (teamErrorText).
 * Rendered with react-dom/server; no JSX in the unit-test glob.
 */
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AI_LIMIT_IDEA_MAX, aiErrorMessage, aiLimitWhatsappText, isAiLimitError, isAiOffError } from '@/components/builder/ai/ai-logic';
import { AiLimitNotice } from '@/components/builder/ai/AiLimitNotice';
import { AiResult } from '@/components/builder/ai/AiResult';
import { StartStep } from '@/components/builder/steps/StartStep';
import { teamErrorText } from '@/components/team/team-logic';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { builder } from '@/content/ar';
import { STAFF_IMAGE_DAILY_LIMIT } from '@/lib/ai/config';

// StartStep's shape and size parts are not under test here.
vi.mock('@/components/builder/steps/ShapeStep', () => ({ ShapeStep: () => null }));
vi.mock('@/components/builder/steps/SizeFields', () => ({ SizeFields: () => null }));

type Props = Record<string, unknown>;
const render = (C: unknown, props: Props) => renderToStaticMarkup(createElement(C as ComponentType<Props>, props));

const NEW_TEXT = 'خلصت محاولات التصميم لليوم. راسلنا على الواتساب ونكمّل وياك التصميم، أو ارفع تصميم جاهز.';
const OLD_SITE_LIMIT = 'التصميم بالموقع وصل حده اليوم. ارجع باچر أو ارفع تصميم جاهز.';
const PREFILL = 'هلا، جربت أصمم ستيكر بالموقع وخلصت محاولاتي. فكرتي:';
const hrefOf = (html: string) => /href="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&') ?? null;

describe('limit helpers', () => {
  it('detects the two limit codes only', () => {
    expect(isAiLimitError('ip_limit')).toBe(true);
    expect(isAiLimitError('site_limit')).toBe(true);
    for (const c of ['blocked', 'unavailable', 'failed', 'refused', 'rate_limited', 'text_too_long'] as const) expect(isAiLimitError(c)).toBe(false);
  });
  it('an empty or blank idea leaves the prefill alone', () => {
    expect(aiLimitWhatsappText('')).toBe(PREFILL);
    expect(aiLimitWhatsappText('   \n ')).toBe(PREFILL);
  });
  it('appends the trimmed idea after a space', () => {
    expect(aiLimitWhatsappText('  ستيكر قطة  ')).toBe(`${PREFILL} ستيكر قطة`);
  });
  it('cuts a long idea at 300 code points', () => {
    expect(AI_LIMIT_IDEA_MAX).toBe(300);
    const out = aiLimitWhatsappText('أ'.repeat(500));
    expect(Array.from(out.slice(PREFILL.length + 1))).toHaveLength(300);
  });
  it('never splits an emoji at the cut (no lone surrogate, encodeURIComponent does not throw)', () => {
    const out = aiLimitWhatsappText('a'.repeat(299) + '😀' + 'b'.repeat(10));
    const idea = out.slice(PREFILL.length + 1);
    expect(idea).toBe('a'.repeat(299) + '😀');
    expect(() => encodeURIComponent(out)).not.toThrow();
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out)).toBe(false);
  });
});

describe('lone surrogates', () => {
  const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  it('a lone surrogate already in the idea (restored draft) becomes U+FFFD and the text is encodable', () => {
    const out = aiLimitWhatsappText('قطة \uD83D ثم \uDE00 وبعدين 😀');
    expect(() => encodeURIComponent(out)).not.toThrow();
    expect(out).toContain('�');
    expect(out.endsWith('😀')).toBe(true);
    expect(LONE.test(out)).toBe(false);
    expect(() => encodeURIComponent(aiLimitWhatsappText('\uD83D'))).not.toThrow();
  });
});

describe('copy', () => {
  it('ip_limit has the new text; site_limit (read by the staff page) is unchanged', () => {
    expect(builder.ai.errors.ip_limit).toBe(NEW_TEXT);
    expect(builder.ai.errors.site_limit).toBe(OLD_SITE_LIMIT);
    expect(aiErrorMessage('site_limit')).toBe(OLD_SITE_LIMIT);
    expect(builder.ai.limitWhatsapp.text).toBe(PREFILL);
    expect(builder.ai.limitWhatsapp.button).toBe('كمّل على الواتساب');
  });
  it('the staff page still shows its own limit texts', () => {
    expect(teamErrorText('site_limit')).toBe(OLD_SITE_LIMIT);
    const staffLimit = renderToStaticMarkup(createElement('div', null, teamErrorText('ip_limit')));
    expect(staffLimit).toContain('ارجع باچر');
    expect(staffLimit).toContain(String(STAFF_IMAGE_DAILY_LIMIT));
    expect(staffLimit).not.toContain(NEW_TEXT);
    expect(staffLimit).not.toContain('واتساب');
    expect(staffLimit).not.toContain('الواتساب');
  });
});

describe('AiLimitNotice', () => {
  it('shows the text and a WhatsApp link with the idea in the message', () => {
    const html = render(AiLimitNotice, { whatsapp: '9647701234567', idea: 'ستيكر قطة' });
    expect(html).toContain(NEW_TEXT);
    expect(html).toContain(builder.ai.limitWhatsapp.button);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('min-h-12');
    expect(hrefOf(html)).toBe(`https://wa.me/9647701234567?text=${encodeURIComponent(`${PREFILL} ستيكر قطة`)}`);
    // The link is a sibling of the box, not inside its paragraph.
    expect(html).not.toMatch(/<p[^>]*>(?:(?!<\/p>).)*<a /);
  });
  it('with an empty idea the message is the prefill alone', () => {
    expect(hrefOf(render(AiLimitNotice, { whatsapp: '9647701234567', idea: '' }))).toBe(`https://wa.me/9647701234567?text=${encodeURIComponent(PREFILL)}`);
  });
  it('without a shop number there is no link', () => {
    const html = render(AiLimitNotice, { whatsapp: '', idea: 'x' });
    expect(html).toContain(NEW_TEXT);
    expect(html).not.toContain('<a ');
  });
});

const noop = () => {};
const bStub = (over: Props = {}) => ({
  shape: 'rect',
  corners: 'square',
  mode: 'ai',
  aiLines: null,
  aiFileId: null,
  fileId: null,
  idea: 'ستيكر قطة',
  design: null,
  designError: null,
  decoding: false,
  settings: { ...DEFAULT_SETTINGS, whatsapp: '9647701234567' },
  spec: null,
  chooseUpload: noop,
  ...over,
});
const aiStub = (over: Props = {}) => ({
  phase: 'error',
  error: 'ip_limit',
  off: false,
  remainingToday: 0,
  result: undefined,
  busySince: null,
  refs: [],
  block: null,
  editIdea: noop,
  retry: noop,
  accept: noop,
  ...over,
});
const result = {
  previewUrl: 'blob:x',
  lines: [],
  pxWidth: 2000,
  pxHeight: 2000,
  madeFor: { shape: 'rect', widthUm: 50_000, heightUm: 50_000 },
};

describe('AiResult', () => {
  for (const code of ['ip_limit', 'site_limit']) {
    it(`error-only branch: ${code} shows the notice with the link and keeps the ready-design button`, () => {
      const html = render(AiResult, { b: bStub(), ai: aiStub({ error: code }) });
      expect(html).toContain(NEW_TEXT);
      expect(html).toContain('wa.me/9647701234567');
      expect(html).toContain(builder.ai.readyDesign);
      expect(html).toContain(builder.ai.editIdea);
    });
  }
  it('kept-result branch: the notice replaces the plain box and the ready-design button stays', () => {
    const html = render(AiResult, { b: bStub(), ai: aiStub({ error: 'ip_limit', result }) });
    expect(html).toContain(NEW_TEXT);
    expect(html).toContain('wa.me/9647701234567');
    expect(html).toContain(builder.ai.readyDesign);
    expect(html).toContain(builder.ai.accept);
  });
  it('other errors are unchanged: plain box, no link', () => {
    const html = render(AiResult, { b: bStub(), ai: aiStub({ error: 'failed' }) });
    expect(html).toContain(builder.ai.errors.failed);
    expect(html).not.toContain('wa.me');
  });
  it('without a shop number the limit shows the text and no link', () => {
    const html = render(AiResult, { b: bStub({ settings: { ...DEFAULT_SETTINGS, whatsapp: '' } }), ai: aiStub() });
    expect(html).toContain(NEW_TEXT);
    expect(html).not.toContain('wa.me');
  });
});

describe('StartStep', () => {
  it('site_limit (an off error) shows the limit notice with the link', () => {
    expect(isAiOffError('site_limit')).toBe(true);
    const html = render(StartStep, { b: bStub({ shape: null }), ai: aiStub({ phase: 'idle', error: 'site_limit', off: true }) });
    expect(html).toContain(NEW_TEXT);
    expect(html).toContain('wa.me/9647701234567');
    expect(html).not.toContain(builder.ai.unavailable);
    expect(html).toContain(builder.ai.readyDesign);
  });
  it('ip_limit after «عدّل الفكرة» (phase idle, not off) shows the notice with the link, not the plain alert', () => {
    const html = render(StartStep, { b: bStub({ shape: null }), ai: aiStub({ phase: 'idle', error: 'ip_limit', off: false }) });
    expect(html).toContain(NEW_TEXT);
    expect(html).toContain('wa.me/9647701234567');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });
  it('a non-limit brief error keeps the plain alert, no link', () => {
    const html = render(StartStep, { b: bStub({ shape: null }), ai: aiStub({ phase: 'idle', error: 'failed', off: false }) });
    expect(html).toContain(builder.ai.errors.failed);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('wa.me');
  });
  for (const error of ['blocked', 'unavailable', undefined]) {
    it(`off with ${String(error)} keeps the plain notice, no link`, () => {
      const html = render(StartStep, { b: bStub({ shape: null }), ai: aiStub({ phase: 'idle', error, off: true }) });
      expect(html).toContain(builder.ai.unavailable);
      expect(html).not.toContain('wa.me');
      expect(html).not.toContain(NEW_TEXT);
    });
  }
});
