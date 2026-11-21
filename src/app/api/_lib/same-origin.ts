/**
 * Cheap request checks for the paid AI routes (POST /api/design/brief and /generate), run before
 * the body is read:
 *  - the body must be declared as JSON (a plain HTML form cannot send `application/json`, and a
 *    cross-site fetch that does needs a CORS preflight, which these routes never grant);
 *  - a request carrying an `Origin` must come from this site: its host equals the request's Host
 *    (or the X-Forwarded-Host a proxy sets, or the URL's own host). No Origin (curl, old
 *    browsers on same-origin requests) passes; the daily limits still apply.
 * Returns the HTTP status to answer with (`invalid_request` body), or null when the request may go on.
 */
function firstValue(v: string | null): string | null {
  const s = v?.split(',')[0]?.trim().toLowerCase();
  return s ? s : null;
}

export function aiRequestRejection(request: Request): 415 | 403 | null {
  const type = (request.headers.get('content-type') ?? '').trim().toLowerCase();
  if (!type.startsWith('application/json')) return 415;

  const origin = request.headers.get('origin');
  if (origin === null) return null;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return 403; // "null" (sandboxed page, file:) or junk
  }
  if (!originHost) return 403;
  let urlHost: string | null = null;
  try {
    urlHost = new URL(request.url).host.toLowerCase() || null;
  } catch {
    urlHost = null;
  }
  const hosts = [firstValue(request.headers.get('host')), firstValue(request.headers.get('x-forwarded-host')), urlHost];
  return hosts.includes(originHost) ? null : 403;
}
