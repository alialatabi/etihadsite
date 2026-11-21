import { describe, expect, it } from 'vitest';
import { AI_OPENAI_TIMEOUT_MS } from '@/lib/ai/config';
import { openAiTimeoutMs } from '@/lib/ai/service';

describe('openAiTimeoutMs', () => {
  it('gives the full OpenAI timeout while the request is young', () => {
    expect(openAiTimeoutMs(0)).toBe(AI_OPENAI_TIMEOUT_MS);
    expect(openAiTimeoutMs(5_000)).toBe(AI_OPENAI_TIMEOUT_MS); // 60 - 5 - 5 = 50
  });

  it('shrinks to what is left of the 60 s route time, less 5 s for the save', () => {
    expect(openAiTimeoutMs(10_000)).toBe(45_000);
    expect(openAiTimeoutMs(30_000)).toBe(25_000);
    expect(openAiTimeoutMs(45_000)).toBe(10_000);
  });

  it('refuses to start when under 10 s of usable time is left', () => {
    expect(openAiTimeoutMs(45_001)).toBeNull();
    expect(openAiTimeoutMs(60_000)).toBeNull();
    expect(openAiTimeoutMs(120_000)).toBeNull();
  });

  it('treats a clock that went backwards as no time spent', () => {
    expect(openAiTimeoutMs(-500)).toBe(AI_OPENAI_TIMEOUT_MS);
  });
});
