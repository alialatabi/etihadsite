/**
 * GOLDEN (extra, not in the original list) — small shared server helpers that the route
 * tests only reach indirectly: lib/rate-limit.ts, lib/env.ts, lib/auth/token.ts +
 * session.ts (checkPassword), app/api/_lib/body.ts, the admin proxy (src/proxy.ts) and the
 * browser-side logClient().
 *
 * Clocks are injected (rate limiter, tokens); the proxy test, which reads the clock itself,
 * runs under a frozen Date. Nothing is masked. The session tokens are signed with the repo's
 * test secret; only their decoded parts and a hash are stored.
 */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));

import { BodyTooLarge, declaredLength, readCapped, readJsonCapped } from '@/app/api/_lib/body';
import { logClient } from '@/components/builder/logClient';
import { checkPassword } from '@/lib/auth/session';
import { COOKIE_NAME, SESSION_TTL_SEC, signToken, verifyToken } from '@/lib/auth/token';
import { getAdminEnv, getEnv, getOrderEnv } from '@/lib/env';
import { clientIp, createRateLimiter, limiters, trustProxyHops } from '@/lib/rate-limit';
import { config as proxyConfig, proxy } from '@/proxy';
import { SECRET } from '../server/helpers';
import { canon, sha256, show } from './_util';

const ENV_KEYS = [
  'STORAGE', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'DATA_DIR', 'ORDER_TRANSPORT', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TURNSTILE_SECRET_KEY', 'TRUST_PROXY',
  'ADMIN_PASSWORD', 'SESSION_SECRET',
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
}
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  (globalThis as { __epLimiters?: unknown }).__epLimiters = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const attempt = (fn: () => unknown): string => {
  try {
    const v = fn();
    return typeof v === 'string' ? v : show(v);
  } catch (e) {
    return `THROWS ${(e as Error).message}`;
  }
};

describe('golden: rate limiter', () => {
  it('sliding window with an injected clock', () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ limit: 3, windowMs: 10_000, now: () => t });
    const steps: [number, string][] = [
      [0, 'a'], [100, 'a'], [200, 'a'], [300, 'a'], [300, 'b'], [5_000, 'a'], [9_999, 'a'], [10_000, 'a'], [10_050, 'a'], [10_100, 'a'], [10_199, 'a'], [10_200, 'a'], [10_201, 'a'],
      [19_000, ''], [19_000, ''], [19_000, ''], [19_000, ''], [40_000, 'a'],
    ];
    const rows = steps.map(([at, key]) => {
      t = 1_000_000 + at;
      const r = rl.check(key);
      return `t=${at} key=${show(key)} -> ok=${r.ok} retryAfterSec=${r.retryAfterSec}`;
    });
    expect(rows).toMatchSnapshot();
  });

  it('limit 0 and limit 1', () => {
    const zero = createRateLimiter({ limit: 0, windowMs: 1_000, now: () => 5 });
    const one = createRateLimiter({ limit: 1, windowMs: 1_500, now: () => 5 });
    expect({ zero: attempt(() => zero.check('k')), oneFirst: one.check('k'), oneSecond: one.check('k') }).toMatchSnapshot();
  });

  it('clientIp / trustProxyHops', () => {
    const r = (xff?: string) => new Request('http://x', { headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });
    const XFF = [undefined, '', '1.2.3.4', ' 1.2.3.4 ', 'spoofed, 1.2.3.4, 10.0.0.1', 'a,,b, ,c', ',', '2001:db8::1, 10.0.0.1'];
    const rows: string[] = [];
    for (const xff of XFF) rows.push(`${show(xff)} -> ${[0, 1, 2, 3, 5, -1].map((h) => `hops${h}=${clientIp(r(xff), h)}`).join(' ')}`);
    const hops: string[] = [];
    for (const v of [undefined, '', '0', '1', '2', '10', '11', '999', '-1', '1.5', 'abc', ' 2 ', '0x2', '1e1']) {
      if (v === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = v;
      hops.push(`TRUST_PROXY=${show(v)} -> hops=${trustProxyHops()} clientIp=${clientIp(r('9.9.9.9, 8.8.8.8, 7.7.7.7'))}`);
    }
    expect({ rows, hops }).toMatchSnapshot();
  });

  it('limiters(): the limits per route in both modes, and when the set is rebuilt', () => {
    const capacity = (name: 'upload' | 'order' | 'log' | 'login') => {
      const l = limiters()[name];
      let n = 0;
      while (n < 5_000 && l.check('probe').ok) n++;
      return n;
    };
    process.env.TRUST_PROXY = '1';
    (globalThis as { __epLimiters?: unknown }).__epLimiters = undefined;
    const perIp = { mode: limiters().mode, upload: capacity('upload'), order: capacity('order'), log: capacity('log'), login: capacity('login') };
    const same = limiters() === limiters();
    process.env.TRUST_PROXY = '3';
    const stillSameForOtherHopCount = limiters().order.check('probe').ok === false;
    process.env.TRUST_PROXY = '0';
    const global = { mode: limiters().mode, upload: capacity('upload'), order: capacity('order'), log: capacity('log'), login: capacity('login') };
    process.env.TRUST_PROXY = '1';
    const rebuiltOnModeChange = limiters().order.check('probe').ok;
    expect({ perIp, same, stillSameForOtherHopCount, global, rebuiltOnModeChange }).toMatchSnapshot();
  });
});

describe('golden: env', () => {
  const GOOD_ADMIN = { ADMIN_PASSWORD: 'admin1234', SESSION_SECRET: 'k'.repeat(40) };
  it('getOrderEnv table', () => {
    const cases: [string, Partial<Record<(typeof ENV_KEYS)[number], string>>][] = [
      ['nothing set', {}],
      ['blank strings count as unset', { STORAGE: '  ', DATA_DIR: '', ORDER_TRANSPORT: ' ', TRUST_PROXY: '', TELEGRAM_BOT_TOKEN: ' ' }],
      ['everything set', { STORAGE: 'supabase', SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SECRET_KEY: 'sk', DATA_DIR: '/data', ORDER_TRANSPORT: 'telegram', TELEGRAM_BOT_TOKEN: '1:a', TELEGRAM_CHAT_ID: '5', TURNSTILE_SECRET_KEY: 't', TRUST_PROXY: '2' }],
      ['values are not trimmed', { DATA_DIR: ' ./d ', TELEGRAM_CHAT_ID: ' 5 ' }],
      ['TRUST_PROXY 10', { TRUST_PROXY: '10' }],
      ['TRUST_PROXY 11', { TRUST_PROXY: '11' }],
      ['TRUST_PROXY -1', { TRUST_PROXY: '-1' }],
      ['TRUST_PROXY 1.5', { TRUST_PROXY: '1.5' }],
      ['TRUST_PROXY abc', { TRUST_PROXY: 'abc' }],
      ['TRUST_PROXY " 2 "', { TRUST_PROXY: ' 2 ' }],
      ['unknown STORAGE', { STORAGE: 'blob' }],
      ['upper-case STORAGE', { STORAGE: 'LOCAL' }],
      ['unknown ORDER_TRANSPORT', { ORDER_TRANSPORT: 'email' }],
      ['two invalid values', { STORAGE: 'x', ORDER_TRANSPORT: 'y' }],
      ['admin secrets are not needed (and not returned)', GOOD_ADMIN],
    ];
    expect(
      cases.map(([label, values]) => {
        setEnv(values);
        return `${label} -> ${attempt(() => canon(getOrderEnv()))}`;
      }),
    ).toMatchSnapshot();
  });
  it('getAdminEnv / getEnv table', () => {
    const cases: [string, Partial<Record<(typeof ENV_KEYS)[number], string>>][] = [
      ['nothing set', {}],
      ['valid', GOOD_ADMIN],
      ['password 7 chars', { ...GOOD_ADMIN, ADMIN_PASSWORD: '1234567' }],
      ['password 8 chars', { ...GOOD_ADMIN, ADMIN_PASSWORD: '12345678' }],
      ['password placeholder', { ...GOOD_ADMIN, ADMIN_PASSWORD: 'change-me' }],
      ['password starts with the placeholder', { ...GOOD_ADMIN, ADMIN_PASSWORD: 'Change-Me-Please' }],
      ['password contains but does not start with it', { ...GOOD_ADMIN, ADMIN_PASSWORD: 'i-will-change-me' }],
      ['secret 31 chars', { ...GOOD_ADMIN, SESSION_SECRET: 'k'.repeat(31) }],
      ['secret 32 chars', { ...GOOD_ADMIN, SESSION_SECRET: 'k'.repeat(32) }],
      ['secret placeholder (long enough)', { ...GOOD_ADMIN, SESSION_SECRET: 'change-me-to-a-long-random-string' }],
      ['secret example value (too short anyway)', { ...GOOD_ADMIN, SESSION_SECRET: 'generate-a-secret-see-comment' }],
      ['blank password is NOT treated as unset here', { ...GOOD_ADMIN, ADMIN_PASSWORD: '        ' }],
      ['both invalid', { ADMIN_PASSWORD: 'x', SESSION_SECRET: 'y' }],
      ['admin valid, order env invalid', { ...GOOD_ADMIN, STORAGE: 'blob' }],
    ];
    expect(
      cases.map(([label, values]) => {
        setEnv(values);
        return `${label} -> admin: ${attempt(() => canon(getAdminEnv()))} | all: ${attempt(() => Object.keys(getEnv()).join(','))}`;
      }),
    ).toMatchSnapshot();
  });
});

describe('golden: admin session token', () => {
  const T0 = Date.UTC(2026, 10, 10, 9, 0, 0);
  const decode = (token: string) => token.split('.').slice(0, 2).map((p) => Buffer.from(p, 'base64url').toString('utf8'));

  it('signToken is deterministic for (secret, time, ttl)', async () => {
    const a = await signToken(SECRET, T0);
    const b = await signToken(SECRET, T0);
    const c = await signToken(SECRET, T0 + 999); // same second
    const d = await signToken(SECRET, T0 + 1_000);
    const short = await signToken(SECRET, T0, 60);
    const other = await signToken('y'.repeat(40), T0);
    expect({
      COOKIE_NAME,
      SESSION_TTL_SEC,
      parts: decode(a),
      shortTtlPayload: decode(short)[1],
      tokenSha256: sha256(a),
      sameInputsSameToken: a === b,
      sameSecondSameToken: a === c,
      nextSecondDiffers: a !== d,
      otherSecretSamePayloadOtherSignature: decode(a)[1] === decode(other)[1] && a !== other,
    }).toMatchSnapshot();
  });

  it('verifyToken table', async () => {
    const token = await signToken(SECRET, T0);
    const [h, p, s] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ role: 'admin', iat: 1, exp: 9_999_999_999 })).toString('base64url');
    const noneAlg = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`;
    const userRole = await (async () => {
      const { SignJWT } = await import('jose');
      return new SignJWT({ role: 'user' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt(T0 / 1_000).setExpirationTime(T0 / 1_000 + 60).sign(new TextEncoder().encode(SECRET));
    })();
    const day = 24 * 3600 * 1000;
    const cases: [string, string | undefined, string | undefined, number][] = [
      ['valid, same instant', token, SECRET, T0],
      ['valid, 1 s before issue (not rejected: no nbf)', token, SECRET, T0 - 1_000],
      ['valid, 7 days minus 1 s', token, SECRET, T0 + 7 * day - 1_000],
      ['expired, exactly 7 days', token, SECRET, T0 + 7 * day],
      ['expired, 8 days', token, SECRET, T0 + 8 * day],
      ['wrong secret', token, 'y'.repeat(40), T0],
      ['secret shorter than 32', token, 'x'.repeat(31), T0],
      ['secret undefined', token, undefined, T0],
      ['token undefined', undefined, SECRET, T0],
      ['token empty', '', SECRET, T0],
      ['garbage', 'garbage', SECRET, T0],
      ['payload replaced', `${h}.${forgedPayload}.${s}`, SECRET, T0],
      ['signature truncated', `${h}.${p}.${s.slice(0, -2)}`, SECRET, T0],
      ['alg none', noneAlg, SECRET, T0],
      ['valid signature but role user', userRole, SECRET, T0],
    ];
    const rows: string[] = [];
    for (const [label, tok, secret, now] of cases) rows.push(`${label} -> ${await verifyToken(tok, secret, now)}`);
    expect(rows).toMatchSnapshot();
  });

  it('checkPassword', () => {
    setEnv({ ADMIN_PASSWORD: 'pw-test-1234', SESSION_SECRET: SECRET });
    const rows = [
      `explicit match -> ${checkPassword('abc', 'abc')}`,
      `explicit mismatch -> ${checkPassword('abd', 'abc')}`,
      `different length -> ${checkPassword('abcd', 'abc')}`,
      `empty vs empty -> ${checkPassword('', '')}`,
      `unicode -> ${checkPassword('كلمة', 'كلمة')}`,
      `case sensitive -> ${checkPassword('ABC', 'abc')}`,
      `from env, right -> ${checkPassword('pw-test-1234')}`,
      `from env, wrong -> ${checkPassword('pw-test-12345')}`,
    ];
    setEnv({});
    rows.push(`from env, not configured -> ${attempt(() => checkPassword('x'))}`);
    expect(rows).toMatchSnapshot();
  });
});

describe('golden: api/_lib/body', () => {
  const req = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request('http://x', { method: 'POST', body, headers });
  const read = async (r: Request, max: number): Promise<string> => {
    try {
      const out = await readCapped(r, max);
      return `${out.constructor.name}(${out.byteLength}) [${Array.from(out.slice(0, 6)).join(',')}]`;
    } catch (e) {
      return `THROWS ${e instanceof BodyTooLarge ? 'BodyTooLarge' : (e as Error).name}`;
    }
  };
  it('declaredLength', () => {
    const values = [undefined, '0', '5', ' 5 ', '05', '5.0', '-5', '+5', 'abc', '', '1e3', '9007199254740993', '5, 5'];
    expect(values.map((v) => `${show(v)} -> ${show(declaredLength(req('x', v === undefined ? {} : { 'content-length': v })))}`)).toMatchSnapshot();
  });
  it('readCapped / readJsonCapped', async () => {
    const chunked = (sizes: number[]) =>
      new Request('http://x', {
        method: 'POST',
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            for (const n of sizes) controller.enqueue(new Uint8Array(n).fill(7));
            controller.close();
          },
        }),
        duplex: 'half',
      } as RequestInit);
    const json = async (r: Request, max: number): Promise<string> => {
      try {
        return show(await readJsonCapped(r, max));
      } catch (e) {
        return `THROWS ${e instanceof BodyTooLarge ? 'BodyTooLarge' : (e as Error).name}`;
      }
    };
    expect({
      exactFit: await read(req(new Uint8Array([1, 2, 3, 4])), 4),
      oneOver: await read(req(new Uint8Array([1, 2, 3, 4, 5])), 4),
      declaredOver: await read(req('ab', { 'content-length': '100' }), 4),
      declaredUnderButBodyOver: await read(req('abcdefgh', { 'content-length': '2' }), 4),
      invalidDeclaredIsIgnored: await read(req('ab', { 'content-length': 'abc' }), 4),
      noBody: await read(new Request('http://x', { method: 'POST' }), 4),
      emptyBody: await read(req(''), 4),
      maxZeroEmpty: await read(req(''), 0),
      maxZeroOneByte: await read(req('a'), 0),
      chunkedWithinCap: await read(chunked([3, 3, 3]), 9),
      chunkedOverCapOnLastChunk: await read(chunked([3, 3, 4]), 9),
      chunkedOverCapOnFirstChunk: await read(chunked([10, 3]), 9),
      jsonObject: await json(req('{"a":1,"b":"ب"}'), 100),
      jsonScalar: await json(req('42'), 100),
      jsonEmpty: await json(req(''), 100),
      jsonBad: await json(req('{bad'), 100),
      jsonTooLarge: await json(req('{"a":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'), 10),
      jsonUtf8Bom: await json(req(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), 100),
      bodyTooLargeIsAnError: new BodyTooLarge() instanceof Error,
    }).toMatchSnapshot();
  });
});

describe('golden: admin proxy (src/proxy.ts)', () => {
  it('matcher config', () => {
    expect(proxyConfig).toMatchSnapshot();
  });
  it('who gets through, who is redirected, who gets 401', async () => {
    const T = Date.UTC(2026, 10, 10, 9, 0, 0);
    vi.setSystemTime(new Date(T));
    const valid = await signToken(SECRET, T);
    const expired = await signToken(SECRET, T - 8 * 24 * 3600 * 1000);
    const run = async (label: string, url: string, cookie?: string): Promise<string> => {
      const r = new NextRequest(url, { headers: cookie === undefined ? {} : { cookie: `${COOKIE_NAME}=${cookie}` } });
      const res = await proxy(r);
      const kind = res.headers.get('x-middleware-next') === '1' ? 'next()' : res.headers.get('location') ? `redirect ${res.headers.get('location')}` : `response ${await res.text()}`;
      return `${label} -> ${res.status} ${kind}`;
    };
    setEnv({ SESSION_SECRET: SECRET });
    const rows = [
      await run('login page, no cookie', 'https://softy.iq/admin/login'),
      await run('admin home, no cookie', 'https://softy.iq/admin'),
      await run('admin page, no cookie, with query', 'https://softy.iq/admin/orders/abc?x=1'),
      await run('admin page, valid cookie', 'https://softy.iq/admin/orders/abc', valid),
      await run('admin page, expired cookie', 'https://softy.iq/admin/stats', expired),
      await run('admin page, garbage cookie', 'https://softy.iq/admin/stats', 'garbage'),
      await run('admin api, no cookie', 'https://softy.iq/api/admin/customers'),
      await run('admin api, valid cookie', 'https://softy.iq/api/admin/customers', valid),
      await run('admin api, expired cookie', 'https://softy.iq/api/admin/files/x/pdf', expired),
      await run('login page with a trailing slash is NOT the login page', 'https://softy.iq/admin/login/'),
      await run('login sub-path', 'https://softy.iq/admin/login/reset'),
      await run('redirect keeps the request origin', 'http://localhost:3000/admin/settings'),
    ];
    setEnv({});
    rows.push(await run('valid cookie but SESSION_SECRET unset', 'https://softy.iq/admin', valid));
    vi.useRealTimers();
    expect(rows).toMatchSnapshot();
  });
});

describe('golden: logClient (browser -> /api/log)', () => {
  it('exact fetch call; never throws', async () => {
    const calls: { url: unknown; init: Record<string, unknown> }[] = [];
    vi.stubGlobal('navigator', { userAgent: 'GoldenBrowser/1.0' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init: Record<string, unknown>) => {
        calls.push({ url, init });
        return new Response(null, { status: 204 });
      }),
    );
    logClient({ step: 'decode', message: 'boom' });
    logClient({ step: 'upload', message: 'x'.repeat(600), fileType: 'image/png', fileSize: 12_345, userAgent: 'Custom/1' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const rejected = attempt(() => logClient({ step: 'other', message: 'm' }));
    vi.stubGlobal('fetch', () => {
      throw new Error('sync failure');
    });
    const threw = attempt(() => logClient({ step: 'other', message: 'm' }));
    const second = JSON.parse(String(calls[1]?.init.body)) as { message: string };
    expect({
      calls: calls.length,
      first: calls[0],
      second: { url: calls[1]?.url, body: { ...second, message: `${second.message.length} chars` }, bodyKeyOrder: Object.keys(second).join(',') },
      rejected,
      threw,
    }).toMatchSnapshot();
  });
});
