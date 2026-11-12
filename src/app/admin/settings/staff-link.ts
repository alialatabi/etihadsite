/**
 * The absolute staff link shown on the admin settings page. Pure: no next/* imports, so it can
 * be unit-tested without a request; page.tsx passes the request headers in.
 */

/** A header a chain of proxies may have turned into "a, b": its first value, trimmed; null when empty. */
function firstValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first ? first : null;
}

/** `<proto>://<host><path>` from the forwarded (else the plain) host, or the bare path without a host. */
export function staffLinkFor(path: string, h: { get(name: string): string | null }): string {
  const host = firstValue(h.get('x-forwarded-host')) ?? firstValue(h.get('host'));
  if (!host) return path;
  const forwarded = firstValue(h.get('x-forwarded-proto'))?.toLowerCase();
  const proto =
    forwarded === 'http' || forwarded === 'https'
      ? forwarded
      : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
        ? 'http'
        : 'https';
  return `${proto}://${host}${path}`;
}
