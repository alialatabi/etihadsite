import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSentryTunnelRoute } from '@sentry/nextjs/tunnel';
import { createDeadlineTunnel } from '@/lib/monitoring/tunnel';

const URL_ = 'http://localhost/monitoring';
const enc = new TextEncoder();
const FAST = { bodyMs: 50, totalMs: 150 };

/** A body that sends `first` and then never closes (a dropped connection). */
function stalledBody(first = '{"dsn":"x"}\n') {
  return new ReadableStream<Uint8Array>({
    start(c) {
      if (first) c.enqueue(enc.encode(first));
    },
    pull() {
      return new Promise(() => {});
    },
  });
}

function post(body: BodyInit | ReadableStream | null, headers: Record<string, string> = {}) {
  return new Request(URL_, {
    method: 'POST',
    headers,
    body: body as BodyInit,
    duplex: 'half',
  } as RequestInit);
}

const ENVELOPE = '{"dsn":"https://abc@o1.ingest.sentry.io/1"}\n{"type":"event"}\n{"message":"hi"}\n';
const never = () => new Promise<Response>(() => {});

afterEach(() => vi.restoreAllMocks());

describe('createDeadlineTunnel', () => {
  it('answers an empty 408 when the incoming body never finishes, without calling the handler', async () => {
    const handler = vi.fn(never);
    const POST = createDeadlineTunnel(handler, FAST);
    const t0 = Date.now();
    const res = await POST(post(stalledBody(), { 'content-length': '500' }));
    expect(res.status).toBe(408);
    expect(await res.text()).toBe('');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers an empty 504 when the handler never resolves', async () => {
    const POST = createDeadlineTunnel(never, FAST);
    const t0 = Date.now();
    const res = await POST(post(ENVELOPE, { 'content-length': String(ENVELOPE.length) }));
    expect(res.status).toBe(504);
    expect(await res.text()).toBe('');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('answers an empty 504 when the handler response body never ends', async () => {
    const POST = createDeadlineTunnel(async () => new Response(stalledBody('partial'), { status: 200 }), FAST);
    const t0 = Date.now();
    const res = await POST(post(ENVELOPE));
    expect(res.status).toBe(504);
    expect(await res.text()).toBe('');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('cancels the late answer stream when the deadline fires (the reader is released, not left locked)', async () => {
    let cancelled = false;
    const answerStream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('partial'));
      },
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        cancelled = true;
      },
    });
    const POST = createDeadlineTunnel(async () => new Response(answerStream, { status: 200 }), FAST);
    const res = await POST(post(ENVELOPE));
    expect(res.status).toBe(504);
    await new Promise((r) => setTimeout(r, 20));
    expect(cancelled).toBe(true);
  });

  it('cancels an answer that arrives after the deadline (handler slower than totalMs)', async () => {
    let cancelled = false;
    const lateStream = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        cancelled = true;
      },
    });
    const POST = createDeadlineTunnel(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response(lateStream, { status: 200 })), 250)),
      FAST,
    );
    const res = await POST(post(ENVELOPE));
    expect(res.status).toBe(504);
    await new Promise((r) => setTimeout(r, 300));
    expect(cancelled).toBe(true);
  });

  it.each([200, 403, 500])('passes status %i and body through, with only the three allowed headers', async (status) => {
    const POST = createDeadlineTunnel(
      async () =>
        new Response(`answer-${status}`, {
          status,
          headers: {
            'content-type': 'application/json',
            'retry-after': '30',
            'x-sentry-rate-limits': '60:error',
            'set-cookie': 'a=b',
            'x-secret': 'nope',
            server: 'relay',
          },
        }),
      FAST,
    );
    const res = await POST(post(ENVELOPE));
    expect(res.status).toBe(status);
    expect(await res.text()).toBe(`answer-${status}`);
    expect([...res.headers.keys()].sort()).toEqual(['content-type', 'retry-after', 'x-sentry-rate-limits']);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(res.headers.get('x-sentry-rate-limits')).toBe('60:error');
  });

  it('hands the handler the buffered body with the real content-length and the client headers', async () => {
    let seen: Request | undefined;
    let seenText = '';
    const POST = createDeadlineTunnel(async (req) => {
      seen = req;
      seenText = await req.text();
      return new Response('ok');
    }, FAST);
    const res = await POST(
      post(ENVELOPE, {
        'content-length': '1',
        'user-agent': 'UA/1',
        origin: 'https://example.test',
        referer: 'https://example.test/x',
        'x-forwarded-for': '1.2.3.4',
      }),
    );
    expect(res.status).toBe(200);
    expect(seen).toBeDefined();
    expect(seen!.method).toBe('POST');
    expect(seen!.url).toBe(URL_);
    expect(seenText).toBe(ENVELOPE);
    expect(seen!.headers.get('content-length')).toBe(String(enc.encode(ENVELOPE).byteLength));
    expect(seen!.headers.get('user-agent')).toBe('UA/1');
    expect(seen!.headers.get('origin')).toBe('https://example.test');
    expect(seen!.headers.get('referer')).toBe('https://example.test/x');
    expect(seen!.headers.get('x-forwarded-for')).toBe('1.2.3.4');
  });

  it('answers an empty 413 for an oversize body (declared and streamed) without calling the handler', async () => {
    const handler = vi.fn(async () => new Response('ok'));
    const POST = createDeadlineTunnel(handler, { ...FAST, maxBytes: 16 });
    const declared = await POST(post('x'.repeat(100), { 'content-length': '100' }));
    expect(declared.status).toBe(413);
    expect(await declared.text()).toBe('');
    const streamed = await POST(
      post(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode('x'.repeat(100)));
            c.close();
          },
        }),
      ),
    );
    expect(streamed.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers an empty 502 when the handler throws', async () => {
    const POST = createDeadlineTunnel(async () => {
      throw new Error('boom secret-dsn');
    }, FAST);
    const res = await POST(post(ENVELOPE));
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('');
  });
});

describe('createDeadlineTunnel with the real Sentry handler', () => {
  const { POST: sdkPOST } = createSentryTunnelRoute({ allowedDsns: ['https://abc@o1.ingest.sentry.io/1'] });

  it('answers within the deadline when the body never completes, and forwards nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be used'));
    const POST = createDeadlineTunnel(sdkPOST, FAST);
    const t0 = Date.now();
    const res = await POST(post(stalledBody(ENVELOPE), { 'content-length': '999' }));
    expect(res.status).toBe(408);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes the SDK 403 for a disallowed DSN and never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be used'));
    const POST = createDeadlineTunnel(sdkPOST, FAST);
    const bad = '{"dsn":"https://evil@o2.ingest.sentry.io/2"}\n{"type":"event"}\n{}\n';
    const res = await POST(post(bad, { 'content-length': String(bad.length) }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards an allowed envelope to the ingest endpoint and passes the answer through', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"id":"1"}', {
        status: 200,
        headers: { 'x-sentry-rate-limits': '60:error', 'content-type': 'application/json' },
      }),
    );
    const POST = createDeadlineTunnel(sdkPOST, FAST);
    const res = await POST(post(ENVELOPE, { 'content-length': String(ENVELOPE.length), origin: 'https://example.test' }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"id":"1"}');
    expect(res.headers.get('x-sentry-rate-limits')).toBe('60:error');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('o1.ingest.sentry.io/api/1/envelope/');
  });
});

describe('route files', () => {
  it.each(['@/app/monitoring/route', '@/app/sentry-tunnel/route'])('%s exports the deadline-wrapped POST with force-dynamic and maxDuration 15', async (path) => {
    const mod = (await import(path)) as { POST: unknown; dynamic: string; maxDuration: number };
    expect(typeof mod.POST).toBe('function');
    expect(mod.dynamic).toBe('force-dynamic');
    expect(mod.maxDuration).toBe(15);
  });
});
