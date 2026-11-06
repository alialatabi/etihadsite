import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { computeExamples, illustrationLayout } from '@/app/how-it-works/examples';

describe('how-it-works examples', () => {
  const rows = computeExamples(DEFAULT_SETTINGS.layout);
  const get = (k: string) => rows.find((r) => r.key === k)?.count;

  it('3 cm circle gives 54 per sheet with default settings', () => {
    expect(get('circle3')).toBe(54);
  });
  it('every example fits on the sheet', () => {
    for (const r of rows) expect(r.count).toBeGreaterThan(0);
  });
  it('sharp rectangles pack at least as many as rounded', () => {
    expect(get('sharp5')!).toBeGreaterThanOrEqual(get('rounded5')!);
  });
  it('illustration layout matches the 3 cm circle count', () => {
    const l = illustrationLayout(DEFAULT_SETTINGS.layout);
    expect(l?.countPerSheet).toBe(54);
    expect(l?.placements).toHaveLength(54);
  });
});
