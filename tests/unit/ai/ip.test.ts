import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiIpKey, aiLimitAddress } from '@/lib/ai/ip';

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

describe('aiLimitAddress', () => {
  it.each([
    '1.2.3.4',
    '203.0.113.7',
    '::ffff:198.51.100.4',
    '::ffff:c633:6404',
    '::FFFF:c633:6404',
    'fe80::1%eth0',
    '[2001:db8::1]',
    'not-an-ip',
    'global',
    '',
  ])('returns %j unchanged', (v) => {
    expect(aiLimitAddress(v)).toBe(v);
  });

  it('IPv4 keys are byte-identical to before', () => {
    expect(aiIpKey(aiLimitAddress('203.0.113.7'))).toBe(aiIpKey('203.0.113.7'));
  });

  it('maps every address in one /64 to the same value', () => {
    const a = aiLimitAddress('2001:db8:1:2:aaaa::1');
    expect(a).toBe('2001:db8:1:2::/64');
    expect(aiLimitAddress('2001:DB8:1:2:ffff:ffff:ffff:ffff')).toBe(a);
    expect(aiLimitAddress('2001:0db8:0001:0002::')).toBe(a);
  });

  it('different /64 prefixes differ', () => {
    expect(aiLimitAddress('2001:db8:1:3::1')).not.toBe(aiLimitAddress('2001:db8:1:2::1'));
  });

  it('handles compressed forms and loopback', () => {
    expect(aiLimitAddress('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(aiLimitAddress('2001:db8:0:0:1:2:3:4')).toBe('2001:db8:0:0::/64');
    expect(aiLimitAddress('::1')).toBe('0:0:0:0::/64');
    expect(aiLimitAddress('::')).toBe('0:0:0:0::/64');
    expect(aiLimitAddress('2001:db8:1:2:3:4::')).toBe('2001:db8:1:2::/64');
  });
});
