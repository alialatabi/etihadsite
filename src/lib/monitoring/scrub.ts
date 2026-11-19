/**
 * Privacy scrubber for everything that leaves the site for Sentry (browser and server).
 *
 * PURE: no Sentry import, no `server-only`, no Node API. It is imported by the client init
 * (src/instrumentation-client.ts), the server init (src/sentry.server.config.ts) and the unit tests.
 *
 * What it removes (docs/ARCHITECTURE.md, "Error monitoring (Sentry)"):
 * - the staff key: `/staff/<anything>` becomes `/staff/[redacted]` (any letter case, also percent-encoded),
 *   and any configured secret value (STAFF_PAGE_KEY, bot token, ...) wherever it appears as text.
 *   (`isStaffPath` in src/lib/analytics/paths.ts is a yes/no check and cannot rewrite, so the
 *   rewrite is a case-insensitive regex here.);
 * - query strings and fragments of every URL (Supabase signed upload/download links carry a token);
 * - the Telegram bot token that sits in the URL path (`/bot<id>:<token>/`), JWT-looking tokens and
 *   `token=` style values;
 * - Iraqi phone numbers, `Key (phone)=(...)` and `Failing row contains (...)` fragments of database error texts
 *   (the failing row of the orders table holds the customer data);
 * - the whole `user` block (IP address included), the server host name, cookies, request headers (the staff key travels in
 *   the `x-staff-key` header), request bodies and query strings;
 * - console breadcrumbs (the order summary with the customer's name, phone and address is logged).
 *
 * Every string anywhere in an event or breadcrumb is walked, not just a list of known fields.
 * The scrubbers return a new object and never throw (on a failure the event is dropped: null).
 * Hooks: `beforeSend` and `beforeBreadcrumb` on both sides. No `beforeSendTransaction`: nothing is traced.
 */

export const REDACTED = '[redacted]';
export const STAFF_REDACTED = '/staff/[redacted]';

/** Keys removed wherever they appear in an event or breadcrumb (case-insensitive). */
const DROP_KEYS = new Set([
  'cookies',
  'cookie',
  'set-cookie',
  'headers',
  'authorization',
  'x-staff-key',
  'query_string',
  'querystring',
  'body',
]);

/** Keys whose string value is a URL: everything from the first `?` or `#` is cut. */
const URL_KEYS = new Set([
  'url',
  'from',
  'to',
  'href',
  'referrer',
  'request_path',
  'full_url',
  'http.url',
  'url.full',
  'abs_path',
  'filename',
]);

const MAX_DEPTH = 14;
/** Secrets shorter than this are not replaced as plain text (too many false matches). */
const MIN_SECRET_LENGTH = 8;

/** `/staff/<key>` in a URL or path (the key ends at `/ ? # quote space bracket`). Idempotent: an already redacted path is left alone. */
const STAFF_PATH_RE = /\/staff\/(?!\[redacted\])[^\s/?#'"<>)\]\\]+/gi;
/** The same, percent-encoded (a redirect target inside a query string that survived elsewhere). */
const STAFF_ENCODED_RE = /%2fstaff%2f[^\s&?#%'"<>)\]]+/gi;
/** An absolute URL with a query string or fragment, inside free text. */
const URL_WITH_QUERY_RE = /(https?:\/\/[^\s?#'"<>)\]]*)[?#][^\s'"<>)\]]*/gi;
/** Telegram Bot API: the token is part of the path. */
const BOT_TOKEN_RE = /\/bot\d{5,}:[A-Za-z0-9_-]{10,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const TOKEN_PARAM_RE = /\b(token|apikey|api_key|access_token|signature|sig)=[^\s&'"<>)]+/gi;
/** Iraqi mobile numbers: +964 7xx xxx xxxx, 00964..., the bare stored form 9647xxxxxxxxx (as in wa.me links), 07xx xxx xxxx. */
const PHONE_INTL_RE = /(?:\+|\b00|\b)964[\s-]?7\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g;
const PHONE_LOCAL_RE = /\b07\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g;
/** PostgreSQL detail text: `Key (phone)=(0770...) already exists`. */
const PG_KEY_RE = /\(([a-z_, ]*(?:phone|name|address|landmark)[a-z_, ]*)\)=\([^)]*\)/gi;
/** PostgreSQL detail text: `Failing row contains (id, {"customer":...}, ...)`: the whole rest of the line. */
const PG_ROW_RE = /Failing row contains \([^\n]*/gi;

/** A function that scrubs plain text; build one with {@link makeTextScrubber}. */
export type TextScrubber = (text: string) => string;

export interface ScrubOptions {
  /**
   * Literal secret values that must never appear (server: STAFF_PAGE_KEY, TELEGRAM_BOT_TOKEN, ...).
   * Values shorter than 8 characters are ignored.
   */
  secrets?: ReadonlyArray<string | undefined | null>;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Scrubs one piece of text: secrets, staff paths, URL queries, tokens and phone numbers. */
export function makeTextScrubber(options: ScrubOptions = {}): TextScrubber {
  const secrets = (options.secrets ?? []).filter(
    (s): s is string => typeof s === 'string' && s.length >= MIN_SECRET_LENGTH,
  );
  const secretRe = secrets.length
    ? new RegExp(
        [...new Set(secrets)]
          .sort((a, b) => b.length - a.length)
          .map(escapeRegExp)
          .join('|'),
        'g',
      )
    : null;
  return (text) => {
    // Absolute URLs lose their query and fragment first (the "[redacted]" of a later rule would
    // otherwise end the URL match early), then the staff path, secrets and tokens are rewritten.
    let s = text.replace(URL_WITH_QUERY_RE, '$1');
    s = s.replace(STAFF_PATH_RE, STAFF_REDACTED).replace(STAFF_ENCODED_RE, '%2Fstaff%2F%5Bredacted%5D');
    if (secretRe) s = s.replace(secretRe, REDACTED);
    s = s
      .replace(BOT_TOKEN_RE, '/bot[redacted]')
      .replace(TOKEN_PARAM_RE, '$1=[redacted]')
      .replace(JWT_RE, REDACTED)
      .replace(PG_KEY_RE, '($1)=([redacted])')
      .replace(PG_ROW_RE, 'Failing row contains ([redacted])')
      .replace(PHONE_INTL_RE, '[phone]')
      .replace(PHONE_LOCAL_RE, '[phone]');
    return s;
  };
}

/** Everything from the first `?` or `#` on is cut. */
export function stripQueryAndFragment(url: string): string {
  const i = url.search(/[?#]/);
  return i === -1 ? url : url.slice(0, i);
}

/** A URL value: text scrubbing first (staff key), then the query and fragment are cut. */
export function scrubUrl(url: string, text: TextScrubber = makeTextScrubber()): string {
  return stripQueryAndFragment(text(url));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Deep copy with every string scrubbed, drop-keys removed and URL-keys cut. */
function walk(value: unknown, text: TextScrubber, depth: number, seen: WeakSet<object>, urlKey: boolean): unknown {
  if (typeof value === 'string') {
    const t = text(value);
    return urlKey ? stripQueryAndFragment(t) : t;
  }
  if (typeof value !== 'object' || value === null) return value;
  if (depth > MAX_DEPTH || seen.has(value)) return '[truncated]';
  if (Array.isArray(value)) {
    seen.add(value);
    const out = value.map((v) => walk(v, text, depth + 1, seen, urlKey));
    seen.delete(value);
    return out;
  }
  if (!isPlainObject(value)) {
    // An Error or other class instance inside an event: keep only its text, scrubbed.
    return text(String(value));
  }
  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const key = k.toLowerCase();
    if (DROP_KEYS.has(key)) continue;
    out[k] = walk(v, text, depth + 1, seen, URL_KEYS.has(key));
  }
  seen.delete(value);
  return out;
}

type Loose = Record<string, unknown>;

export interface Scrubbers {
  /** For `beforeSend`: returns the cleaned event, or null (event dropped) if cleaning failed. */
  scrubEvent: <T extends object>(event: T) => T | null;
  /** For `beforeBreadcrumb`: the cleaned breadcrumb, or null to drop it. */
  scrubBreadcrumb: <T extends object>(breadcrumb: T) => T | null;
  /** The text scrubber the other hooks are built on. */
  text: TextScrubber;
}

/** Builds the Sentry hooks. `options.secrets` are literal values to blank out. */
export function makeScrubbers(options: ScrubOptions = {}): Scrubbers {
  const text = makeTextScrubber(options);

  function scrubEvent<T extends object>(event: T): T | null {
    try {
      const copy = walk(event, text, 0, new WeakSet(), false) as Loose;
      // The whole user block (id, email, IP address) and the sensitive parts of the request.
      delete copy.user;
      delete copy.server_name; // the machine's host name
      const request = copy.request;
      if (isPlainObject(request)) {
        const url = typeof request.url === 'string' ? request.url : undefined;
        const method = typeof request.method === 'string' ? request.method : undefined;
        copy.request = { ...(method ? { method } : {}), ...(url ? { url: scrubUrl(url, text) } : {}) };
      }
      return copy as T;
    } catch {
      return null;
    }
  }

  function scrubBreadcrumb<T extends object>(breadcrumb: T): T | null {
    try {
      const b = breadcrumb as Loose;
      // console.log of the order summary carries the customer's name, phone and address.
      if (b.category === 'console') return null;
      return walk(breadcrumb, text, 0, new WeakSet(), false) as T;
    } catch {
      return null;
    }
  }

  return { scrubEvent, scrubBreadcrumb, text };
}
