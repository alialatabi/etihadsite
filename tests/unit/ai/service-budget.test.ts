import { describe, expect, it } from 'vitest';
import { AI_OPENAI_TIMEOUT_MS } from '@/lib/ai/config';
import { AI_EXTEND_FINISH_RESERVE_MS, AI_MIN_EXTEND_BUDGET_MS, AI_ROUTE_MAX_DURATION_MS } from '@/lib/ai/config';
import { extendTimeLeftMs, openAiTimeoutMs, translateTimeoutMs } from '@/lib/ai/service';

describe('openAiTimeoutMs', () => {
  it('the route runs 300 s', () => {
    expect(AI_ROUTE_MAX_DURATION_MS).toBe(300_000);
  });

  it('gives the full OpenAI timeout while the request is young', () => {
    expect(openAiTimeoutMs(0)).toBe(AI_OPENAI_TIMEOUT_MS);
    expect(openAiTimeoutMs(230_000)).toBe(AI_OPENAI_TIMEOUT_MS); // 300 - 230 - 20 = 50
  });

  it('shrinks to what is left of the 300 s route time, ', () => {
    expect(openAiTimeoutMs(240_000)).toBe(40_000);
    expect(openAiTimeoutMs(255_000)).toBe(25_000);
    expect(openAiTimeoutMs(260_000)).toBe(20_000);
  });

  it('refuses to start when under 20 s of usable time is left', () => {
    expect(openAiTimeoutMs(260_001)).toBeNull();
    expect(openAiTimeoutMs(300_000)).toBeNull();
    expect(openAiTimeoutMs(420_000)).toBeNull();
  });

  it('treats a clock that went backwards as no time spent', () => {
    expect(openAiTimeoutMs(-500)).toBe(AI_OPENAI_TIMEOUT_MS);
  });
});

describe('translateTimeoutMs', () => {
  it('gives the translation its own 15 s while the request is young', () => {
    expect(translateTimeoutMs(0)).toBe(15_000);
    expect(translateTimeoutMs(245_000)).toBe(15_000);
  });

  it('keeps at least 20 s for the image call after it', () => {
    expect(translateTimeoutMs(250_000)).toBe(10_000);
    expect(translateTimeoutMs(255_000)).toBe(5_000);
  });

  it('does not start when under 5 s would be left for it', () => {
    expect(translateTimeoutMs(255_001)).toBeNull();
    expect(translateTimeoutMs(300_000)).toBeNull();
  });

  it('treats a clock that went backwards as no time spent', () => {
    expect(translateTimeoutMs(-500)).toBe(15_000);
  });
});

describe('extendTimeLeftMs (outpainting deadline)', () => {
  it('is the route time less the 20 s safety and the 20 s reserve for joining, blur-filling and encoding', () => {
    expect(AI_EXTEND_FINISH_RESERVE_MS).toBe(20_000);
    expect(extendTimeLeftMs(0)).toBe(260_000);
    expect(extendTimeLeftMs(100_000)).toBe(160_000);
  });

  it('a call needs AI_MIN_EXTEND_BUDGET_MS: none starts after 245 s', () => {
    expect(extendTimeLeftMs(245_000)).toBe(AI_MIN_EXTEND_BUDGET_MS);
    expect(extendTimeLeftMs(245_001)).toBeLessThan(AI_MIN_EXTEND_BUDGET_MS);
  });

  it('a clock that went backwards counts as no time spent', () => {
    expect(extendTimeLeftMs(-1_000)).toBe(260_000);
  });
});
