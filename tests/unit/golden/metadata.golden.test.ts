/**
 * GOLDEN — static metadata routes: src/app/manifest.ts, robots.ts, sitemap.ts.
 * The complete return values, with key order preserved (JSON text).
 *
 * Not covered: src/app/opengraph-image.tsx (needs next/og and renders an image) and the
 * `metadata` / `viewport` exports of src/app/layout.tsx (the module imports fonts and CSS,
 * which only the Next.js build can load).
 */
import { describe, expect, it } from 'vitest';
import manifest from '@/app/manifest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { sha256, visible } from './_util';

const text = (value: unknown): string => visible(JSON.stringify(value, null, 2));

describe('golden: static metadata functions', () => {
  it('manifest()', () => {
    const m = manifest();
    expect(text(m)).toMatchSnapshot();
    expect(sha256(JSON.stringify(m))).toMatchSnapshot();
  });

  it('robots()', () => {
    expect(text(robots())).toMatchSnapshot();
  });

  it('sitemap()', () => {
    expect(text(sitemap())).toMatchSnapshot();
  });

  it('each call returns a fresh, equal value', () => {
    expect({
      manifest: manifest() !== manifest() && JSON.stringify(manifest()) === JSON.stringify(manifest()),
      robots: robots() !== robots() && JSON.stringify(robots()) === JSON.stringify(robots()),
      sitemap: sitemap() !== sitemap() && JSON.stringify(sitemap()) === JSON.stringify(sitemap()),
    }).toMatchSnapshot();
  });
});
