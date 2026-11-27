import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BLOCK_CDP_URLS,
  BLOCK_RE,
  T,
  installBlocking,
  isLocalBase,
  leaked,
  pageList,
  parseArgs,
  resolveSettings,
  throwawayEnv,
} from '../../../scripts/perf-lab.mjs';

type Matcher = (u: URL) => boolean;
type Handler = (route: { abort: () => void }) => void;

describe('request blocking (never writes data, even against live)', () => {
  const blocked = [
    'https://softy.example/api/track',
    'http://localhost:3217/api/track?x=1',
    'https://softy.example/api/log',
    'https://softy.example/monitoring?o=1&p=2',
    'https://softy.example/sentry-tunnel',
    'https://connect.facebook.net/en_US/fbevents.js',
    'https://www.facebook.com/tr/?id=123&ev=PageView',
    'https://softy.example/x/fbevents.js',
  ];
  const allowed = [
    'https://softy.example/',
    'https://softy.example/_next/static/chunks/abc.js',
    'https://softy.example/api/orders',
    'https://softy.example/how-it-works',
    'https://softy.example/admin/designs',
  ];

  it('BLOCK_RE matches analytics, client-log, monitoring and Meta URLs and nothing else', () => {
    for (const u of blocked) expect(BLOCK_RE.test(u), u).toBe(true);
    for (const u of allowed) expect(BLOCK_RE.test(u), u).toBe(false);
  });

  it('installBlocking registers exactly one route whose matcher selects the blocked URLs and whose handler aborts', async () => {
    const calls: { matcher: Matcher; handler: Handler }[] = [];
    await installBlocking({ route: async (matcher: Matcher, handler: Handler) => void calls.push({ matcher, handler }) });
    expect(calls).toHaveLength(1);
    const { matcher, handler } = calls[0];
    for (const u of blocked) expect(matcher(new URL(u)), u).toBe(true);
    for (const u of allowed) expect(matcher(new URL(u)), u).toBe(false);
    let aborts = 0;
    handler({ abort: () => void aborts++ });
    expect(aborts).toBe(1);
  });

  it('the CDP blocked-URL list covers the same targets', () => {
    for (const needle of ['/api/track', '/api/log', '/monitoring', '/sentry-tunnel', 'connect.facebook.net', 'facebook.com/tr', 'fbevents']) {
      expect(BLOCK_CDP_URLS.some((p: string) => p.includes(needle)), needle).toBe(true);
    }
  });

  it('leaked() counts blocked-pattern requests that got a response and ignores aborted ones', () => {
    expect(
      leaked([
        { url: 'https://softy.example/api/track', status: null },
        { url: 'https://softy.example/api/track', status: 204 },
        { url: 'https://softy.example/', status: 200 },
        { url: 'https://connect.facebook.net/en_US/fbevents.js', status: 200 },
      ]),
    ).toBe(2);
  });
});

describe('resolveSettings', () => {
  it('defaults: localhost:3217, 5 runs, route blocking, all three sections', () => {
    expect(resolveSettings({})).toMatchObject({ base: 'http://localhost:3217', local: true, runs: 5, block: 'route', only: ['pages', 'builder', 'network'], serve: false, seed: false, label: 'lab' });
  });

  it('takes --base, --label and --runs', () => {
    expect(resolveSettings({ base: 'http://localhost:4000/', label: 'after', runs: '3' })).toMatchObject({ base: 'http://localhost:4000', label: 'after', runs: 3 });
  });

  it('sanitises the label so it cannot escape the output folder', () => {
    expect(resolveSettings({ label: '../../evil' }).label).not.toMatch(/[\\/]/);
  });

  it('measures only page loads on a remote base', () => {
    expect(resolveSettings({ base: 'https://softy.example' })).toMatchObject({ local: false, only: ['pages'] });
  });

  it('refuses --serve, --seed and the builder/network flows on a remote base', () => {
    expect(() => resolveSettings({ base: 'https://softy.example', serve: true })).toThrow(/not localhost/);
    expect(() => resolveSettings({ base: 'https://softy.example', seed: true })).toThrow(/not localhost/);
    expect(() => resolveSettings({ base: 'https://softy.example', only: 'builder' })).toThrow(/not localhost/);
    expect(() => resolveSettings({ base: 'https://softy.example', only: 'pages,network' })).toThrow(/not localhost/);
  });

  it('rejects bad --runs and --block values', () => {
    expect(() => resolveSettings({ runs: '0' })).toThrow(/--runs/);
    expect(() => resolveSettings({ runs: 'abc' })).toThrow(/--runs/);
    expect(() => resolveSettings({ block: 'nope' })).toThrow(/--block/);
  });

  it('reads credentials only from the environment', () => {
    expect(resolveSettings({}, { PERF_ADMIN_PASSWORD: 'pw', STAFF_PAGE_KEY: 'key' })).toMatchObject({ adminPassword: 'pw', staffKey: 'key' });
    expect(resolveSettings({})).toMatchObject({ adminPassword: null, staffKey: null });
  });

  it('isLocalBase', () => {
    expect(isLocalBase('http://localhost:3217')).toBe(true);
    expect(isLocalBase('http://127.0.0.1:3217')).toBe(true);
    expect(isLocalBase('https://softy.example')).toBe(false);
    expect(isLocalBase('not a url')).toBe(false);
  });
});

describe('parseArgs', () => {
  it('parses flags and key/value pairs', () => {
    expect(parseArgs(['--base', 'http://x', '--serve', '--runs', '2', '--seed'])).toEqual({ base: 'http://x', serve: true, runs: '2', seed: true });
  });
});

describe('throwawayEnv', () => {
  it('is random per call, contains no placeholder from .env.example and satisfies the env schema lengths', () => {
    const a = throwawayEnv('/tmp/lab-data');
    const b = throwawayEnv('/tmp/lab-data');
    expect(a.ADMIN_PASSWORD).not.toBe(b.ADMIN_PASSWORD);
    expect(a.SESSION_SECRET).not.toBe(b.SESSION_SECRET);
    expect(a.STAFF_PAGE_KEY).not.toBe(b.STAFF_PAGE_KEY);
    expect(a.ADMIN_PASSWORD.length).toBeGreaterThanOrEqual(8);
    expect(a.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    for (const v of Object.values(a)) expect(v.toLowerCase().startsWith('change-me')).toBe(false);
  });

  it('blanks every variable that could make the server send data, so a developer .env.local cannot leak in', () => {
    const env = throwawayEnv('/tmp/lab-data');
    for (const name of ['META_CAPI_TOKEN', 'META_TEST_EVENT_CODE', 'NEXT_PUBLIC_META_PIXEL_ID', 'NEXT_PUBLIC_SENTRY_DSN', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'TURNSTILE_SECRET_KEY', 'CRON_SECRET']) {
      expect(env, name).toHaveProperty(name, ''); // defined but empty: Next does not override it from .env.local, the code reads '' as unset
    }
  });

  it('keeps everything local: local storage, console orders, no Telegram, OpenAI pointed at a dead port', () => {
    expect(throwawayEnv('/tmp/lab-data')).toMatchObject({
      STORAGE: 'local',
      DATA_DIR: '/tmp/lab-data',
      ORDER_TRANSPORT: 'console',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
    });
  });
});

describe('pageList', () => {
  const none = { adminPassword: null, staffKey: null, pages: null };

  it('without credentials measures only the public pages', () => {
    expect(pageList(none).map((p: { name: string }) => p.name)).toEqual(['/', '/how-it-works', '/order/success', '/admin/login']);
  });

  it('with credentials adds the admin pages and the staff page under its secret path', () => {
    const list = pageList({ adminPassword: 'pw', staffKey: 'k', pages: null });
    expect(list.map((p: { name: string }) => p.name)).toContain('/admin/designs');
    expect(list.find((p: { name: string }) => p.name === '/staff-sheets')).toMatchObject({ path: '/staff/k', expectStatus: 200 });
  });

  it('--pages limits the list', () => {
    expect(pageList({ ...none, pages: ['/'] })).toHaveLength(1);
  });
});

describe('UI strings used by the builder flow', () => {
  it('every literal in T still exists in src/content/ar (a copy change would break the selectors)', () => {
    const dir = join(process.cwd(), 'src', 'content', 'ar');
    const text = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    for (const [key, value] of Object.entries(T)) {
      expect(text.includes(`'${value}'`) || text.includes(`"${value}"`), `${key}: ${value}`).toBe(true);
    }
  });
});
