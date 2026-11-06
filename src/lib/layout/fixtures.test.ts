import { describe, expect, it } from 'vitest';
import cases from '@/lib/__fixtures__/layout-cases.json';
import { computeLayout } from './index';
import type { LayoutOutcome, LayoutParams, StickerSpec } from '@/lib/types';

/** Every fixture case must match EXACTLY. Agent A: keep this file green while hardening the engine. */
describe('computeLayout fixtures', () => {
  for (const c of cases) {
    it(c.name, () => {
      const outcome = computeLayout(c.spec as StickerSpec, c.params as LayoutParams);
      expect(outcome).toEqual(c.expected as LayoutOutcome);
    });
  }
});
