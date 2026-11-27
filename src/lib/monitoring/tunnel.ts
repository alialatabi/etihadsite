import 'server-only';
import { POST as sentryPOST } from '@sentry/nextjs/tunnel';

/**
 * Deadline wrapper around the Sentry tunnel handler (/monitoring and /sentry-tunnel).
 *
 * Why: the SDK's handler reads the INCOMING request body with no deadline and only afterwards starts its
 * own 30 s upstream fetch. A browser that sends an error report while the page unloads, or a mobile
 * connection that drops mid-upload, leaves a body that never finishes; the request then hangs until
 * Vercel kills it at 300 s. This wrapper therefore:
 *   1. reads the whole body itself within `bodyMs` (and at most `maxBytes`), so a stalled upload is
 *      answered with an empty 408 and the SDK handler never runs;
 *   2. hands the SDK a fresh request whose body is the buffered bytes (it never waits on the client);
 *   3. caps everything, including reading the SDK's answer body (a stream), at `totalMs` (empty 504).
 *
 * The allowed DSN stays whatever the SDK handler decides (the server SDK's own DSN); this file never
 * looks at the envelope. It never logs bodies, headers or DSNs, and answers failures with empty bodies.
 */

export interface DeadlineTunnelOptions {
  /** Max time to receive the whole incoming body. Default 5 s. */
  bodyMs?: number;
  /** Hard cap for the whole request, body read and SDK answer included. Default 10 s. */
  totalMs?: number;
  /** Max accepted body size. Default 1 MiB (browser error envelopes are a few KB; larger -> 413). */
  maxBytes?: number;
}

export const TUNNEL_BODY_MS = 5_000;
export const TUNNEL_TOTAL_MS = 10_000;
export const TUNNEL_MAX_BYTES = 1024 * 1024;

/**
 * The only headers of the SDK's answer that reach the browser: the ones the browser SDK reads (retry/rate-limit
 * handling). The SDK's own Node path passes on the same three; the rest describe the connection to Sentry.
 */
const ANSWER_HEADERS = ['content-type', 'retry-after', 'x-sentry-rate-limits'] as const;
/** Statuses a Response may not carry a body with. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

const TIMEOUT = Symbol('timeout');
const TOO_BIG = Symbol('too-big');
const noop = () => {};
const empty = (status: number) => new Response(null, { status });

/** Resolves with `p`, or TIMEOUT after `ms`; the timer never outlives the race. */
async function within<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), Math.max(0, ms));
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Reads the whole stream (null body -> empty). Cancels the reader itself when the caller stops waiting. */
function readAll(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): { done: Promise<Uint8Array | typeof TOO_BIG>; cancel: () => void } {
  if (!stream) return { done: Promise.resolve(new Uint8Array(0)), cancel: noop };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const done = (async () => {
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel().catch(noop);
        return TOO_BIG;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  })();
  return { done, cancel: () => void reader.cancel().catch(noop) };
}

export function createDeadlineTunnel(
  handler: (req: Request) => Promise<Response>,
  opts: DeadlineTunnelOptions = {},
): (request: Request) => Promise<Response> {
  const totalMs = opts.totalMs ?? TUNNEL_TOTAL_MS;
  const bodyMs = Math.min(opts.bodyMs ?? TUNNEL_BODY_MS, totalMs);
  const maxBytes = opts.maxBytes ?? TUNNEL_MAX_BYTES;

  return async function POST(request: Request): Promise<Response> {
    const startedAt = Date.now();
    try {
      // (a) The incoming body, under its own deadline.
      const declared = Number(request.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        request.body?.cancel().catch(noop);
        return empty(413);
      }
      const incoming = readAll(request.body, maxBytes);
      incoming.done.catch(noop);
      const body = await within(incoming.done, bodyMs);
      if (body === TIMEOUT) {
        incoming.cancel();
        return empty(408);
      }
      if (body === TOO_BIG) return empty(413);

      // (b) The same request with a complete body; its content-length is the real buffered length.
      const headers = new Headers(request.headers);
      headers.set('content-length', String(body.byteLength));
      headers.delete('transfer-encoding');
      const forwarded = new Request(request.url, {
        method: 'POST',
        headers,
        body: body.byteLength ? (body as BodyInit) : undefined,
      });

      // (c) The SDK handler plus its whole answer body, within what is left of totalMs.
      // The answer body is read with readAll (a reader we hold), so the deadline can really cancel a stalled
      // stream; `arrayBuffer()` would keep the stream locked and `body.cancel()` would then reject.
      let abandoned = false;
      let pending: Response | undefined;
      let answerRead: ReturnType<typeof readAll> | undefined;
      const work = (async () => {
        const answer = await handler(forwarded);
        pending = answer;
        if (abandoned) {
          answer.body?.cancel().catch(noop);
          return TIMEOUT;
        }
        answerRead = readAll(answer.body, maxBytes);
        return { answer, bytes: await answerRead.done };
      })();
      work.catch(noop);
      const result = await within(work, totalMs - (Date.now() - startedAt));
      if (result === TIMEOUT) {
        abandoned = true;
        if (answerRead) answerRead.cancel();
        else pending?.body?.cancel().catch(noop);
        return empty(504);
      }
      if (result.bytes === TOO_BIG) return empty(502);

      const out = new Headers();
      for (const name of ANSWER_HEADERS) {
        const value = result.answer.headers.get(name);
        if (value) out.set(name, value);
      }
      const { status } = result.answer;
      return new Response(NULL_BODY_STATUSES.has(status) ? null : (result.bytes as BodyInit), { status, headers: out });
    } catch {
      // A thrown handler (or an unreadable answer): empty 502, nothing from the request in the response.
      return empty(502);
    }
  };
}

export const POST = createDeadlineTunnel(sentryPOST);
