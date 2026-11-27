import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call = unknown[];

/** A minimal browser: location, head.appendChild, sessionStorage. */
function fakeBrowser(pathname = '/') {
  const appended: { src?: string; async?: boolean }[] = [];
  const store = new Map<string, string>();
  const win: Record<string, unknown> = { location: { pathname } };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    createElement: () => ({}),
    head: { appendChild: (el: { src?: string }) => appended.push(el) },
  });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  return { win, appended, store };
}

/** What the page queued for the real fbevents.js. */
const queued = (win: Record<string, unknown>): Call[] => (win.fbq as { queue: Call[] }).queue;

async function load() {
  vi.resetModules();
  return import('@/lib/meta/pixel.client');
}

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '1234567890123456'));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Meta Pixel (browser)', () => {
  it('loads the base code once and inits with autoConfig off and no history PageViews', async () => {
    const { win, appended } = fakeBrowser('/');
    const m = await load();
    m.metaTrack('PageView');
    m.metaTrack('PageView');
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ async: true, src: m.META_PIXEL_SCRIPT });
    expect((win.fbq as { disablePushState?: boolean }).disablePushState).toBe(true);
    expect(queued(win)).toEqual([
      ['set', 'autoConfig', false, '1234567890123456'],
      ['init', '1234567890123456'],
      ['track', 'PageView'],
      ['track', 'PageView'],
    ]);
  });

  it('does nothing without a pixel id', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '');
    const { win, appended } = fakeBrowser('/');
    const m = await load();
    m.metaTrack('PageView');
    m.trackMetaStep('details');
    m.trackMetaPurchase('order-1', 8000);
    expect(appended).toHaveLength(0);
    expect(win.fbq).toBeUndefined();
  });

  it('never loads on an admin or staff path', async () => {
    for (const p of ['/admin/orders/x', '/staff/the-secret-key', '/team']) {
      const { win, appended } = fakeBrowser(p);
      const m = await load();
      m.metaTrack('PageView');
      m.trackMetaStep('design');
      expect(appended).toHaveLength(0);
      expect(win.fbq).toBeUndefined();
    }
  });

  it('sends the mapped standard event for a builder step, and nothing for the others', async () => {
    const { win } = fakeBrowser('/');
    const m = await load();
    m.trackMetaStep('shape');
    m.trackMetaStep('design');
    m.trackMetaStep('size');
    m.trackMetaStep('quantity');
    m.trackMetaStep('details');
    expect(queued(win).filter((c) => c[0] === 'track')).toEqual([
      ['track', 'ViewContent'],
      ['track', 'AddToCart'],
      ['track', 'InitiateCheckout'],
    ]);
  });

  it('sends a purchase once per order with the order id as eventID', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_IQD_PER_USD', '1310');
    const { win } = fakeBrowser('/order/success');
    const m = await load();
    m.trackMetaPurchase('order-abc', 8000);
    m.trackMetaPurchase('order-abc', 8000);
    expect(queued(win).filter((c) => c[0] === 'track')).toEqual([
      ['track', 'Purchase', { value: 6.11, currency: 'USD' }, { eventID: 'order-abc' }],
    ]);
  });

  it('sends a purchase without a value when the price or the rate is missing', async () => {
    const { win } = fakeBrowser('/order/success');
    const m = await load();
    m.trackMetaPurchase('order-x', 8000);
    m.trackMetaPurchase('order-y', null);
    expect(queued(win).filter((c) => c[0] === 'track')).toEqual([
      ['track', 'Purchase', {}, { eventID: 'order-x' }],
      ['track', 'Purchase', {}, { eventID: 'order-y' }],
    ]);
  });

  it('never throws, even when the browser APIs do', async () => {
    vi.stubGlobal('window', { location: { pathname: '/' } });
    vi.stubGlobal('document', {
      createElement: () => {
        throw new Error('blocked');
      },
      head: {},
    });
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const m = await load();
    expect(() => m.metaTrack('PageView')).not.toThrow();
    expect(() => m.trackMetaPurchase('order-1', 8000)).not.toThrow();
  });
});
