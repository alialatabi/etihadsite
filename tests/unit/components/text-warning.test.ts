/**
 * Too much text for the size is a warning and a recommendation, never a block: the shared note, and the review box's
 * confirm button (rendered with the markup helpers used by the other component tests; no JSX in the unit-test glob).
 */
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TextReview } from '@/components/builder/ai/TextReview';
import { TextWarningNote } from '@/components/builder/ai/TextWarningNote';
import { builder } from '@/content/ar';

type Props = Record<string, unknown>;
const render = (C: unknown, props: Props) => renderToStaticMarkup(createElement(C as ComponentType<Props>, props));

const noop = () => {};
const baseAi = { lines: ['عيد ميلاد سعيد', 'يا حبيبي'], fixes: [], block: null, setLines: noop, generate: noop };

/** The confirm button's opening tag. */
const confirmTag = (html: string) => {
  const at = html.indexOf(builder.ai.confirm);
  return html.slice(html.lastIndexOf('<button', at), at);
};

describe('TextWarningNote', () => {
  it('renders nothing without a warning', () => {
    expect(render(TextWarningNote, { warning: null })).toBe('');
  });
  it('shows the recommended size (Western digits, LTR) and a polite status role', () => {
    const html = render(TextWarningNote, { warning: { kind: 'enlarge', sizeUm: 45_000 } });
    expect(html).toContain('role="status"');
    expect(html).toContain('تنبيه: الكتابة كثيرة على هذا القياس');
    expect(html).toMatch(/dir="ltr"[^>]*>4\.5<\/span>|>4\.5</);
    expect(html).not.toContain('{size}');
    expect(html).toContain('تكدر تكمل هيج إذا تريد');
  });
  it('without a size that fits, only advises writing less', () => {
    const html = render(TextWarningNote, { warning: { kind: 'reduce' } });
    expect(html).toContain('role="status"');
    expect(html).toContain(builder.ai.tooMuchTextReduce);
    expect(html).not.toContain('لـ');
  });
});

describe('TextReview with too much text', () => {
  it('keeps the confirm button enabled and shows the warning, not an alert', () => {
    const html = render(TextReview, { ai: { ...baseAi, textWarning: { kind: 'enlarge', sizeUm: 45_000 } } });
    expect(confirmTag(html)).not.toContain(' disabled=""');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });
  it('still disables confirm for a real block (e.g. a try is running)', () => {
    const html = render(TextReview, { ai: { ...baseAi, textWarning: null, block: 'busy' } });
    expect(confirmTag(html)).toContain(' disabled=""');
  });
  it('shows no warning when the text fits', () => {
    const html = render(TextReview, { ai: { ...baseAi, textWarning: null } });
    expect(html).not.toContain('تنبيه: الكتابة كثيرة');
    expect(confirmTag(html)).not.toContain(' disabled=""');
  });
});
