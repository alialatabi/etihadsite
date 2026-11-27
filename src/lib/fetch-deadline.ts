/**
 * fetch() with a deadline on the wait for the response HEADERS only (client-safe, no server-only).
 * AbortController + setTimeout, not AbortSignal.timeout: older Android WebViews and Safari < 16 lack it.
 * The timer is cleared as soon as fetch() settles, so reading a large body afterwards is never cut.
 * When the deadline fires the promise rejects with `Error('timeout')`, the same word the XHR upload uses.
 */
export async function fetchWithDeadline(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ac = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    ac.abort();
  }, ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    if (expired) throw new Error('timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
