import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StickerMark } from '@/components/collage';

describe('StickerMark', () => {
  it('imports the logo statically (content-hashed optimizer source), not by a string path', () => {
    const src = readFileSync('src/components/collage/StickerMark.tsx', 'utf8');
    expect(src).toMatch(/import softyMark from '[^']*public\/brand\/softy-mark\.png'/);
    expect(src).toMatch(/src=\{softyMark\}/);
    expect(src).not.toContain('src="/brand/softy-mark.png"');
  });

  it('keeps the explicit size, tilt clamp and edge class', () => {
    const m = renderToStaticMarkup(h(StickerMark, { size: 36, tilt: -99 }));
    expect(m).toContain('width="36"');
    expect(m).toContain('height="36"');
    expect(m).toContain('rotate:-10deg');
    expect(m).toContain('sticker-edge-sm');
    expect(m).toContain('alt=""');
  });
});
