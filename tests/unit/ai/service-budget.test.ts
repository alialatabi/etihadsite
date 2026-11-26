import { describe, expect, it } from 'vitest';
import { AI_OPENAI_TIMEOUT_MS } from '@/lib/ai/config';
import { openAiTimeoutMs, translateTimeoutMs } from '@/lib/ai/service';

describe('openAiTimeoutMs', () => {
  it('gives the full OpenAI timeout while the request is young', () => {
    expect(openAiTimeoutMs(0)).toBe(AI_OPENAI_TIMEOUT_MS);
    expect(openAiTimeoutMs(50_000)).toBe(AI_OPENAI_TIMEOUT_MS); // 120 - 50 - 20 = 50
  });

  it('shrinks to what is left of the 120 s route time, less 20 s for the save and the answer', () => {
    expect(openAiTimeoutMs(60_000)).toBe(40_000);
    expect(openAiTimeoutMs(75_000)).toBe(25_000);
    expect(openAiTimeoutMs(80_000)).toBe(20_000);
  });

  it('refuses to start when under 20 s of usable time is left', () => {
    expect(openAiTimeoutMs(80_001)).toBeNull();
    expect(openAiTimeoutMs(120_000)).toBeNull();
    expect(openAiTimeoutMs(240_000)).toBeNull();
  });

  it('treats a clock that went backwards as no time spent', () => {
    expect(openAiTimeoutMs(-500)).toBe(AI_OPENAI_TIMEOUT_MS);
  });
});

describe('translateTimeoutMs', () => {
  it('gives the translation its own 15 s while the request is young', () => {
    expect(translateTimeoutMs(0)).toBe(15_000);
    expect(translateTimeoutMs(65_000)).toBe(15_000);
  });

  it('keeps at least 20 s for the image call after it', () => {
    expect(translateTimeoutMs(70_000)).toBe(10_000);
    expect(translateTimeoutMs(75_000)).toBe(5_000);
  });

  it('does not start when under 5 s would be left for it', () => {
    expect(translateTimeoutMs(75_001)).toBeNull();
    expect(translateTimeoutMs(120_000)).toBeNull();
  });

  it('treats a clock that went backwards as no time spent', () => {
    expect(translateTimeoutMs(-500)).toBe(15_000);
  });
});
