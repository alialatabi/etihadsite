import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiIpKey } from '@/lib/ai/ip';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('aiIpKey', () => {
  it('same ip same key', () => {
    expect(aiIpKey('1.2.3.4')).toBe(aiIpKey('1.2.3.4'));
  });

  it('different ip different key', () => {
    expect(aiIpKey('1.2.3.4')).not.toBe(aiIpKey('1.2.3.5'));
  });

  it('64 hex chars', () => {
    expect(aiIpKey('1.2.3.4')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not contain the raw ip', () => {
    expect(aiIpKey('203.0.113.9')).not.toContain('203');
  });

  it('key depends on SESSION_SECRET', () => {
    vi.stubEnv('SESSION_SECRET', 'secret-one-secret-one-secret-one-1');
    const a = aiIpKey('1.2.3.4');
    vi.stubEnv('SESSION_SECRET', 'secret-two-secret-two-secret-two-2');
    const b = aiIpKey('1.2.3.4');
    expect(a).not.toBe(b);
  });

  it('falls back to the dev salt when SESSION_SECRET is empty', () => {
    vi.stubEnv('SESSION_SECRET', '');
    expect(aiIpKey('1.2.3.4')).toMatch(/^[0-9a-f]{64}$/);
  });
});
