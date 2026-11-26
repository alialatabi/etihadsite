/** uploadWithProgress talks to the customer routes by default and to the staff twins when the staff page passes its own. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadErrorCode } from '@/components/builder/ai/ai-logic';
import { DEFAULT_UPLOAD_ROUTES, uploadWithProgress } from '@/components/builder/orderApi';
import { TEAM_AI_ENDPOINTS } from '@/components/team/team-logic';

afterEach(() => vi.unstubAllGlobals());

function stubNetwork() {
  const seen: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      seen.push(`fetch ${url}`);
      return new Response(JSON.stringify({ ok: true, mode: 'server' }), { status: 200 });
    }),
  );
  class FakeXhr {
    responseType = '';
    status = 200;
    responseText = JSON.stringify({ ok: true, uploadId: 'abcDEF_123-xyz', kind: 'png', bytes: 3 });
    upload = {} as Record<string, unknown>;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    private url = '';
    open(method: string, url: string) {
      this.url = url;
      seen.push(`${method} ${url}`);
    }
    setRequestHeader() {}
    send() {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return seen;
}

const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });

describe('uploadWithProgress routes', () => {
  it('defaults to the customer routes', async () => {
    const seen = stubNetwork();
    await uploadWithProgress(file, () => {});
    expect(seen).toEqual(['fetch /api/upload/direct', 'POST /api/upload']);
    expect(DEFAULT_UPLOAD_ROUTES.commit).toBe('/api/upload/direct/commit');
  });

  it('uses the staff routes when given them', async () => {
    const seen = stubNetwork();
    await uploadWithProgress(file, () => {}, TEAM_AI_ENDPOINTS.upload);
    expect(seen).toEqual(['fetch /api/team/upload/direct', 'POST /api/team/upload']);
  });
});

describe('uploadErrorCode', () => {
  it('maps a refused reference upload; an ended staff session passes through', () => {
    expect(uploadErrorCode('rate_limited')).toBe('rate_limited');
    expect(uploadErrorCode('server_error')).toBe('failed');
    expect(uploadErrorCode('unauthorized')).toBe('unauthorized');
    expect(uploadErrorCode('too_large')).toBe('invalid_request');
    expect(uploadErrorCode('unsafe')).toBe('invalid_request');
  });
});
