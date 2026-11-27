import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('site font weights', () => {
  const layout = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');

  it('IBM Plex Sans Arabic loads 400, 500 and 700 only (600 would add two preloaded files to every page)', () => {
    const m = /IBM_Plex_Sans_Arabic\(\{\s*weight:\s*\[([^\]]*)\]/.exec(layout);
    expect(m).not.toBeNull();
    expect(m![1].match(/\d+/g)).toEqual(['400', '500', '700']);
  });
});
