import { afterEach, describe, expect, it } from 'vitest';
import { isStaffKey, staffPagePath } from '@/lib/staff-key';

const KEY = 'AbCdEfGhIjKlMnOpQrStUvWx1234';
const saved = process.env.STAFF_PAGE_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.STAFF_PAGE_KEY;
  else process.env.STAFF_PAGE_KEY = saved;
});

describe('isStaffKey', () => {
  it('is false when STAFF_PAGE_KEY is missing, even for an empty or undefined candidate', () => {
    delete process.env.STAFF_PAGE_KEY;
    expect(isStaffKey(KEY)).toBe(false);
    expect(isStaffKey('')).toBe(false);
    expect(isStaffKey(undefined)).toBe(false);
  });

  it('is false when the configured key is shorter than 24 characters', () => {
    process.env.STAFF_PAGE_KEY = 'x'.repeat(23);
    expect(isStaffKey('x'.repeat(23))).toBe(false);
    process.env.STAFF_PAGE_KEY = '';
    expect(isStaffKey('')).toBe(false);
  });

  it('accepts a 24-character key exactly', () => {
    process.env.STAFF_PAGE_KEY = 'k'.repeat(24);
    expect(isStaffKey('k'.repeat(24))).toBe(true);
  });

  it('rejects a wrong key, a prefix, an extension and a different case', () => {
    process.env.STAFF_PAGE_KEY = KEY;
    expect(isStaffKey('wrong-key-wrong-key-wrong-key')).toBe(false);
    expect(isStaffKey(KEY.slice(0, -1))).toBe(false);
    expect(isStaffKey(`${KEY}x`)).toBe(false);
    expect(isStaffKey(KEY.toLowerCase())).toBe(false);
    expect(isStaffKey(KEY.toUpperCase())).toBe(false);
    expect(isStaffKey(undefined)).toBe(false);
  });

  it('accepts the right key', () => {
    process.env.STAFF_PAGE_KEY = KEY;
    expect(isStaffKey(KEY)).toBe(true);
  });
});

describe('staffPagePath', () => {
  it('is null when the key is missing or short, else /staff/<key>', () => {
    delete process.env.STAFF_PAGE_KEY;
    expect(staffPagePath()).toBeNull();
    process.env.STAFF_PAGE_KEY = 'short';
    expect(staffPagePath()).toBeNull();
    process.env.STAFF_PAGE_KEY = KEY;
    expect(staffPagePath()).toBe(`/staff/${KEY}`);
  });
});
