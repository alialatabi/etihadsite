import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  META_GRAPH_VERSION,
  capiPurchaseBody,
  cookieValue,
  postCapi,
  sourceUrl,
  visitorIp,
  type CapiPurchaseInput,
} from '@/lib/meta/capi';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const input = (over: Partial<CapiPurchaseInput> = {}): CapiPurchaseInput => ({
  orderId: 'order-aaaaaaaaaaaaaaaaaa',
  phone: '9647701234567',
  totalIqd: 8000,
  eventTimeSec: 1_795_740_000,
  sourceUrl: 'https://softy-print.vercel.app/',
  ip: '5.1.2.3',
  userAgent: 'Mozilla/5.0',
  fbp: 'fb.1.1795700000000.1234567890',
  fbc: 'fb.1.1795700000000.IwAR0abc_DEF-123',
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('capiPurchaseBody', () => {
  it('builds one Purchase with the order id as event_id and hashed phone and country', () => {
    const body = capiPurchaseBody(input(), 1310);
    expect(body).toEqual({
      data: [
        {
          event_name: 'Purchase',
          event_time: 1_795_740_000,
          event_id: 'order-aaaaaaaaaaaaaaaaaa',
          action_source: 'website',
          event_source_url: 'https://softy-print.vercel.app/',
          user_data: {
            ph: [sha('9647701234567')],
            country: [sha('iq')],
            client_ip_address: '5.1.2.3',
            client_user_agent: 'Mozilla/5.0',
            fbp: 'fb.1.1795700000000.1234567890',
            fbc: 'fb.1.1795700000000.IwAR0abc_DEF-123',
          },
          custom_data: { value: 6.11, currency: 'USD', order_id: 'order-aaaaaaaaaaaaaaaaaa' },
        },
      ],
    });
  });

  it('never carries the phone in clear, the name or the address', () => {
    const text = JSON.stringify(capiPurchaseBody(input(), 1310));
    expect(text).not.toContain('9647701234567');
    expect(text).not.toContain('7701234567');
  });

  it('leaves out what it does not have, and malformed cookies', () => {
    const body = capiPurchaseBody(input({ ip: null, userAgent: null, fbp: 'x', fbc: null, totalIqd: null }), 1310);
    expect(body.data[0].user_data).toEqual({ ph: [sha('9647701234567')], country: [sha('iq')] });
    expect(body.data[0].custom_data).toEqual({ order_id: 'order-aaaaaaaaaaaaaaaaaa' });
    expect(capiPurchaseBody(input(), null).data[0].custom_data).toEqual({ order_id: 'order-aaaaaaaaaaaaaaaaaa' });
  });

  it('adds the test event code only when given', () => {
    expect(capiPurchaseBody(input(), null, 'TEST123')).toMatchObject({ test_event_code: 'TEST123' });
    expect(capiPurchaseBody(input(), null)).not.toHaveProperty('test_event_code');
  });
});

describe('request helpers', () => {
  it('reads one cookie', () => {
    expect(cookieValue('a=1; _fbp=fb.1.2.3; _fbc=fb.1.2.x', '_fbp')).toBe('fb.1.2.3');
    expect(cookieValue('a=1; x_fbp=no', '_fbp')).toBeNull();
    expect(cookieValue(null, '_fbp')).toBeNull();
    expect(cookieValue('_fbc=', '_fbc')).toBeNull();
  });

  it('takes the first forwarded address, only when it is an IP', () => {
    expect(visitorIp(new Headers({ 'x-forwarded-for': '5.1.2.3, 10.0.0.1' }))).toBe('5.1.2.3');
    expect(visitorIp(new Headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(visitorIp(new Headers({ 'x-real-ip': '5.1.2.4' }))).toBe('5.1.2.4');
    expect(visitorIp(new Headers({ 'x-forwarded-for': 'not-an-ip' }))).toBeNull();
    expect(visitorIp(new Headers())).toBeNull();
  });

  it('uses the referring page of the same site without its query, else the site root', () => {
    const api = 'https://softy-print.vercel.app/api/orders';
    expect(sourceUrl(api, 'https://softy-print.vercel.app/?utm_source=meta&fbclid=abc#x')).toBe('https://softy-print.vercel.app/');
    expect(sourceUrl(api, 'https://softy-print.vercel.app/how-it-works?x=1')).toBe('https://softy-print.vercel.app/how-it-works');
    expect(sourceUrl(api, 'https://evil.example/page')).toBe('https://softy-print.vercel.app/');
    expect(sourceUrl(api, 'not a url')).toBe('https://softy-print.vercel.app/');
    expect(sourceUrl(api, null)).toBe('https://softy-print.vercel.app/');
  });
});

describe('postCapi', () => {
  it('posts JSON with the token to the pixel endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await postCapi('1234567890123456', 'TOKEN-abc', { data: [] }, 'order-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/1234567890123456/events`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ data: [], access_token: 'TOKEN-abc' });
  });

  it('never throws on a refusal or a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{}}', { status: 400 })));
    await expect(postCapi('1234567890123456', 'T', { data: [] }, 'order-1')).resolves.toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(postCapi('1234567890123456', 'T', { data: [] }, 'order-1')).resolves.toBeUndefined();
  });
});
