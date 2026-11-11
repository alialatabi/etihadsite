/**
 * Markup equivalence for the shared <Money /> component and for fillLtr() after it replaced
 * builder/fillNodes.tsx and two hand-rolled template splits. Each case renders the code as it
 * was before (copied below) and the shared helper, and expects the same HTML string.
 * No JSX here (the unit-test glob is *.test.ts), so elements are built with createElement.
 */
import { createElement, Fragment, type FunctionComponent, type ReactNode } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { builder, common } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { Money } from '@/components/Money';
import { fillLtr } from '@/components/fill-ltr';
import { formatIqd } from '@/lib/pricing';

/** Static markup, plus the streaming-server markup (it keeps the separators between text nodes). */
const markup = (node: ReactNode) => {
  const el = createElement('p', null, node);
  return { static: renderToStaticMarkup(el), server: renderToString(el) };
};

/* ───────────── the code as it was before ───────────── */

/** <Ltr>, typed so createElement accepts the children as arguments (what JSX children compile to). */
const LtrEl = Ltr as FunctionComponent<{ children?: ReactNode }>;

/** The inline fragment every money site rendered: `<><Ltr>{formatIqd(n)}</Ltr> {common.units.iqd}</>`. */
const oldMoney = (n: number) => createElement(Fragment, null, createElement(LtrEl, null, formatIqd(n)), ' ', common.units.iqd);

/** src/components/builder/fillNodes.tsx, as deleted. */
function oldFillNodes(template: string, values: Record<string, string | number>): ReactNode {
  const parts = template.split(/(\{\w+\})/g);
  return parts.map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (m && m[1] in values) return createElement(LtrEl, { key: i }, String(values[m[1]]));
    return createElement(Fragment, { key: i }, part);
  });
}

/** QuantityStep "about {price} per sticker", as it was (inside its `<> · …</>` wrapper). */
const oldPerSticker = (price: number) =>
  createElement(
    Fragment,
    null,
    ' · ',
    builder.quantity.perSticker
      .split('{price}')
      .map((part, i, a) => createElement(Fragment, { key: i }, part, i < a.length - 1 && oldMoney(price))),
  );

/** Home page hero subtitle with the bold shop name, as it was. */
const oldSubtitle = (shopName: string) =>
  builder.hero.subtitle
    .split('{shop}')
    .map((part, i) =>
      createElement(Fragment, { key: i }, i > 0 && createElement('span', { className: 'font-bold text-foreground' }, shopName), part),
    );

/* ───────────── inputs ───────────── */

const AMOUNTS = [0, 1, 250, 999, 1000, 1500, 25_000, 1_234_567, -500, 1275.5];

/** Every string in the builder copy, with its key path. */
function leaves(node: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof node === 'string') out.push([path, node]);
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) leaves(v, path ? `${path}.${k}` : k, out);
  return out;
}
const placeholdersOf = (template: string) => [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];

const BUILDER_TEMPLATES = leaves(builder, 'builder');
/** No builder string has two placeholders today, so these cover that shape (and the edge positions). */
const TWO_PLACEHOLDER_TEMPLATES: [string, string][] = [
  ['adjacent', '{a}{b}'],
  ['separated', 'x {a} y {b} z'],
  ['at both ends', '{a} - {b}'],
  ['repeated', '{a} + {a} = {b}'],
  ['with markup characters', '<{a}> & "{b}"'],
];

/** Value sets tried for a template: none, text, numbers, and (for two names) only the first. */
function valueSets(names: string[]): Record<string, string | number>[] {
  const text = Object.fromEntries(names.map((n, i) => [n, `v${i} 3 × 4.2 <&>`]));
  const numbers = Object.fromEntries(names.map((n, i) => [n, (i + 1) * 1234.5]));
  const sets: Record<string, string | number>[] = [{}, text, numbers];
  if (names.length > 1) sets.push({ [names[0]]: 7 });
  return sets;
}

/* ───────────── tests ───────────── */

describe('<Money /> renders the old inline fragment', () => {
  it.each(AMOUNTS)('amount %s', (amount) => {
    expect(markup(createElement(Money, { amount }))).toEqual(markup(oldMoney(amount)));
  });

  it('keeps the same text nodes next to a sibling', () => {
    const suffix = builder.quantity.perSheetSuffix;
    expect(markup(createElement(Fragment, null, createElement(Money, { amount: 1500 }), ' ', suffix))).toEqual(
      markup(createElement(Fragment, null, oldMoney(1500), ' ', suffix)),
    );
  });
});

describe('fillLtr renders what fillNodes rendered', () => {
  it('the builder copy has templates with no placeholder and with one', () => {
    const counts = new Set(BUILDER_TEMPLATES.map(([, t]) => placeholdersOf(t).length));
    expect(BUILDER_TEMPLATES.length).toBeGreaterThan(50);
    expect(counts.has(0)).toBe(true);
    expect(counts.has(1)).toBe(true);
  });

  it.each([...BUILDER_TEMPLATES, ...TWO_PLACEHOLDER_TEMPLATES])('%s', (_name, template) => {
    for (const values of valueSets(placeholdersOf(template))) {
      expect(markup(fillLtr(template, values)), JSON.stringify(values)).toEqual(markup(oldFillNodes(template, values)));
    }
  });

  it('two-placeholder templates really have two', () => {
    for (const [, t] of TWO_PLACEHOLDER_TEMPLATES) expect(placeholdersOf(t)).toHaveLength(2);
  });
});

describe('the two former hand-rolled splits', () => {
  it.each(AMOUNTS)('QuantityStep per-sticker price %s', (price) => {
    const now = createElement(Fragment, null, ' · ', fillLtr(builder.quantity.perSticker, { price: createElement(Money, { amount: price }) }));
    expect(markup(now)).toEqual(markup(oldPerSticker(price)));
  });

  it.each([DEFAULT_SETTINGS.shopName, 'Softy', 'A & B <shop>', '$& $1 {shop}', ''])('home hero subtitle, shop name %j', (shopName) => {
    const now = fillLtr(builder.hero.subtitle, { shop: createElement('span', { className: 'font-bold text-foreground' }, shopName) });
    expect(markup(now)).toEqual(markup(oldSubtitle(shopName)));
  });

  it('an element value is inserted as it is, not wrapped in <Ltr>', () => {
    expect(renderToStaticMarkup(createElement('p', null, fillLtr('a {x} b', { x: createElement('em', null, 'e') })))).toBe('<p>a <em>e</em> b</p>');
    expect(renderToStaticMarkup(createElement('p', null, fillLtr('a {x} b', { x: 5 })))).toBe(
      '<p>a <bdi dir="ltr" class="tabular-nums">5</bdi> b</p>',
    );
  });
});
