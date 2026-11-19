/**
 * The Sentry privacy scrubber (src/lib/monitoring/scrub.ts). Pure functions: no Sentry needed.
 * A failing test here can mean a secret (staff key, signed URL token, bot token, customer phone)
 * would leave the site: fix the scrubber, not the test.
 */
import { describe, expect, it } from 'vitest';
import { makeScrubbers, makeTextScrubber, scrubUrl, stripQueryAndFragment } from '@/lib/monitoring/scrub';

const KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const { scrubEvent, scrubBreadcrumb, text } = makeScrubbers({ secrets: [KEY, 'short', undefined, null] });

/** Whole-object check: the secret appears nowhere, in any key or value. */
const leaks = (value: unknown, needle: string) => JSON.stringify(value).toLowerCase().includes(needle.toLowerCase());

describe('staff key', () => {
  it.each([
    [`/staff/${KEY}`, '/staff/[redacted]'],
    [`/Staff/${KEY}`, '/staff/[redacted]'],
    [`/STAFF/${KEY.toUpperCase()}`, '/staff/[redacted]'],
    [`https://shop.example/staff/${KEY}`, 'https://shop.example/staff/[redacted]'],
    [`https://shop.example/staff/${KEY}?x=1#top`, 'https://shop.example/staff/[redacted]'],
    [`GET /staff/${KEY}/extra`, 'GET /staff/[redacted]/extra'],
    [`failed at (https://shop.example/staff/${KEY})`, 'failed at (https://shop.example/staff/[redacted])'],
    ['/staff/anything-at-all', '/staff/[redacted]'],
  ])('rewrites %s', (input, expected) => {
    expect(text(input)).toBe(expected);
  });

  it('leaves the real route and other paths alone', () => {
    expect(text('/staff-sheets')).toBe('/staff-sheets');
    expect(text('/order/success')).toBe('/order/success');
    expect(text('/staff')).toBe('/staff');
  });

  it('blanks the literal key even outside a path, but ignores short secrets', () => {
    expect(text(`header value ${KEY} here`)).toBe('header value [redacted] here');
    expect(text('a short word')).toBe('a short word');
  });

  it('scrubs percent-encoded staff paths', () => {
    expect(text(`/login?next=%2Fstaff%2F${KEY}`)).not.toContain(KEY);
  });

  it('removes the key from every part of an event', () => {
    const event = {
      transaction: `GET /staff/${KEY}`,
      message: `crash on /Staff/${KEY}`,
      request: {
        url: `https://shop.example/staff/${KEY}?utm=1`,
        method: 'GET',
        headers: { 'x-staff-key': KEY, cookie: 'ep_admin=secret', 'user-agent': 'x' },
        cookies: { ep_admin: 'secret' },
        query_string: 'a=b',
        data: { name: 'Ali' },
      },
      contexts: { nextjs: { request_path: `/staff/${KEY}`, router_kind: 'App Router' } },
      exception: { values: [{ type: 'Error', value: `Failed to load https://shop.example/staff/${KEY}/page?x=1` }] },
      extra: { nested: { deep: [`/staff/${KEY}`] } },
      tags: { path: `/staff/${KEY}` },
    };
    const out = scrubEvent(event)!;
    expect(leaks(out, KEY)).toBe(false);
    expect(out.transaction).toBe('GET /staff/[redacted]');
    expect(out.request).toEqual({ method: 'GET', url: 'https://shop.example/staff/[redacted]' });
    expect(out.exception.values[0].value).toBe('Failed to load https://shop.example/staff/[redacted]/page');
    expect(out.contexts.nextjs.router_kind).toBe('App Router');
  });
});

describe('URLs', () => {
  it('cuts the query string and the fragment', () => {
    expect(stripQueryAndFragment('https://a.example/p?x=1#h')).toBe('https://a.example/p');
    expect(stripQueryAndFragment('/p#h')).toBe('/p');
    expect(stripQueryAndFragment('/p')).toBe('/p');
    expect(scrubUrl(`/staff/${KEY}?x=1`)).toBe('/staff/[redacted]');
  });

  it('removes the token of a Supabase signed URL, in a URL field and in free text', () => {
    const signed = 'https://abc.supabase.co/storage/v1/object/upload/sign/etihad/uploads/u1.bin?token=eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJ4In0.c2lnbmF0dXJlMTIz';
    const out = scrubEvent({
      request: { url: signed },
      breadcrumbs: [{ category: 'fetch', data: { url: signed, method: 'PUT', status_code: 200 } }],
      exception: { values: [{ value: `PUT ${signed} failed` }] },
    })!;
    expect(leaks(out, 'token=')).toBe(false);
    expect(leaks(out, 'eyJhbGci')).toBe(false);
    expect(out.request.url).toBe('https://abc.supabase.co/storage/v1/object/upload/sign/etihad/uploads/u1.bin');
    expect(out.exception.values[0].value).toBe('PUT https://abc.supabase.co/storage/v1/object/upload/sign/etihad/uploads/u1.bin failed');
  });

  it('redacts a bare token parameter and a JWT outside a URL', () => {
    expect(text('retry with token=abc123def')).toBe('retry with token=[redacted]');
    expect(text('got eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJ4In0.c2lnbmF0dXJlMTIz back')).toBe('got [redacted] back');
  });

  it('redacts the Telegram bot token that sits in the URL path', () => {
    const url = 'https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendDocument';
    const out = scrubBreadcrumb({ category: 'http', type: 'http', data: { url, method: 'POST' } })!;
    expect(JSON.stringify(out)).not.toContain('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');
    expect(out.data.url).toBe('https://api.telegram.org/bot[redacted]/sendDocument');
  });
});

describe('breadcrumbs', () => {
  it('cleans fetch, xhr and navigation breadcrumbs', () => {
    const fetchCrumb = scrubBreadcrumb({
      category: 'fetch',
      type: 'http',
      data: { url: 'https://shop.example/api/upload/direct?x=1', method: 'POST', status_code: 200 },
    })!;
    expect(fetchCrumb.data.url).toBe('https://shop.example/api/upload/direct');
    expect(fetchCrumb.data.status_code).toBe(200);

    const xhrCrumb = scrubBreadcrumb({
      category: 'xhr',
      type: 'http',
      data: { url: 'https://abc.supabase.co/x/sign/y?token=zzz', method: 'PUT' },
    })!;
    expect(xhrCrumb.data.url).toBe('https://abc.supabase.co/x/sign/y');

    const nav = scrubBreadcrumb({
      category: 'navigation',
      data: { from: '/order?step=2', to: `/staff/${KEY}?x=1#top` },
    })!;
    expect(nav.data).toEqual({ from: '/order', to: '/staff/[redacted]' });
    expect(leaks(nav, KEY)).toBe(false);
  });

  it('scrubs the staff key out of a breadcrumb message', () => {
    const out = scrubBreadcrumb({ category: 'ui.click', message: `link to /staff/${KEY}` })!;
    expect(out.message).toBe('link to /staff/[redacted]');
  });

  it('drops console breadcrumbs (the order summary holds the customer data)', () => {
    expect(scrubBreadcrumb({ category: 'console', message: '[order] name phone address' })).toBeNull();
  });

  it('drops headers and cookies found in breadcrumb data', () => {
    const out = scrubBreadcrumb({ category: 'fetch', data: { url: '/a', headers: { 'x-staff-key': KEY }, Cookie: 'a=b' } })!;
    expect(out.data).toEqual({ url: '/a' });
  });
});

describe('events', () => {
  it('drops the user block (IP address included), cookies, headers, body and query string', () => {
    const out = scrubEvent({
      user: { id: '1', ip_address: '203.0.113.9', email: 'a@b.c' },
      server_name: 'DESKTOP-5019R4H',
      request: {
        url: 'https://shop.example/api/orders?x=1',
        method: 'POST',
        headers: { cookie: 'c=1', authorization: 'Bearer z', 'x-forwarded-for': '203.0.113.9' },
        cookies: { c: '1' },
        data: '{"customer":{"name":"Ali"}}',
        query_string: 'x=1',
      },
    })!;
    expect(out.user).toBeUndefined();
    expect(out.request).toEqual({ method: 'POST', url: 'https://shop.example/api/orders' });
    expect(leaks(out, '203.0.113.9')).toBe(false);
    expect(leaks(out, 'DESKTOP')).toBe(false);
    expect(leaks(out, 'Ali')).toBe(false);
  });

  it('cuts query strings of URL-like fields such as stack frame paths', () => {
    const out = scrubEvent({
      exception: { values: [{ stacktrace: { frames: [{ filename: 'https://shop.example/_next/static/a.js?v=3', abs_path: 'https://shop.example/_next/static/a.js#x' }] } }] },
    })!;
    const frame = out.exception.values[0].stacktrace.frames[0];
    expect(frame.filename).toBe('https://shop.example/_next/static/a.js');
    expect(frame.abs_path).toBe('https://shop.example/_next/static/a.js');
  });

  it('redacts Iraqi phone numbers and database "Key (phone)=(...)" details', () => {
    const msg = 'duplicate key value violates unique constraint. Key (phone)=(07701234567) already exists. Call +964 770 123 4567 or 0770-123-4567 or 00964 7701234567';
    const out = text(msg);
    expect(out).not.toMatch(/0770|964 770|7701234567/);
    expect(out).toContain('Key (phone)=([redacted])');
  });

  it('redacts the bare stored phone form and composite database keys', () => {
    expect(text('phone 9647701234567 failed')).not.toContain('9647701234567');
    expect(text('open wa.me/9647701234567?text=hi now')).not.toContain('9647701234567');
    const out = text('Key (customer_phone, name)=(9647701234567, Ali) already exists.');
    expect(out).not.toMatch(/9647701234567|Ali/);
    expect(out).toContain('([redacted])');
  });

  it('does not touch ordinary ids, timestamps and order numbers', () => {
    const s = 'order EP-20261119-0042 uploadId V1StGXR8_Z5jdHi6B-myT ts 1763500000000 status 500';
    expect(text(s)).toBe(s);
  });

  it('does not mutate its input and keeps unrelated data', () => {
    const event = { level: 'error', tags: { where: 'orders.post' }, request: { url: '/a?x=1', headers: { a: 'b' } } };
    const copy = JSON.parse(JSON.stringify(event));
    const out = scrubEvent(event)!;
    expect(event).toEqual(copy);
    expect(out.level).toBe('error');
    expect(out.tags).toEqual({ where: 'orders.post' });
  });

  it('survives circular references and very deep objects', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a.self = a;
    let deep: Record<string, unknown> = { leaf: `/staff/${KEY}` };
    for (let i = 0; i < 40; i++) deep = { child: deep };
    const out = scrubEvent({ extra: { a, deep } })!;
    expect(out).not.toBeNull();
    expect(leaks(out, KEY)).toBe(false);
  });

  it('keeps the text of an Error instance inside an event, scrubbed', () => {
    const out = scrubEvent({ extra: { err: new Error(`bad /staff/${KEY}`) } })!;
    expect(leaks(out, KEY)).toBe(false);
  });

  it('redacts a transaction name and request URL', () => {
    expect(scrubEvent({ transaction: '/staff/zzz', request: { url: '/staff/zzz?a=1' } })).toEqual({
      transaction: '/staff/[redacted]',
      request: { url: '/staff/[redacted]' },
    });
  });

  it('redacts the failing row of a database error (it holds the customer record)', () => {
    const msg = 'null value in column "x" violates not-null constraint\nFailing row contains (EP-1, {"customer":{"name":"Ali","phone":"x"}}, 2026-11-19).\nnext line';
    const out = text(msg);
    expect(out).not.toContain('Ali');
    expect(out).toContain('Failing row contains ([redacted])');
    expect(out).toContain('next line');
  });
});

describe('idempotence', () => {
  it('scrubbing twice gives the same result as scrubbing once', () => {
    const samples = [
      `/staff/${KEY}`,
      `https://shop.example/staff/${KEY}?x=1`,
      `%2Fstaff%2F${KEY}`,
      'https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendDocument',
      'Key (phone)=(07701234567) token=abc',
    ];
    for (const sample of samples) expect(text(text(sample))).toBe(text(sample));
  });
});

describe('makeTextScrubber secrets', () => {
  it('blanks the longest secret first and escapes regex characters', () => {
    const t = makeTextScrubber({ secrets: ['abcdefgh', 'abcdefgh.ij+kl'] });
    expect(t('x abcdefgh.ij+kl y')).toBe('x [redacted] y');
    expect(t('x abcdefghXij+kl y')).toBe('x [redacted]Xij+kl y');
  });
});
