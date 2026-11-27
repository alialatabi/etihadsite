/**
 * The real Sentry inits (browser and server) are wired to the scrubber and to the privacy settings.
 * Sentry itself is mocked; the tests read the options passed to `Sentry.init`. If an init drops
 * `beforeSend`/`beforeBreadcrumb`, or a secret leaves the server list, a test here fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SENTRY_DATA_COLLECTION } from '@/lib/monitoring/config';

const { init, httpIntegration, serveTunnelIntegration } = vi.hoisted(() => ({
  init: vi.fn(),
  httpIntegration: vi.fn(() => ({ name: 'Http' })),
  serveTunnelIntegration: vi.fn(() => ({ name: 'ServeTunnel' })),
}));
vi.mock('@sentry/nextjs', () => ({ init, httpIntegration, serveTunnelIntegration }));

const STAFF_KEY = 'staff-secret-key-123456';
const BOT_TOKEN = '123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-RA';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InitOptions = any;

function initOptions(): InitOptions {
  expect(init).toHaveBeenCalledTimes(1);
  return init.mock.calls[0][0];
}

const dirtyEvent = () => ({
  request: {
    url: `https://shop.example/staff/${STAFF_KEY}?token=abc`,
    headers: { 'x-staff-key': STAFF_KEY, cookie: 'ep_admin=1' },
    cookies: { ep_admin: '1' },
  },
  user: { ip_address: '1.2.3.4', id: 'u1' },
  exception: { values: [{ type: 'Error', value: `failed for ${STAFF_KEY} with bot${BOT_TOKEN}` }] },
});

function expectClean(out: InitOptions) {
  const json = JSON.stringify(out);
  expect(json).not.toContain(STAFF_KEY);
  expect(json).not.toContain('token=abc');
  expect(json).not.toContain('1.2.3.4');
  expect(json).not.toContain('x-staff-key');
  expect(json).not.toContain('ep_admin');
  expect(json).not.toContain('AAEhBOweik6ad9r');
  expect(out.user).toBeUndefined();
  expect(out.request.url).toBe('https://shop.example/staff/[redacted]');
}

beforeEach(() => {
  vi.resetModules();
  init.mockClear();
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://abc@o0.ingest.sentry.io/0');
  vi.stubEnv('STAFF_PAGE_KEY', STAFF_KEY);
  vi.stubEnv('TELEGRAM_BOT_TOKEN', BOT_TOKEN);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('server init (src/sentry.server.config.ts)', () => {
  it('is a no-op without a DSN', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    await import('../../../src/sentry.server.config');
    expect(init).not.toHaveBeenCalled();
  });

  it('passes the privacy settings and the scrubber hooks, and blanks the configured secrets', async () => {
    await import('../../../src/sentry.server.config');
    const o = initOptions();
    expect(o.dsn).toBe('https://abc@o0.ingest.sentry.io/0');
    expect(o.dataCollection).toEqual(SENTRY_DATA_COLLECTION);
    expect(o.tracesSampleRate).toBeUndefined();
    expectClean(o.beforeSend(dirtyEvent()));
    expect(o.beforeBreadcrumb({ category: 'console', message: 'name phone address' })).toBeNull();
    const crumb = o.beforeBreadcrumb({ category: 'fetch', data: { url: `/staff/${STAFF_KEY}?x=1` } });
    expect(crumb.data.url).toBe('/staff/[redacted]');
  });

  it('blanks the OpenAI key wherever it appears', async () => {
    const OPENAI_KEY = 'sk-proj-OAkeyQ9w8e7r6t5y4u3i';
    vi.stubEnv('OPENAI_API_KEY', OPENAI_KEY);
    await import('../../../src/sentry.server.config');
    const ev = dirtyEvent();
    ev.exception.values[0].value = `openai said Bearer ${OPENAI_KEY} is wrong`;
    expect(JSON.stringify(initOptions().beforeSend(ev))).not.toContain('OAkeyQ9w8e7r6t5y4u3i');
  });

  it('blanks the Meta Conversions API token wherever it appears', async () => {
    const META_TOKEN = 'EAAMetaTokenQ9w8e7r6t5y4u3iZZ';
    vi.stubEnv('META_CAPI_TOKEN', META_TOKEN);
    await import('../../../src/sentry.server.config');
    const ev = dirtyEvent();
    ev.exception.values[0].value = `graph said access_token ${META_TOKEN} is invalid`;
    expect(JSON.stringify(initOptions().beforeSend(ev))).not.toContain('MetaTokenQ9w8e7r6t5y4u3i');
  });

  it('registers the tunnel allowlist without letting the SDK answer /monitoring (intercept: false)', async () => {
    await import('../../../src/sentry.server.config');
    const o = initOptions();
    o.integrations([]);
    expect(serveTunnelIntegration).toHaveBeenCalledWith({ path: '/monitoring', intercept: false });
  });

  it('drops the session integrations from the defaults', async () => {
    await import('../../../src/sentry.server.config');
    const o = initOptions();
    const names = (o.integrations([{ name: 'ProcessSession' }, { name: 'Http' }, { name: 'OnUncaughtException' }]) as { name: string }[]).map((i) => i.name);
    expect(names).not.toContain('ProcessSession');
    expect(names).toContain('OnUncaughtException');
    expect(httpIntegration).toHaveBeenCalledWith(expect.objectContaining({ sessions: false }));
  });
});

describe('browser init (src/instrumentation-client.ts)', () => {
  it('is a no-op without a DSN', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    await import('../../../src/instrumentation-client');
    expect(init).not.toHaveBeenCalled();
  });

  it('passes the privacy settings and the scrubber hooks', async () => {
    await import('../../../src/instrumentation-client');
    const o = initOptions();
    expect(o.dataCollection).toEqual(SENTRY_DATA_COLLECTION);
    expect(o.tracesSampleRate).toBeUndefined();
    expect(o.tunnel).toEqual({ path: '/monitoring' });
    const ev = dirtyEvent();
    ev.exception.values[0].value = 'failed at https://shop.example/staff/anykey?token=abc';
    const out = o.beforeSend(ev);
    expect(JSON.stringify(out)).not.toContain('anykey');
    expect(out.user).toBeUndefined();
    expect(out.request.url).toBe('https://shop.example/staff/[redacted]');
    expect(o.beforeBreadcrumb({ category: 'console', message: 'x' })).toBeNull();
  });

  it('drops the tracing and session integrations from the defaults', async () => {
    await import('../../../src/instrumentation-client');
    const o = initOptions();
    const names = (o.integrations([{ name: 'BrowserTracing' }, { name: 'BrowserSession' }, { name: 'GlobalHandlers' }]) as { name: string }[]).map((i) => i.name);
    expect(names).toEqual(['GlobalHandlers']);
  });
});
