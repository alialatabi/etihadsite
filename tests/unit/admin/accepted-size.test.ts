import { describe, expect, it } from 'vitest';
import { aiAcceptedSize } from '@/lib/ai/accepted-size';
import * as builderLogic from '@/components/builder/logic';

describe('aiAcceptedSize (src/lib/ai/accepted-size.ts)', () => {
  it('is the very function the builder logic re-exports', () => {
    expect(builderLogic.aiAcceptedSize).toBe(aiAcceptedSize);
  });

  it('custom: the longer side of the trimmed design keeps the typed square', () => {
    const box = { widthUm: 50_000, heightUm: 50_000 };
    expect(aiAcceptedSize('custom', box, 1000 / 500)).toEqual({ widthUm: 50_000, heightUm: 25_000 });
    expect(aiAcceptedSize('custom', box, 400 / 1000)).toEqual({ widthUm: 20_000, heightUm: 50_000 });
    expect(aiAcceptedSize('custom', box, 1)).toEqual({ widthUm: 50_000, heightUm: 50_000 });
  });

  it('circle stays round; a rectangle keeps its width and the height follows the image', () => {
    expect(aiAcceptedSize('circle', { widthUm: 30_000, heightUm: 30_000 }, 1)).toEqual({ widthUm: 30_000, heightUm: 30_000 });
    expect(aiAcceptedSize('rect', { widthUm: 50_000, heightUm: 30_000 }, 1024 / 608)).toEqual({ widthUm: 50_000, heightUm: 29_688 });
  });
});
