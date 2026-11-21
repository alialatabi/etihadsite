import 'server-only';
/**
 * Minimal OpenAI client for the AI sticker designer: plain `fetch`, no SDK dependency.
 *
 * Never throws. Every failure becomes one of three reasons:
 *  - 'refused'  — the model's safety system rejected the request (error code `moderation_blocked`,
 *                 or a message/type about safety or the content policy);
 *  - 'timeout'  — no complete answer within AI_OPENAI_TIMEOUT_MS (AbortSignal.timeout);
 *  - 'error'    — everything else (network, HTTP status, unreadable body).
 *
 * SECRET HANDLING: the API key and OpenAI's response bodies (which can echo the key or the
 * customer's text) never go into a thrown error, a log line or reportError. Reports carry a fixed
 * message plus the endpoint, the HTTP status and a whitelisted error code only.
 */
import { reportError } from '@/lib/monitoring/report';
import { AI_IMAGE_MODEL, AI_OPENAI_TIMEOUT_MS } from './config';

export interface OpenAiConfig {
  apiKey: string;
  baseUrl: string;
}

export type AiFailure = 'refused' | 'timeout' | 'error';

export interface ImageRef {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Null when OPENAI_API_KEY is blank (the feature is then off). Read at call time, not import time. */
export function openAiConfig(): OpenAiConfig | null {
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) return null;
  const baseUrl = (process.env.OPENAI_BASE_URL ?? '').trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
  return { apiKey, baseUrl };
}

export type OpenAiResult = { ok: true; json: unknown } | { ok: false; reason: AiFailure };

/** Only short machine codes such as `server_error` or `invalid_api_key` may reach a report. */
const SAFE_CODE = /^[a-z0-9_]{1,40}$/;

function safeCode(v: unknown): string | undefined {
  return typeof v === 'string' && SAFE_CODE.test(v) ? v : undefined;
}

function isAbort(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    ((e as { name: unknown }).name === 'TimeoutError' || (e as { name: unknown }).name === 'AbortError')
  );
}

/**
 * OpenAI's error envelope is `{ error: { code, type, message } }`. Deliberately narrow: a bare
 * "safety" would also match parameter errors such as one about `safety_identifier`.
 */
function isRefusal(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const err = (body as { error?: unknown }).error;
  if (typeof err !== 'object' || err === null) return false;
  const { code, type, message } = err as { code?: unknown; type?: unknown; message?: unknown };
  if (code === 'moderation_blocked' || code === 'content_policy_violation') return true;
  const text = `${typeof type === 'string' ? type : ''} ${typeof message === 'string' ? message : ''}`;
  return /content[ _-]?policy|safety system/i.test(text);
}

function report(endpoint: string, what: string, tags: Record<string, string | number> = {}, level: 'warning' | 'error' = 'error'): void {
  // A fresh Error with a fixed message: never the caught error, never the response body.
  reportError(new Error(`openai ${what}`), { where: 'ai.openai', tags: { endpoint, ...tags }, level });
}

/**
 * POSTs to `{baseUrl}{path}` with the timeout and returns the parsed JSON, or a failure reason.
 * `body` is a JSON-able object (sent as JSON) or FormData (multipart; fetch sets the boundary).
 */
export async function postOpenAi(cfg: OpenAiConfig, path: string, body: object | FormData): Promise<OpenAiResult> {
  const endpoint = path.replace(/^\//, '');
  const isForm = body instanceof FormData;
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.apiKey}` };
  if (!isForm) headers['Content-Type'] = 'application/json';

  try {
    const res = await fetch(`${cfg.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers,
      body: isForm ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(AI_OPENAI_TIMEOUT_MS),
    });
    // The body is read inside the same try: a timeout while streaming it is still a timeout.
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }

    if (!res.ok) {
      if (isRefusal(json)) return { ok: false, reason: 'refused' };
      const code = safeCode((json as { error?: { code?: unknown } } | undefined)?.error?.code);
      report(endpoint, 'http error', { status: res.status, ...(code ? { code } : {}) });
      return { ok: false, reason: 'error' };
    }
    if (json === undefined) {
      report(endpoint, 'unreadable body', { status: res.status });
      return { ok: false, reason: 'error' };
    }
    return { ok: true, json };
  } catch (e) {
    if (isAbort(e)) {
      report(endpoint, 'timeout', { timeoutMs: AI_OPENAI_TIMEOUT_MS }, 'warning');
      return { ok: false, reason: 'timeout' };
    }
    report(endpoint, 'network error');
    return { ok: false, reason: 'error' };
  }
}

function toBlob(ref: ImageRef): Blob {
  // Copy into an ArrayBuffer-backed array (a Uint8Array view over a SharedArrayBuffer is not a BlobPart).
  return new Blob([Uint8Array.from(ref.bytes)], { type: ref.mime });
}

/**
 * One image. No refs → /images/generations (JSON); refs → /images/edits (multipart, `image[]` per ref).
 * Only refs prepared with `prepareRef` (normalise.ts) should be passed.
 */
export async function generateImage(
  cfg: OpenAiConfig,
  req: { prompt: string; size: string; background: 'transparent' | 'opaque'; refs: ImageRef[] },
): Promise<{ ok: true; png: Uint8Array } | { ok: false; reason: AiFailure }> {
  const fields = {
    model: AI_IMAGE_MODEL,
    prompt: req.prompt,
    size: req.size,
    quality: 'high',
    n: 1,
    background: req.background,
    output_format: 'png',
  } as const;

  let result: OpenAiResult;
  if (req.refs.length === 0) {
    result = await postOpenAi(cfg, 'images/generations', fields);
  } else {
    const form = new FormData();
    req.refs.forEach((ref, i) => {
      form.append('image[]', toBlob(ref), `ref-${i + 1}.${ref.mime === 'image/png' ? 'png' : 'jpg'}`);
    });
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    result = await postOpenAi(cfg, 'images/edits', form);
  }
  if (!result.ok) return result;

  const b64 = (result.json as { data?: { b64_json?: unknown }[] } | null)?.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || b64.length === 0) {
    report(req.refs.length ? 'images/edits' : 'images/generations', 'no image in response');
    return { ok: false, reason: 'error' };
  }
  const png = new Uint8Array(Buffer.from(b64, 'base64'));
  if (png.length === 0) {
    report(req.refs.length ? 'images/edits' : 'images/generations', 'empty image');
    return { ok: false, reason: 'error' };
  }
  return { ok: true, png };
}
