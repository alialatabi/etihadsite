/**
 * GOLDEN — every user-visible string: the complete objects exported from '@/content/ar'
 * (common, builder, order, pages, admin, governorates and anything added later), in their
 * original key order, with functions serialised via toString().
 *
 * This is the "no visible text changed" guard. Invisible characters (bidi marks, NBSP, zero
 * width joiners, …) are written as <U+XXXX> so a lost one shows up in the diff, and a sha256
 * of the raw JSON is kept next to each export as a second check.
 *
 * Copy that is NOT in '@/content/ar' but hard-coded elsewhere (e.g. the shape labels in
 * src/lib/order-text.ts) is pinned by order-text-notify.golden.test.ts.
 */
import { describe, expect, it } from 'vitest';
import * as ar from '@/content/ar';
import { sha256, visible } from './_util';

const EXPORTS = ar as unknown as Record<string, unknown>;
const NAMES = Object.keys(EXPORTS).sort();

/** JSON text that keeps insertion order; functions become "[Function] <source>". */
function serialise(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'function' ? `[Function] ${v.toString()}` : v), 2);
}

/** Counts leaves and fails on anything JSON.stringify would silently drop or change. */
function census(value: unknown, at: string, acc = { strings: 0, numbers: 0, booleans: 0, nulls: 0, functions: 0, arrays: 0, objects: 0, chars: 0 }) {
  if (typeof value === 'string') {
    acc.strings++;
    acc.chars += value.length;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`non-finite number at ${at}`);
    acc.numbers++;
  } else if (typeof value === 'boolean') acc.booleans++;
  else if (value === null) acc.nulls++;
  else if (typeof value === 'function') acc.functions++;
  else if (Array.isArray(value)) {
    acc.arrays++;
    value.forEach((v, i) => census(v, `${at}[${i}]`, acc));
  } else if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) throw new Error(`non-plain object at ${at}`);
    if (Object.getOwnPropertySymbols(value).length) throw new Error(`symbol key at ${at}`);
    acc.objects++;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) census(v, `${at}.${k}`, acc);
  } else throw new Error(`unsupported ${typeof value} at ${at}`);
  return acc;
}

describe('golden: Arabic copy (@/content/ar)', () => {
  it('export names', () => {
    expect(NAMES.map((n) => `${n}: ${Array.isArray(EXPORTS[n]) ? 'array' : typeof EXPORTS[n]}`)).toMatchSnapshot();
  });

  for (const name of NAMES) {
    it(`export "${name}"`, () => {
      const value = EXPORTS[name];
      const raw = serialise(value);
      expect(visible(raw)).toMatchSnapshot();
      expect({ sha256OfRawJson: sha256(raw), ...census(value, name) }).toMatchSnapshot();
    });
  }

  it('fill() replaces {placeholders} and leaves unknown ones', () => {
    const cases: [string, Record<string, string | number>][] = [
      ['خصم {percent}%', { percent: 10 }],
      ['{a} و {b} و {a}', { a: 'أ', b: 2 }],
      ['{missing} stays', {}],
      ['{a}{b}', { a: '', b: 0 }],
      ['no placeholders', { a: 1 }],
      ['{ spaced } {a-b} {a.b} {1} {_x}', { ' spaced ': 1, 'a-b': 2, 'a.b': 3, 1: 'one', _x: 'under' }],
      ['{toString} {constructor}', {}],
      ['nested {{a}}', { a: 'x' }],
      ['{a}', { a: '{b}', b: 'no second pass' }],
      ['', { a: 1 }],
    ];
    expect(cases.map(([template, values]) => `${JSON.stringify(template)} + ${JSON.stringify(values)} -> ${JSON.stringify(visible(ar.fill(template, values)))}`)).toMatchSnapshot();
  });

  it('every {placeholder} used anywhere in the copy', () => {
    const found = new Map<string, number>();
    const walk = (v: unknown) => {
      if (typeof v === 'string') for (const m of v.matchAll(/\{(\w+)\}/g)) found.set(m[1], (found.get(m[1]) ?? 0) + 1);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(EXPORTS);
    expect([...found.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => `{${k}} x${n}`)).toMatchSnapshot();
  });
});
