import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reported = vi.hoisted(() => [] as unknown[][]);
vi.mock('@/lib/monitoring/report', () => ({
  reportError: (...args: unknown[]) => {
    reported.push(args);
  },
}));

import { generateImage, openAiConfig, type OpenAiConfig } from '@/lib/ai/openai';
import { AI_IMAGE_MODEL, AI_OPENAI_TIMEOUT_MS } from '@/lib/ai/config';

const KEY = 'sk-test-SECRET';
const cfg: OpenAiConfig = { apiKey: KEY, baseUrl: 'https://api.test/v1' };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const okBody = { data: [{ b64_json: Buffer.from(PNG).toString('base64') }], usage: { total_tokens: 1 } };
const baseReq = { prompt: 'a cat', size: '1024x1024', background: 'transparent' as const, refs: [] };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  reported.length = 0;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('generateImage', () => {
  it('returns png bytes from b64_json', async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody));
    const r = await generateImage(cfg, baseReq);
    expect(r).toEqual({ ok: true, png: PNG });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/images/generations');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      model: AI_IMAGE_MODEL,
      prompt: 'a cat',
      size: '1024x1024',
      quality: 'high',
      n: 1,
      background: 'transparent',
      output_format: 'png',
    });
  });

  it('uses a smaller caller-given timeout and never a larger one', async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody));
    const spy = vi.spyOn(AbortSignal, 'timeout');
    await generateImage(cfg, { ...baseReq, timeoutMs: 12_000 });
    await generateImage(cfg, { ...baseReq, timeoutMs: AI_OPENAI_TIMEOUT_MS * 3 });
    await generateImage(cfg, baseReq);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([12_000, AI_OPENAI_TIMEOUT_MS, AI_OPENAI_TIMEOUT_MS]);
  });

  it('uses /images/edits with image[] when refs are given', async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody));
    const r = await generateImage(cfg, {
      ...baseReq,
      background: 'opaque',
      refs: [
        { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
        { bytes: new Uint8Array([4, 5]), mime: 'image/jpeg' },
      ],
    });
    expect(r.ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/images/edits');
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    // fetch sets the multipart boundary itself.
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    const images = form.getAll('image[]') as File[];
    expect(images).toHaveLength(2);
    expect(images[0].type).toBe('image/png');
    expect(images[0].name).toMatch(/\.png$/);
    expect(images[1].type).toBe('image/jpeg');
    expect(images[1].name).toMatch(/\.jpg$/);
    expect(new Uint8Array(await images[1].arrayBuffer())).toEqual(new Uint8Array([4, 5]));
    expect(form.get('model')).toBe(AI_IMAGE_MODEL);
    expect(form.get('prompt')).toBe('a cat');
    expect(form.get('size')).toBe('1024x1024');
    expect(form.get('quality')).toBe('high');
    expect(form.get('n')).toBe('1');
    expect(form.get('background')).toBe('opaque');
    expect(form.get('output_format')).toBe('png');
  });

  it('moderation_blocked → refused', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'moderation_blocked', type: 'image_generation_user_error', message: 'Your request was rejected by the safety system.' } }, 400),
    );
    expect(await generateImage(cfg, baseReq)).toEqual({ ok: false, reason: 'refused' });
  });

  it('a content-policy message → refused', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: null, type: 'invalid_request_error', message: 'This request violates our content policy.' } }, 400),
    );
    expect(await generateImage(cfg, baseReq)).toEqual({ ok: false, reason: 'refused' });
  });

  it('a parameter error about safety_identifier is NOT refused', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'invalid_value', type: 'invalid_request_error', param: 'safety_identifier', message: "Invalid 'safety_identifier': string too long." } }, 400),
    );
    expect(await generateImage(cfg, baseReq)).toEqual({ ok: false, reason: 'error' });
  });

  it('"safety system" wording → refused', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: null, type: 'invalid_request_error', message: 'Your request was rejected as a result of our safety system.' } }, 400),
    );
    expect(await generateImage(cfg, baseReq)).toEqual({ ok: false, reason: 'refused' });
  });

  it('abort → timeout', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    expect(await generateImage(cfg, baseReq)).toEqual({ ok: false, reason: 'timeout' });
    fetchMock.mockRejectedValue(new DOMException('This operation was aborted', 'AbortError'));
    expect(await generateImage(cfg, baseReq)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('uses the given timeout (else AI_OPENAI_TIMEOUT_MS) and reports the one used', async () => {
    const timeouts: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      timeouts.push(ms);
      return real(ms);
    });
    fetchMock.mockResolvedValue(jsonResponse(okBody));
    await generateImage(cfg, baseReq);
    await generateImage(cfg, { ...baseReq, timeoutMs: 25_000 });
    expect(timeouts).toEqual([AI_OPENAI_TIMEOUT_MS, 25_000]);

    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    expect(await generateImage(cfg, { ...baseReq, timeoutMs: 25_000 })).toEqual({ ok: false, reason: 'timeout' });
    expect(reported.at(-1)?.[1]).toMatchObject({ tags: { timeoutMs: 25_000 } });
  });

  it('500 → error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'server_error', type: 'server_error', message: 'oops' } }, 500));
    expect(await generateImage(cfg, baseReq)).toEqual({ ok: false, reason: 'error' });
    expect(reported).toHaveLength(1);
  });

  it('a 200 without b64_json → error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{}] }));
    expect(await generateImage(cfg, baseReq)).toEqual({ ok: false, reason: 'error' });
  });

  it('a 200 with a body that is not JSON → error', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 200 }));
    expect(await generateImage(cfg, baseReq)).toEqual({ ok: false, reason: 'error' });
  });

  it('thrown/returned errors never contain the key', async () => {
    const logged: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logged.push(a));
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void logged.push(a));
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logged.push(a));

    const results: unknown[] = [];
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'invalid_api_key', type: 'invalid_request_error', message: `Incorrect API key provided: ${KEY}.` } }, 401),
    );
    results.push(await generateImage(cfg, baseReq));
    fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed for Bearer ${KEY}`));
    results.push(await generateImage(cfg, baseReq));
    fetchMock.mockResolvedValueOnce(new Response(`not json ${KEY}`, { status: 502 }));
    results.push(await generateImage(cfg, baseReq));

    expect(results).toEqual([
      { ok: false, reason: 'error' },
      { ok: false, reason: 'error' },
      { ok: false, reason: 'error' },
    ]);
    expect(reported.length).toBeGreaterThan(0);

    const dump = (v: unknown): string => {
      if (v instanceof Error) return `${v.name} ${v.message} ${v.stack ?? ''} ${dump((v as { cause?: unknown }).cause)}`;
      try {
        return JSON.stringify(v) ?? String(v);
      } catch {
        return String(v);
      }
    };
    const everything = [...results, ...reported.flat(), ...logged.flat()].map(dump).join('\n');
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain('SECRET');
  });
});

describe('openAiConfig', () => {
  it('openAiConfig is null without key', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    expect(openAiConfig()).toBeNull();
    vi.stubEnv('OPENAI_API_KEY', '   ');
    expect(openAiConfig()).toBeNull();
  });

  it('defaults the base url and honours OPENAI_BASE_URL', () => {
    vi.stubEnv('OPENAI_API_KEY', KEY);
    vi.stubEnv('OPENAI_BASE_URL', '');
    expect(openAiConfig()).toEqual({ apiKey: KEY, baseUrl: 'https://api.openai.com/v1' });
    vi.stubEnv('OPENAI_BASE_URL', 'http://localhost:9999/v1/');
    expect(openAiConfig()).toEqual({ apiKey: KEY, baseUrl: 'http://localhost:9999/v1' });
  });
});
