/** The proxy's staff gate (src/proxy.ts) and the shared key comparison (src/lib/staff-gate.ts). */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config, proxy } from '@/proxy';
import { STAFF_KEY_HEADER, STAFF_KEY_MIN_LENGTH, STAFF_PAGE_ROUTE, configuredStaffKey, matchesStaffKey } from '@/lib/staff-gate';

const KEY = 'AbCdEfGhIjKlMnOpQrStUvWx1234';
const saved = process.env.STAFF_PAGE_KEY;
beforeEach(() => {
  process.env.STAFF_PAGE_KEY = KEY;
});
afterEach(() => {
  if (saved === undefined) delete process.env.STAFF_PAGE_KEY;
  else process.env.STAFF_PAGE_KEY = saved;
});

type Outcome = { kind: 'next' | 'rewrite' | 'other'; to?: string; headers: Headers };
async function run(url: string, init?: { headers?: Record<string, string> }): Promise<Outcome> {
  const res = await proxy(new NextRequest(url, init));
  const rewrite = res.headers.get('x-middleware-rewrite');
  if (rewrite) return { kind: 'rewrite', to: rewrite, headers: res.headers };
  return { kind: res.headers.get('x-middleware-next') === '1' ? 'next' : 'other', headers: res.headers };
}

describe('matchesStaffKey', () => {
  it('needs a configured key of at least 24 characters', () => {
    expect(STAFF_KEY_MIN_LENGTH).toBe(24);
    expect(configuredStaffKey(undefined)).toBeNull();
    expect(configuredStaffKey('x'.repeat(23))).toBeNull();
    expect(configuredStaffKey('x'.repeat(24))).toBe('x'.repeat(24));
    expect(matchesStaffKey('x'.repeat(23), 'x'.repeat(23))).toBe(false);
    expect(matchesStaffKey('', '')).toBe(false);
    expect(matchesStaffKey(undefined, undefined)).toBe(false);
  });

  it('is exact and case-sensitive; a non-string never matches', () => {
    expect(matchesStaffKey(KEY, KEY)).toBe(true);
    for (const c of [KEY.toLowerCase(), KEY.toUpperCase(), KEY.slice(0, -1), `${KEY}x`, ` ${KEY}`, '', undefined, null, 42, [KEY]]) {
      expect(matchesStaffKey(c, KEY)).toBe(false);
    }
  });
});

describe('proxy: /staff', () => {
  it('the matcher covers /staff/* and the real route (matchers must be literals)', () => {
    expect(config.matcher).toContain('/staff/:path*');
    expect(config.matcher).toContain(STAFF_PAGE_ROUTE);
  });

  it('the right key is rewritten to the real page, with the key header and the privacy headers', async () => {
    const o = await run(`https://softy.iq/staff/${KEY}?x=1`, { headers: { [STAFF_KEY_HEADER]: 'forged' } });
    expect(o.kind).toBe('rewrite');
    expect(o.to).toBe(`https://softy.iq${STAFF_PAGE_ROUTE}`);
    expect(o.headers.get(`x-middleware-request-${STAFF_KEY_HEADER}`)).toBe(KEY);
    expect(o.headers.get('referrer-policy')).toBe('no-referrer');
    expect(o.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('the right key, percent-encoded, is decoded the way a page param would be', async () => {
    const key = 'key with space and / slash-1234';
    process.env.STAFF_PAGE_KEY = key;
    const o = await run(`https://softy.iq/staff/${encodeURIComponent(key)}`);
    expect(o.kind).toBe('rewrite');
    expect(o.headers.get(`x-middleware-request-${STAFF_KEY_HEADER}`)).toBe(key);
  });

  it('anything else under /staff passes through untouched (no route matches it: an unknown URL)', async () => {
    for (const path of [
      '/staff',
      '/staff/',
      '/staff/wrong-key-wrong-key-wrong-key',
      `/staff/${KEY.toLowerCase()}`,
      `/staff/${KEY.slice(0, -1)}`,
      `/staff/${KEY}x`,
      `/staff/${KEY}/extra`,
      `/staff/x/${KEY}`,
      '/staff/%E0%A4%A',
      '/staff.json',
      `${STAFF_PAGE_ROUTE}/x`,
    ]) {
      const o = await run(`https://softy.iq${path}?q=1`, { headers: { [STAFF_KEY_HEADER]: KEY } });
      expect(o.kind, path).toBe('next');
      expect(o.headers.get(`x-middleware-request-${STAFF_KEY_HEADER}`), path).toBeNull();
      expect(o.headers.get('referrer-policy'), path).toBeNull();
      expect(o.headers.get('x-robots-tag'), path).toBeNull();
    }
  });

  it('the real route asked for directly becomes an unknown URL, even with a key header', async () => {
    const o = await run(`https://softy.iq${STAFF_PAGE_ROUTE}`, { headers: { [STAFF_KEY_HEADER]: KEY } });
    expect(o.kind).toBe('rewrite');
    expect(o.to).toBe(`https://softy.iq${STAFF_PAGE_ROUTE}/not-found`);
    expect(o.headers.get(`x-middleware-request-${STAFF_KEY_HEADER}`)).toBeNull();
  });

  it('a missing or short STAFF_PAGE_KEY: even the "right" key passes through to no route', async () => {
    delete process.env.STAFF_PAGE_KEY;
    expect((await run(`https://softy.iq/staff/${KEY}`)).kind).toBe('next');
    process.env.STAFF_PAGE_KEY = KEY.slice(0, 23);
    expect((await run(`https://softy.iq/staff/${KEY.slice(0, 23)}`)).kind).toBe('next');
  });
});
