/**
 * The restore placeholder: aria-hidden, text-less, absolutely positioned over the invisible builder
 * column (so layout and focus order stay put), reduced-motion safe. Builder renders it only while
 * `b.restoring` and marks the column `invisible relative` only then (checked against the source below,
 * because Builder itself is too heavy to render in a unit test).
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RestoreSkeleton } from '@/components/builder/RestoreSkeleton';

describe('RestoreSkeleton', () => {
  const html = renderToStaticMarkup(createElement(RestoreSkeleton));

  it('is a decorative, text-less overlay', () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html.replace(/<[^>]*>/g, '')).toBe('');
    expect(html).not.toMatch(/tabindex|<(a|button|input)\b/i);
  });

  it('is absolutely positioned, uses the card tokens and only pulses when motion is allowed', () => {
    expect(html).toContain('absolute inset-0');
    expect(html).toContain('paper-card');
    expect(html).toContain('bg-news/60');
    expect(html).toContain('motion-safe:animate-pulse');
    expect(html).not.toMatch(/(^|[\s"])animate-pulse/);
  });
});

describe('Builder wiring', () => {
  const src = readFileSync('src/components/builder/Builder.tsx', 'utf8');

  it('shows the skeleton only while restoring, and the column stays invisible', () => {
    expect(src).toContain("b.restoring && 'invisible relative'");
    expect(src).toContain('{b.restoring && <RestoreSkeleton />}');
    expect(src).toContain('aria-busy={b.restoring || undefined}');
  });
});
