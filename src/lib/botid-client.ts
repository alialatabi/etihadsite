import { initBotId } from 'botid/client/core';

/** Every POST the BotID check reads (the server side asks `botBlocked()` in src/lib/botid.ts). */
export const BOTID_PROTECTED_PATHS = [
  '/api/orders',
  '/api/upload',
  '/api/upload/direct',
  '/api/design/brief',
  '/api/design/generate',
] as const;

/** The parts of `window` the guard touches (a parameter so a test can pass a fake). */
export interface BotIdWindow {
  fetch: typeof fetch;
  XMLHttpRequest?: { prototype: { send: (this: unknown, body?: unknown) => unknown } };
}

/**
 * Starts BotID in the browser and keeps it from ever stopping a request. BotID wraps `fetch` and
 * XHR for the protected paths and waits for its challenge script first; when that script cannot
 * load (an ad blocker, a network drop) the wrapped call rejects with the failed script's Event
 * (fetch) or never fires (XHR), so the order or the upload would be dead. Here that case sends the
 * plain request instead. Anything that is not such an Event (a real network error, an abort) is
 * rethrown untouched, so nothing is sent twice. Does nothing in development (BotID skips it there).
 * Not covered: a script that loads but never answers.
 */
export function startBotId(win: BotIdWindow = window as unknown as BotIdWindow, init: typeof initBotId = initBotId): void {
  const plainFetch = win.fetch;
  const xhrProto = win.XMLHttpRequest?.prototype;
  const plainSend = xhrProto?.send;

  init({ protect: BOTID_PROTECTED_PATHS.map((path) => ({ path, method: 'POST' })) });

  const wrappedFetch = win.fetch;
  if (wrappedFetch !== plainFetch) {
    win.fetch = async (input, initArg) => {
      try {
        return await wrappedFetch.call(win, input, initArg);
      } catch (e) {
        if (!(e instanceof Event)) throw e;
        return plainFetch.call(win, input, initArg);
      }
    };
  }

  if (xhrProto && plainSend && xhrProto.send !== plainSend) {
    const wrappedSend = xhrProto.send;
    xhrProto.send = function (this: unknown, body?: unknown) {
      const result = wrappedSend.call(this, body);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch(() => {
          plainSend.call(this, body);
        });
      }
      return result;
    };
  }
}
